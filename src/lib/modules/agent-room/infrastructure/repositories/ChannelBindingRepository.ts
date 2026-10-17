import { uuidv7 } from '@beeblock/svelar/support';
import { AgentChannelBinding } from '../../domain/models/AgentChannelBinding.js';
import type { ChannelBinding, ChannelBindingKind } from '../../domain/channels.js';

function toIso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
}

function parseSenders(value: unknown): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

export function mapBinding(model: AgentChannelBinding): ChannelBinding {
  const inbound = model.getAttribute('last_inbound_at');
  return {
    id: model.getAttribute('id'),
    workspaceId: model.getAttribute('workspace_id'),
    nodeId: model.getAttribute('node_id'),
    integrationId: model.getAttribute('integration_id'),
    kind: model.getAttribute('kind') as ChannelBindingKind,
    externalChatId: model.getAttribute('external_chat_id'),
    allowedSenders: parseSenders(model.getAttribute('allowed_senders_json')),
    enabled: Boolean(model.getAttribute('enabled')),
    lastError: model.getAttribute('last_error') ?? null,
    lastInboundAt: inbound ? toIso(inbound) : null,
    createdAt: toIso(model.getAttribute('created_at')),
  };
}

export class ChannelBindingRepository {
  async create(input: { workspaceId: string; nodeId: string; integrationId: string; kind: ChannelBindingKind; externalChatId: string; allowedSenders: string[] }): Promise<ChannelBinding> {
    const now = new Date().toISOString();
    const model = await AgentChannelBinding.create({
      id: uuidv7(),
      workspace_id: input.workspaceId,
      node_id: input.nodeId,
      integration_id: input.integrationId,
      kind: input.kind,
      external_chat_id: input.externalChatId,
      allowed_senders_json: JSON.stringify(input.allowedSenders),
      cursor: null,
      enabled: true,
      last_error: null,
      last_inbound_at: null,
      created_at: now,
      updated_at: now,
    });
    return mapBinding(model);
  }

  async list(workspaceId: string, nodeId?: string): Promise<ChannelBinding[]> {
    const query = AgentChannelBinding.query().where('workspace_id', workspaceId);
    if (nodeId) query.where('node_id', nodeId);
    return (await query.orderBy('created_at', 'asc').get()).map(mapBinding);
  }

  async listEnabled(): Promise<Array<ChannelBinding & { cursor: string | null }>> {
    const rows = await AgentChannelBinding.query().where('enabled', true).get();
    return rows.map((row) => ({ ...mapBinding(row), cursor: row.getAttribute('cursor') ?? null }));
  }

  async find(workspaceId: string, id: string): Promise<ChannelBinding | null> {
    const model = await AgentChannelBinding.find(id);
    return model && model.getAttribute('workspace_id') === workspaceId ? mapBinding(model) : null;
  }

  async update(id: string, values: { enabled?: boolean; cursor?: string | null; lastError?: string | null; lastInboundAt?: string }): Promise<void> {
    await AgentChannelBinding.query().where('id', id).update({
      ...(values.enabled !== undefined ? { enabled: values.enabled } : {}),
      ...(values.cursor !== undefined ? { cursor: values.cursor } : {}),
      ...(values.lastError !== undefined ? { last_error: values.lastError } : {}),
      ...(values.lastInboundAt !== undefined ? { last_inbound_at: values.lastInboundAt } : {}),
      updated_at: new Date().toISOString(),
    });
  }

  /** Telegram acknowledges updates per bot token, so every binding of one integration shares its cursor. */
  async updateIntegrationCursor(integrationId: string, cursor: string | null): Promise<void> {
    await AgentChannelBinding.query().where('integration_id', integrationId).update({ cursor, updated_at: new Date().toISOString() });
  }

  async delete(workspaceId: string, id: string): Promise<boolean> {
    return (await AgentChannelBinding.query().where('workspace_id', workspaceId).where('id', id).delete()) > 0;
  }

  async deleteWorkspace(workspaceId: string): Promise<void> {
    await AgentChannelBinding.query().where('workspace_id', workspaceId).delete();
  }
}

export const channelBindingRepository = new ChannelBindingRepository();
