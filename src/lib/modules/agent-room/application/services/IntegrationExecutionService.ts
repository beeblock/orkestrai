import { createHash } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import { basename, isAbsolute, relative, resolve, sep } from 'node:path';
import { uuidv7 } from '@beeblock/svelar/support';
import { integrationManifest } from '../catalogs/IntegrationCatalog.js';
import type { IntegrationExecutionInput } from '../../contracts/schemas/integration.schema.js';
import { integrationExecutionSchema } from '../../contracts/schemas/integration.schema.js';
import type { AutomationIntegration } from '../../domain/types.js';
import { AgentIntegrationEvent } from '../../domain/models/AgentIntegrationEvent.js';
import { AgentAutomationIntegration } from '../../domain/models/AgentAutomationIntegration.js';
import { workspaceRepository } from '../../infrastructure/repositories/WorkspaceRepository.js';
import { TrustedIntegrationHttpClient } from '../../infrastructure/integrations/TrustedIntegrationHttpClient.js';
import { desktopSecretService } from '../../infrastructure/secrets/DesktopSecretService.js';
import { autonomyPolicyService, redactAutonomyValue } from './AutonomyPolicyService.js';
import { secretRefService } from './SecretRefService.js';

type ExecutionContext = {
  actorType: 'agent' | 'automation' | 'user' | 'integration' | 'system';
  actorId?: string | null;
  runId?: string | null;
};

type StoredGoogleCredential = {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  tokenType?: string;
  scope?: string;
};

const MAX_ATTACHMENT_BYTES = 24 * 1024 * 1024;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringArray(value: unknown, max = 100): string[] {
  return Array.isArray(value) ? value.slice(0, max).map(String) : [];
}

function asIso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function safeError(status: number, provider: string, payload: unknown): Error {
  const data = record(payload);
  const providerError = record(data.error);
  const code = String(providerError.code ?? data.error_code ?? data.error ?? data.description ?? '').slice(0, 120);
  return new Error(`${provider} returned HTTP ${status}${code && !/token|secret|authorization/i.test(code) ? ` (${code})` : ''}.`);
}

function base64Url(value: Buffer | string): string {
  return Buffer.from(value).toString('base64url');
}

function encodeHeader(value: string): string {
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

function quoteFilename(value: string): string {
  return value.replace(/["\r\n\\]/g, '_');
}

export class IntegrationExecutionService {
  constructor(private readonly http = new TrustedIntegrationHttpClient()) {}

  async get(workspaceId: string, id: string): Promise<AutomationIntegration> {
    return this.requireIntegration(workspaceId, id);
  }

  async execute(
    workspaceId: string,
    rawInput: IntegrationExecutionInput,
    context: ExecutionContext,
  ): Promise<Record<string, unknown>> {
    const request = integrationExecutionSchema.parse(rawInput);
    const integration = await this.requireIntegration(workspaceId, request.integrationId);
    const manifest = integrationManifest(integration.type);
    const action = manifest.actions.find((candidate) => candidate.id === request.action);
    if (!action) throw new Error('Integration action is not supported by this manifest version.');
    if (!integration.enabled || integration.status !== 'connected') throw new Error('Integration is not connected and enabled.');
    if (!integration.permissions.includes(action.id)) throw new Error('Integration action is outside the standing account grant.');
    const input = action.inputSchema.parse(request.input) as Record<string, unknown>;
    const idempotencyKey = request.idempotencyKey ?? this.idempotencyKey(integration.id, action.id, input);
    const prior = await AgentIntegrationEvent.query().where('integration_id', integration.id).where('idempotency_key', idempotencyKey).first();
    if (prior && String(prior.getAttribute('status')) === 'succeeded') {
      return { duplicate: true, eventId: String(prior.getAttribute('id')), ...record(this.parse(prior.getAttribute('payload_json'))) };
    }

    const eventId = prior ? String(prior.getAttribute('id')) : uuidv7();
    const now = new Date();
    if (!prior) {
      await AgentIntegrationEvent.create({
        id: eventId,
        workspace_id: workspaceId,
        integration_id: integration.id,
        direction: 'outbound',
        kind: action.id,
        idempotency_key: idempotencyKey,
        status: 'running',
        payload_json: null,
        error: null,
        processed_at: null,
        created_at: now,
        updated_at: now,
      });
    } else {
      await AgentIntegrationEvent.query().where('id', eventId).update({ status: 'running', error: null, updated_at: now });
    }

    const networkUrl = this.auditUrl(integration);
    try {
      const result = await autonomyPolicyService.execute({
        workspaceId,
        runId: context.runId ?? null,
        capability: 'integration',
        operation: action.id,
        target: `${integration.name}:${this.targetOf(integration, input)}`,
        mutation: action.mutation,
        risk: action.risk,
        actorType: context.actorType,
        actorId: context.actorId ?? null,
        input: { integrationId: integration.id, action: action.id, input },
        auditOutput: (output) => this.auditResult(action.id, record(output)),
        certainty: 'semantic',
        network: { url: networkUrl, method: action.mutation ? 'POST' : 'GET' },
      }, () => this.executeUnchecked(workspaceId, integration, action.id, input, context));
      const persisted = this.auditResult(action.id, result);
      const finished = new Date();
      await AgentIntegrationEvent.query().where('id', eventId).update({
        status: 'succeeded', payload_json: JSON.stringify(persisted), error: null,
        processed_at: finished, updated_at: finished,
      });
      await AgentAutomationIntegration.query().where('id', integration.id).update({ last_used_at: finished, updated_at: finished });
      return { ...result, eventId, duplicate: false };
    } catch (error) {
      const finished = new Date();
      await AgentIntegrationEvent.query().where('id', eventId).update({
        status: 'failed', error: String(error instanceof Error ? error.message : error).slice(0, 2_000),
        processed_at: finished, updated_at: finished,
      });
      throw error;
    }
  }

  async listEvents(workspaceId: string, limit = 100, integrationId?: string) {
    let query = AgentIntegrationEvent.query().where('workspace_id', workspaceId);
    if (integrationId) query = query.where('integration_id', integrationId);
    const rows = await query.orderBy('created_at', 'desc').limit(Math.max(1, Math.min(limit, 500))).get();
    return rows.map((row) => ({
      id: String(row.getAttribute('id')),
      workspaceId: String(row.getAttribute('workspace_id')),
      integrationId: String(row.getAttribute('integration_id')),
      direction: String(row.getAttribute('direction')),
      kind: String(row.getAttribute('kind')),
      status: String(row.getAttribute('status')),
      payload: this.parse(row.getAttribute('payload_json')),
      error: row.getAttribute('error') ? String(row.getAttribute('error')) : null,
      processedAt: row.getAttribute('processed_at') ? asIso(row.getAttribute('processed_at')) : null,
      createdAt: asIso(row.getAttribute('created_at')),
    }));
  }

  async probe(workspaceId: string, integration: AutomationIntegration): Promise<Record<string, unknown>> {
    const host = integration.type === 'webhook' ? new URL(String(integration.config.url)).hostname : integrationManifest(integration.type).hosts[0];
    return autonomyPolicyService.execute({
      workspaceId,
      capability: 'integration',
      operation: 'integration:probe',
      target: integration.name,
      mutation: false,
      actorType: 'user',
      actorId: 'workspace-owner',
      certainty: 'semantic',
      ...(integration.type === 'webhook' ? {} : { network: { url: `https://${host}/`, method: 'GET' } }),
    }, async () => {
      if (integration.type === 'webhook') return { endpoint: String(integration.config.url), configured: true };
      if (integration.type === 'github') {
        const token = await this.secret(integration, 'integration:probe', 'api.github.com');
        const response = await this.http.request('https://api.github.com/user', { headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${token}`, 'x-github-api-version': '2022-11-28', 'user-agent': 'orkestrai-integration' } });
        if (!response.ok) throw safeError(response.status, 'GitHub', response.json);
        return { account: String(record(response.json).login ?? '').slice(0, 120) };
      }
      if (integration.type === 'gmail') {
        const credential = await this.googleCredential(integration, 'integration:probe');
        const token = await this.refreshGoogleCredential(workspaceId, integration, credential);
        const response = await this.http.request('https://gmail.googleapis.com/gmail/v1/users/me/profile', { headers: { authorization: `Bearer ${token}`, accept: 'application/json' } });
        if (!response.ok) throw safeError(response.status, 'Gmail', response.json);
        const data = record(response.json);
        return { account: String(data.emailAddress ?? '').slice(0, 320), messagesTotal: Number(data.messagesTotal ?? 0), threadsTotal: Number(data.threadsTotal ?? 0) };
      }
      if (integration.type === 'slack') {
        const token = await this.secret(integration, 'integration:probe', 'slack.com');
        const response = await this.http.request('https://slack.com/api/auth.test', { method: 'POST', headers: { authorization: `Bearer ${token}`, accept: 'application/json' } });
        const data = record(response.json);
        if (!response.ok || data.ok !== true) throw safeError(response.status, 'Slack', response.json);
        return { account: String(data.user ?? '').slice(0, 120), team: String(data.team ?? '').slice(0, 120), teamId: data.team_id ?? null, botId: data.bot_id ?? null };
      }
      if (integration.type === 'telegram') {
        const token = await this.secret(integration, 'integration:probe', 'api.telegram.org');
        const response = await this.http.request(`https://api.telegram.org/bot${token}/getMe`, { method: 'POST', headers: { accept: 'application/json' } });
        const data = record(response.json);
        if (!response.ok || data.ok !== true) throw safeError(response.status, 'Telegram', response.json);
        const result = record(data.result);
        return { account: String(result.username ?? result.first_name ?? '').slice(0, 120), botId: result.id ?? null };
      }
      const token = await this.secret(integration, 'integration:probe', 'graph.facebook.com');
      const version = encodeURIComponent(String(integration.config.apiVersion));
      const phone = encodeURIComponent(String(integration.config.phoneNumberId));
      const response = await this.http.request(`https://graph.facebook.com/${version}/${phone}?fields=display_phone_number,verified_name`, { headers: { authorization: `Bearer ${token}`, accept: 'application/json' } });
      if (!response.ok) throw safeError(response.status, 'WhatsApp', response.json);
      const data = record(response.json);
      return { account: String(data.verified_name ?? '').slice(0, 120), displayPhoneNumber: String(data.display_phone_number ?? '').slice(0, 80), phoneNumberId: data.id ?? null };
    });
  }

  private async executeUnchecked(
    workspaceId: string,
    integration: AutomationIntegration,
    action: string,
    input: Record<string, unknown>,
    context: ExecutionContext,
  ): Promise<Record<string, unknown>> {
    if (integration.type === 'github') return this.github(integration, action);
    if (integration.type === 'gmail') return this.gmail(workspaceId, integration, action, input, context);
    if (integration.type === 'slack') return this.slack(workspaceId, integration, action, input);
    if (integration.type === 'telegram') return this.telegram(workspaceId, integration, action, input, context);
    if (integration.type === 'whatsapp') return this.whatsapp(workspaceId, integration, action, input);
    return this.webhook(workspaceId, integration, input);
  }

  private async github(integration: AutomationIntegration, action: string): Promise<Record<string, unknown>> {
    if (action !== 'github.read_latest_pull_request') throw new Error('Unsupported GitHub action.');
    const token = await this.secret(integration, action, 'api.github.com');
    const owner = encodeURIComponent(String(integration.config.owner ?? ''));
    const repo = encodeURIComponent(String(integration.config.repo ?? ''));
    const response = await this.http.request(`https://api.github.com/repos/${owner}/${repo}/pulls?state=all&sort=updated&direction=desc&per_page=1`, {
      headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${token}`, 'x-github-api-version': '2022-11-28', 'user-agent': 'orkestrai-integration' },
    });
    if (!response.ok) throw safeError(response.status, 'GitHub', response.json);
    const pull = Array.isArray(response.json) ? record(response.json[0]) : {};
    return { number: pull.number ?? null, title: String(pull.title ?? '').slice(0, 500), state: pull.state ?? null, url: pull.html_url ?? null, updatedAt: pull.updated_at ?? null };
  }

  private async gmail(workspaceId: string, integration: AutomationIntegration, action: string, input: Record<string, unknown>, context: ExecutionContext): Promise<Record<string, unknown>> {
    const credential = await this.googleCredential(integration, action);
    const token = await this.refreshGoogleCredential(workspaceId, integration, credential);
    const headers = { authorization: `Bearer ${token}`, accept: 'application/json', 'content-type': 'application/json' };
    let url = 'https://gmail.googleapis.com/gmail/v1/users/me/messages';
    let init: RequestInit = { headers };
    if (action === 'gmail.list_messages') {
      const query = new URLSearchParams({ maxResults: String(input.maxResults) });
      if (input.query) query.set('q', String(input.query));
      if (input.pageToken) query.set('pageToken', String(input.pageToken));
      url += `?${query}`;
    } else if (action === 'gmail.read_message') {
      url += `/${encodeURIComponent(String(input.messageId))}?format=${input.format}`;
    } else if (action === 'gmail.modify_labels') {
      url += `/${encodeURIComponent(String(input.messageId))}/modify`;
      init = { method: 'POST', headers, body: JSON.stringify({ addLabelIds: input.addLabelIds, removeLabelIds: input.removeLabelIds }) };
    } else {
      const raw = await this.mimeMessage(workspaceId, integration, input, context);
      const payload = { message: { raw, ...(input.threadId ? { threadId: input.threadId } : {}) } };
      if (action === 'gmail.create_draft') {
        url = 'https://gmail.googleapis.com/gmail/v1/users/me/drafts';
      } else {
        url += '/send';
        Object.assign(payload, payload.message);
        delete (payload as { message?: unknown }).message;
      }
      init = { method: 'POST', headers, body: JSON.stringify(payload) };
    }
    const response = await this.http.request(url, init);
    if (!response.ok) throw safeError(response.status, 'Gmail', response.json);
    const data = record(response.json);
    if (action === 'gmail.list_messages') return { messages: Array.isArray(data.messages) ? data.messages.slice(0, 100).map((message) => ({ id: record(message).id, threadId: record(message).threadId })) : [], nextPageToken: data.nextPageToken ?? null, resultSizeEstimate: data.resultSizeEstimate ?? 0 };
    if (action === 'gmail.read_message') return this.safeGmailMessage(data);
    return { id: data.id ?? record(data.message).id ?? null, threadId: data.threadId ?? record(data.message).threadId ?? null, labelIds: stringArray(data.labelIds, 100) };
  }

  private async slack(workspaceId: string, integration: AutomationIntegration, action: string, input: Record<string, unknown>): Promise<Record<string, unknown>> {
    const token = await this.secret(integration, action, 'slack.com');
    let endpoint = 'auth.test';
    let method = 'POST';
    let body: Record<string, unknown> = {};
    if (action === 'slack.send_message') {
      endpoint = 'chat.postMessage';
      body = { channel: input.channel ?? integration.config.defaultChannel, text: input.text, ...(input.threadTs ? { thread_ts: input.threadTs } : {}) };
      if (!body.channel) throw new Error('Slack channel is required.');
    } else if (action === 'slack.list_channels') {
      endpoint = 'conversations.list'; method = 'GET';
    } else if (action === 'slack.read_messages') {
      endpoint = 'conversations.history'; method = 'GET';
    }
    const query = method === 'GET' ? new URLSearchParams(Object.entries(input).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)])) : null;
    const response = await this.http.request(`https://slack.com/api/${endpoint}${query ? `?${query}` : ''}`, {
      method,
      headers: { authorization: `Bearer ${token}`, accept: 'application/json', ...(method === 'POST' ? { 'content-type': 'application/json' } : {}) },
      ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
    });
    const data = record(response.json);
    if (!response.ok || data.ok !== true) throw safeError(response.status, 'Slack', response.json);
    if (action === 'slack.list_channels') return { channels: Array.isArray(data.channels) ? data.channels.slice(0, 200).map((channel) => ({ id: record(channel).id, name: String(record(channel).name ?? '').slice(0, 120), isPrivate: Boolean(record(channel).is_private), isMember: Boolean(record(channel).is_member) })) : [], nextCursor: record(data.response_metadata).next_cursor ?? null };
    if (action === 'slack.read_messages') return { messages: Array.isArray(data.messages) ? data.messages.slice(0, 100).map((message) => ({ ts: record(message).ts, user: record(message).user, text: String(record(message).text ?? '').slice(0, 20_000), threadTs: record(message).thread_ts ?? null })) : [], nextCursor: record(data.response_metadata).next_cursor ?? null };
    return { channel: data.channel ?? null, ts: data.ts ?? null, messageTs: record(data.message).ts ?? null };
  }

  private async telegram(workspaceId: string, integration: AutomationIntegration, action: string, input: Record<string, unknown>, context: ExecutionContext): Promise<Record<string, unknown>> {
    const token = await this.secret(integration, action, 'api.telegram.org');
    const method = action === 'telegram.send_message' ? 'sendMessage' : action === 'telegram.send_document' ? 'sendDocument' : 'getUpdates';
    let body: BodyInit | undefined;
    const headers: Record<string, string> = { accept: 'application/json' };
    if (action === 'telegram.send_document') {
      const file = await this.workspaceFile(workspaceId, String(input.path), context);
      const form = new FormData();
      form.set('chat_id', String(input.chatId ?? integration.config.defaultChatId ?? ''));
      form.set('caption', String(input.caption ?? ''));
      form.set('document', new Blob([new Uint8Array(file)]), String(input.filename ?? basename(String(input.path))));
      body = form;
    } else if (action === 'telegram.send_message') {
      headers['content-type'] = 'application/json';
      body = JSON.stringify({ chat_id: input.chatId ?? integration.config.defaultChatId, text: input.text, disable_notification: input.disableNotification });
    } else {
      headers['content-type'] = 'application/json';
      body = JSON.stringify({ offset: input.offset, timeout: input.timeout, limit: input.limit, allowed_updates: ['message', 'edited_message', 'channel_post'] });
    }
    const response = await this.http.request(`https://api.telegram.org/bot${token}/${method}`, { method: 'POST', headers, body });
    const data = record(response.json);
    if (!response.ok || data.ok !== true) throw safeError(response.status, 'Telegram', response.json);
    if (action === 'telegram.read_updates') return { updates: Array.isArray(data.result) ? data.result.slice(0, 100).map((update) => this.safeTelegramUpdate(record(update))) : [] };
    const result = record(data.result);
    return { messageId: result.message_id ?? null, date: result.date ?? null, chatId: record(result.chat).id ?? null };
  }

  private async whatsapp(workspaceId: string, integration: AutomationIntegration, action: string, input: Record<string, unknown>): Promise<Record<string, unknown>> {
    const token = await this.secret(integration, action, 'graph.facebook.com');
    const to = String(input.to ?? integration.config.defaultRecipient ?? '');
    if (!to) throw new Error('WhatsApp recipient is required.');
    const payload = action === 'whatsapp.send_document'
      ? { messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'document', document: { link: input.link, filename: input.filename, caption: input.caption } }
      : { messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'text', text: { body: input.text, preview_url: input.previewUrl } };
    const response = await this.http.request(`https://graph.facebook.com/${encodeURIComponent(String(integration.config.apiVersion))}/${encodeURIComponent(String(integration.config.phoneNumberId))}/messages`, {
      method: 'POST', headers: { authorization: `Bearer ${token}`, accept: 'application/json', 'content-type': 'application/json' }, body: JSON.stringify(payload),
    });
    if (!response.ok) throw safeError(response.status, 'WhatsApp', response.json);
    const data = record(response.json);
    return { messageIds: Array.isArray(data.messages) ? data.messages.slice(0, 20).map((message) => record(message).id) : [], contactWaIds: Array.isArray(data.contacts) ? data.contacts.slice(0, 20).map((contact) => record(contact).wa_id) : [] };
  }

  private async webhook(workspaceId: string, integration: AutomationIntegration, input: Record<string, unknown>): Promise<Record<string, unknown>> {
    const url = String(integration.config.url);
    const headers: Record<string, string> = { accept: 'application/json', 'content-type': 'application/json' };
    if (String(integration.config.authScheme) !== 'none') {
      const token = await this.secret(integration, 'webhook.send', new URL(url).hostname);
      if (integration.config.authScheme === 'bearer') headers.authorization = `Bearer ${token}`;
      else headers[String(integration.config.authHeader)] = token;
    }
    const response = await this.http.request(url, { method: String(integration.config.method), headers, body: JSON.stringify(input.payload ?? {}) });
    if (!response.ok) throw safeError(response.status, 'Webhook', response.json);
    return { status: response.status, response: record(redactAutonomyValue(response.json)) };
  }

  private async secret(integration: AutomationIntegration, operation: string, destination: string): Promise<string> {
    const reference = integration.secretRefs[0];
    if (!reference && integration.type === 'github' && integration.secretKey) {
      const legacy = await desktopSecretService.get(integration.secretKey);
      if (!legacy) throw new Error('Integration credential is not configured.');
      return legacy;
    }
    if (!reference) throw new Error('Integration credential is not configured.');
    const value = await secretRefService.resolve(integration.workspaceId, reference, { integration: integration.type, operation, destination });
    return value.revealInsideTrustedExecutor();
  }

  private async googleCredential(integration: AutomationIntegration, operation: string): Promise<StoredGoogleCredential> {
    const raw = await this.secret(integration, operation, 'gmail.googleapis.com');
    try {
      const parsed = JSON.parse(raw) as StoredGoogleCredential;
      if (!parsed.accessToken || typeof parsed.accessToken !== 'string') throw new Error('missing access token');
      return parsed;
    } catch {
      throw new Error('Gmail OAuth credential is invalid. Reconnect the account.');
    }
  }

  private async refreshGoogleCredential(workspaceId: string, integration: AutomationIntegration, credential: StoredGoogleCredential): Promise<string> {
    if (!credential.expiresAt || credential.expiresAt > Date.now() + 60_000) return credential.accessToken;
    if (!credential.refreshToken) throw new Error('Gmail OAuth session expired without a refresh token. Reconnect the account.');
    const body = new URLSearchParams({ client_id: String(integration.config.clientId), refresh_token: credential.refreshToken, grant_type: 'refresh_token' });
    const response = await this.http.request('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body });
    if (!response.ok) throw safeError(response.status, 'Google OAuth', response.json);
    const data = record(response.json);
    if (!data.access_token) throw new Error('Google OAuth did not return an access token.');
    const rotated: StoredGoogleCredential = { ...credential, accessToken: String(data.access_token), expiresAt: Date.now() + Number(data.expires_in ?? 3_600) * 1_000, tokenType: String(data.token_type ?? credential.tokenType ?? 'Bearer'), scope: String(data.scope ?? credential.scope ?? '') };
    await secretRefService.replaceValue(workspaceId, integration.secretRefs[0], JSON.stringify(rotated));
    return rotated.accessToken;
  }

  private async mimeMessage(workspaceId: string, integration: AutomationIntegration, input: Record<string, unknown>, context: ExecutionContext): Promise<string> {
    const to = stringArray(input.to).join(', ');
    const cc = stringArray(input.cc).join(', ');
    const bcc = stringArray(input.bcc).join(', ');
    const headers = [`To: ${to}`, `Subject: ${encodeHeader(String(input.subject))}`, 'MIME-Version: 1.0'];
    if (cc) headers.push(`Cc: ${cc}`);
    if (bcc) headers.push(`Bcc: ${bcc}`);
    if (input.inReplyTo) headers.push(`In-Reply-To: ${input.inReplyTo}`, `References: ${input.inReplyTo}`);
    const attachments = Array.isArray(input.attachments) ? input.attachments.map(record) : [];
    const html = input.html ? String(input.html) : '';
    const text = String(input.text ?? '');
    if (!attachments.length && !html) {
      headers.push('Content-Type: text/plain; charset="UTF-8"', 'Content-Transfer-Encoding: base64');
      return base64Url(headers.join('\r\n') + '\r\n\r\n' + Buffer.from(text, 'utf8').toString('base64'));
    }
    const mixed = `orkestrai_${uuidv7().replace(/-/g, '')}`;
    const alternative = `orkestrai_alt_${uuidv7().replace(/-/g, '')}`;
    headers.push(`Content-Type: multipart/mixed; boundary="${mixed}"`);
    const parts = [headers.join('\r\n'), '', `--${mixed}`];
    if (html) {
      parts.push(`Content-Type: multipart/alternative; boundary="${alternative}"`, '', `--${alternative}`, 'Content-Type: text/plain; charset="UTF-8"', 'Content-Transfer-Encoding: base64', '', Buffer.from(text, 'utf8').toString('base64'), `--${alternative}`, 'Content-Type: text/html; charset="UTF-8"', 'Content-Transfer-Encoding: base64', '', Buffer.from(html, 'utf8').toString('base64'), `--${alternative}--`);
    } else {
      parts.push('Content-Type: text/plain; charset="UTF-8"', 'Content-Transfer-Encoding: base64', '', Buffer.from(text, 'utf8').toString('base64'));
    }
    for (const attachment of attachments) {
      const file = await this.workspaceFile(workspaceId, String(attachment.path), context);
      const filename = quoteFilename(String(attachment.filename));
      parts.push(`--${mixed}`, `Content-Type: ${attachment.mimeType}; name="${filename}"`, 'Content-Transfer-Encoding: base64', `Content-Disposition: attachment; filename="${filename}"`, '', file.toString('base64'));
    }
    parts.push(`--${mixed}--`);
    return base64Url(parts.join('\r\n'));
  }

  private async workspaceFile(workspaceId: string, candidate: string, context: ExecutionContext): Promise<Buffer> {
    const workspace = await workspaceRepository.getWorkspace(workspaceId);
    if (!workspace) throw new Error('Workspace not found.');
    if (!candidate || isAbsolute(candidate)) throw new Error('Attachment path must be relative to the workspace.');
    const absolute = resolve(workspace.workingDir, candidate);
    const canonical = await realpath(absolute);
    const rel = relative(await realpath(workspace.workingDir), canonical);
    if (rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) throw new Error('Attachment path escapes the workspace.');
    const metadata = await stat(canonical);
    if (!metadata.isFile()) throw new Error('Attachment must be a regular file.');
    if (metadata.size > MAX_ATTACHMENT_BYTES) throw new Error('Attachment exceeds the 24 MB integration limit.');
    return autonomyPolicyService.execute({
      workspaceId,
      capability: 'filesystem',
      operation: 'integration:attachment:read',
      target: candidate,
      mutation: false,
      actorType: context.actorType,
      actorId: context.actorId ?? null,
      filesystem: { path: canonical, permission: 'read', size: metadata.size },
      certainty: 'semantic',
    }, async () => readFile(canonical));
  }

  private safeGmailMessage(data: Record<string, unknown>): Record<string, unknown> {
    const payload = record(data.payload);
    const headers = Array.isArray(payload.headers) ? payload.headers.slice(0, 100).map(record) : [];
    const allow = new Set(['from', 'to', 'cc', 'date', 'subject', 'message-id', 'in-reply-to']);
    return {
      id: data.id ?? null,
      threadId: data.threadId ?? null,
      labelIds: stringArray(data.labelIds),
      snippet: String(data.snippet ?? '').slice(0, 20_000),
      internalDate: data.internalDate ?? null,
      headers: headers.filter((header) => allow.has(String(header.name ?? '').toLowerCase())).map((header) => ({ name: String(header.name), value: String(header.value ?? '').slice(0, 4_000) })),
      payload: this.safeGmailPart(payload, 0),
    };
  }

  private safeGmailPart(part: Record<string, unknown>, depth: number): Record<string, unknown> | null {
    if (depth > 8) return null;
    const body = record(part.body);
    return {
      mimeType: String(part.mimeType ?? '').slice(0, 120),
      filename: String(part.filename ?? '').slice(0, 255),
      body: body.data ? String(body.data).slice(0, 2_000_000) : null,
      attachmentId: body.attachmentId ? String(body.attachmentId).slice(0, 180) : null,
      parts: Array.isArray(part.parts) ? part.parts.slice(0, 100).map((entry) => this.safeGmailPart(record(entry), depth + 1)) : [],
    };
  }

  private safeTelegramUpdate(update: Record<string, unknown>): Record<string, unknown> {
    const message = record(update.message ?? update.edited_message ?? update.channel_post);
    return { updateId: update.update_id ?? null, message: { messageId: message.message_id ?? null, date: message.date ?? null, text: String(message.text ?? message.caption ?? '').slice(0, 20_000), chatId: record(message.chat).id ?? null, chatType: record(message.chat).type ?? null, fromId: record(message.from).id ?? null, username: String(record(message.from).username ?? '').slice(0, 120) } };
  }

  private async requireIntegration(workspaceId: string, id: string): Promise<AutomationIntegration> {
    const { automationIntegrationService } = await import('./AutomationIntegrationService.js');
    const integration = await automationIntegrationService.get(workspaceId, id);
    if (!integration) throw new Error('Integration not found.');
    return integration;
  }

  private auditUrl(integration: AutomationIntegration): string {
    if (integration.type === 'webhook') return String(integration.config.url);
    return `https://${integrationManifest(integration.type).hosts[0]}/`;
  }

  private targetOf(integration: AutomationIntegration, input: Record<string, unknown>): string {
    return String(input.to ?? input.channel ?? input.chatId ?? integration.config.defaultRecipient ?? integration.config.defaultChannel ?? integration.config.defaultChatId ?? integration.type).slice(0, 500);
  }

  private idempotencyKey(integrationId: string, action: string, input: Record<string, unknown>): string {
    return `request:${uuidv7()}:${createHash('sha256').update(JSON.stringify({ integrationId, action, input })).digest('hex').slice(0, 24)}`;
  }

  private auditResult(action: string, result: Record<string, unknown>): Record<string, unknown> {
    const summary: Record<string, unknown> = { action };
    for (const key of ['id', 'threadId', 'channel', 'ts', 'messageId', 'status', 'eventId', 'duplicate']) {
      if (result[key] !== undefined && result[key] !== null) summary[key] = result[key];
    }
    for (const key of ['messages', 'updates', 'channels', 'messageIds', 'contactWaIds', 'labelIds']) {
      if (Array.isArray(result[key])) summary[`${key}Count`] = result[key].length;
    }
    if (typeof result.resultSizeEstimate === 'number') summary.resultSizeEstimate = result.resultSizeEstimate;
    if (typeof result.nextPageToken === 'string') summary.hasNextPage = true;
    return record(redactAutonomyValue(summary));
  }

  private parse(value: unknown): unknown {
    try { return value ? JSON.parse(String(value)) : null; } catch { return null; }
  }
}

export const integrationExecutionService = new IntegrationExecutionService();
