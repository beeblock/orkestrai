import { uuidv7 } from '@beeblock/svelar/support';
import type { AutomationIntegration } from '../../domain/types.js';
import { AgentAutomationIntegration } from '../../domain/models/AgentAutomationIntegration.js';
import { githubAutomationAdapter } from '../../infrastructure/integrations/GitHubAutomationAdapter.js';
import type { IntegrationConnectionInput, IntegrationType } from '../../contracts/schemas/integration.schema.js';
import { integrationConnectionSchema } from '../../contracts/schemas/integration.schema.js';
import { integrationManifest, publicIntegrationCatalog } from '../catalogs/IntegrationCatalog.js';
import { secretRefService } from './SecretRefService.js';
import { integrationExecutionService } from './IntegrationExecutionService.js';

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function object(value: unknown): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function array(value: unknown): string[] {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function mapIntegration(model: AgentAutomationIntegration): AutomationIntegration {
  const config = object(model.getAttribute('config_json'));
  return {
    id: String(model.getAttribute('id')),
    workspaceId: String(model.getAttribute('workspace_id')),
    type: String(model.getAttribute('type')) as AutomationIntegration['type'],
    name: String(model.getAttribute('name')),
    manifestVersion: String(model.getAttribute('manifest_version') ?? '1.0.0'),
    config,
    secretRefs: array(model.getAttribute('secret_refs_json')),
    permissions: array(model.getAttribute('permissions_json')),
    secretKey: model.getAttribute('secret_key') ? String(model.getAttribute('secret_key')) : null,
    status: model.getAttribute('status') as AutomationIntegration['status'],
    enabled: model.getAttribute('enabled') === undefined ? true : Boolean(model.getAttribute('enabled')),
    lastCheckedAt: model.getAttribute('last_checked_at') ? toIso(model.getAttribute('last_checked_at')) : null,
    lastUsedAt: model.getAttribute('last_used_at') ? toIso(model.getAttribute('last_used_at')) : null,
    error: model.getAttribute('error') ? String(model.getAttribute('error')) : null,
    createdAt: toIso(model.getAttribute('created_at')),
    updatedAt: toIso(model.getAttribute('updated_at')),
  };
}

export class AutomationIntegrationService {
  catalog() {
    return publicIntegrationCatalog();
  }

  async list(workspaceId: string): Promise<AutomationIntegration[]> {
    const rows = await AgentAutomationIntegration.query().where('workspace_id', workspaceId).orderBy('created_at', 'asc').get();
    return rows.map(mapIntegration);
  }

  async github(workspaceId: string): Promise<AutomationIntegration | null> {
    const row = await AgentAutomationIntegration.query().where('workspace_id', workspaceId).where('type', 'github').first();
    return row ? mapIntegration(row) : null;
  }

  async get(workspaceId: string, id: string): Promise<AutomationIntegration | null> {
    const row = await AgentAutomationIntegration.query().where('workspace_id', workspaceId).where('id', id).first();
    return row ? mapIntegration(row) : null;
  }

  async connect(workspaceId: string, rawInput: IntegrationConnectionInput): Promise<AutomationIntegration> {
    const input = integrationConnectionSchema.parse(rawInput);
    const manifest = integrationManifest(input.type);
    const allowed = new Set(manifest.actions.map((action) => action.id));
    if (input.permissions.some((permission) => !allowed.has(permission))) {
      throw new Error('One or more permissions are not part of this integration manifest.');
    }
    if (!['github', 'webhook'].includes(input.type) && input.secretRefs.length !== manifest.secretSlots) {
      throw new Error('This integration requires exactly one credential reference.');
    }
    if (input.type === 'webhook' && input.config.authScheme !== 'none' && input.secretRefs.length !== 1) {
      throw new Error('Authenticated webhooks require one credential reference.');
    }
    if (input.type === 'webhook' && input.config.authScheme === 'none' && input.secretRefs.length) {
      throw new Error('Unauthenticated webhooks must not retain unused credential references.');
    }
    const refs = await secretRefService.list(workspaceId);
    if (input.secretRefs.some((reference) => !refs.some((candidate) => candidate.ref === reference))) {
      throw new Error('An integration credential reference does not belong to this workspace.');
    }
    const now = new Date();
    const id = uuidv7();
    const model = await AgentAutomationIntegration.create({
      id,
      workspace_id: workspaceId,
      type: input.type,
      name: input.name,
      config_json: JSON.stringify(input.config),
      secret_key: null,
      manifest_version: manifest.version,
      secret_refs_json: JSON.stringify(input.secretRefs),
      permissions_json: JSON.stringify(input.permissions),
      enabled: input.enabled,
      status: 'disconnected',
      last_checked_at: null,
      last_used_at: null,
      error: null,
      created_at: now,
      updated_at: now,
    });
    const integration = mapIntegration(model);
    return this.check(workspaceId, integration.id);
  }

  async check(workspaceId: string, id: string): Promise<AutomationIntegration> {
    const integration = await this.get(workspaceId, id);
    if (!integration) throw new Error('Integration not found.');
    const checkedAt = new Date();
    try {
      const probe = await integrationExecutionService.probe(workspaceId, integration);
      const config = { ...integration.config, ...(probe.account ? { account: probe.account } : {}) };
      await AgentAutomationIntegration.query().where('id', id).update({
        status: 'connected', error: null, config_json: JSON.stringify(config), last_checked_at: checkedAt, updated_at: checkedAt,
      });
    } catch (error) {
      await AgentAutomationIntegration.query().where('id', id).update({
        status: 'error', error: error instanceof Error ? error.message : String(error), last_checked_at: checkedAt, updated_at: checkedAt,
      });
    }
    const updated = await this.get(workspaceId, id);
    if (!updated) throw new Error('Integration disappeared during validation.');
    return updated;
  }

  async setEnabled(workspaceId: string, id: string, enabled: boolean): Promise<AutomationIntegration> {
    const integration = await this.get(workspaceId, id);
    if (!integration) throw new Error('Integration not found.');
    await AgentAutomationIntegration.query().where('id', id).update({ enabled, updated_at: new Date() });
    const updated = await this.get(workspaceId, id);
    if (!updated) throw new Error('Integration disappeared while updating.');
    return updated;
  }

  async connectGitHub(workspaceId: string, input: { owner: string; repo: string }): Promise<AutomationIntegration> {
    const now = new Date();
    const existing = await AgentAutomationIntegration.query().where('workspace_id', workspaceId).where('type', 'github').first();
    const secretKey = `automation:github:${workspaceId}`;
    const base = {
      name: 'GitHub',
      config_json: JSON.stringify({ owner: input.owner, repo: input.repo }),
      secret_key: secretKey,
      manifest_version: '1.0.0',
      secret_refs_json: JSON.stringify([]),
      permissions_json: JSON.stringify(['github.read_latest_pull_request']),
      enabled: true,
      updated_at: now,
    };
    if (existing) {
      await AgentAutomationIntegration.query().where('id', existing.getAttribute('id')).update(base);
    } else {
      await AgentAutomationIntegration.create({
        id: uuidv7(),
        workspace_id: workspaceId,
        type: 'github',
        ...base,
        status: 'disconnected',
        last_checked_at: null,
        error: null,
        last_used_at: null,
        created_at: now,
      });
    }
    return this.checkGitHub(workspaceId);
  }

  async checkGitHub(workspaceId: string): Promise<AutomationIntegration> {
    const integration = await this.github(workspaceId);
    if (!integration?.secretKey) throw new Error('GitHub integration is not configured.');
    const checkedAt = new Date();
    try {
      await githubAutomationAdapter.validate({
        owner: String(integration.config.owner ?? ''),
        repo: String(integration.config.repo ?? ''),
        secretKey: integration.secretKey,
      });
      await AgentAutomationIntegration.query().where('id', integration.id).update({
        status: 'connected', error: null, last_checked_at: checkedAt, updated_at: checkedAt,
      });
    } catch (error) {
      await AgentAutomationIntegration.query().where('id', integration.id).update({
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
        last_checked_at: checkedAt,
        updated_at: checkedAt,
      });
    }
    const updated = await AgentAutomationIntegration.find(integration.id);
    if (!updated) throw new Error('GitHub integration disappeared during validation.');
    return mapIntegration(updated);
  }

  async remove(workspaceId: string, id: string): Promise<boolean> {
    const deleted = await AgentAutomationIntegration.query().where('workspace_id', workspaceId).where('id', id).delete();
    return deleted > 0;
  }
}

export const automationIntegrationService = new AutomationIntegrationService();
