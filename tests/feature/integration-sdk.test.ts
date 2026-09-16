import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { uuidv7 } from '@beeblock/svelar/support';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useSvelarTest } from '@beeblock/svelar/testing';
import { integrationConnectionSchema } from '$lib/modules/agent-room/contracts/schemas/integration.schema.js';
import { publicIntegrationCatalog } from '$lib/modules/agent-room/application/catalogs/IntegrationCatalog.js';
import { IntegrationExecutionService } from '$lib/modules/agent-room/application/services/IntegrationExecutionService.js';
import { autonomyPolicyService } from '$lib/modules/agent-room/application/services/AutonomyPolicyService.js';
import { secretRefService } from '$lib/modules/agent-room/application/services/SecretRefService.js';
import { AgentAutomationIntegration } from '$lib/modules/agent-room/domain/models/AgentAutomationIntegration.js';
import { AgentIntegrationEvent } from '$lib/modules/agent-room/domain/models/AgentIntegrationEvent.js';
import { workspaceRepository } from '$lib/modules/agent-room/infrastructure/repositories/WorkspaceRepository.js';

describe('Integration SDK', () => {
  useSvelarTest({ refreshDatabase: true });
  const roots: string[] = [];
  const vaultState = globalThis as typeof globalThis & { __orkestraiHostVaultResolve?: (reference: string) => Promise<string | null> };
  let previousVaultResolve: typeof vaultState.__orkestraiHostVaultResolve;
  beforeEach(() => { previousVaultResolve = vaultState.__orkestraiHostVaultResolve; });
  afterEach(async () => {
    if (previousVaultResolve) vaultState.__orkestraiHostVaultResolve = previousVaultResolve;
    else delete vaultState.__orkestraiHostVaultResolve;
    for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
  });

  async function webhookFixture(http: { request: (...args: any[]) => Promise<any> }) {
    const root = await mkdtemp(join(tmpdir(), 'orkestrai-delivery-'));
    roots.push(root);
    const workspace = await workspaceRepository.createWorkspace({ name: 'Delivery', workingDir: root });
    const integrationId = uuidv7(), now = new Date();
    await AgentAutomationIntegration.create({
      id: integrationId, workspace_id: workspace.id, type: 'webhook', name: 'Test channel',
      config_json: JSON.stringify({ url: 'https://example.com/hooks/test', method: 'POST', authScheme: 'none' }),
      secret_key: null, manifest_version: '1.0.0', secret_refs_json: '[]',
      permissions_json: '["webhook.send"]', enabled: true, status: 'connected',
      last_checked_at: now, last_used_at: null, error: null, created_at: now, updated_at: now,
    });
    return {
      workspace, integrationId, service: new IntegrationExecutionService(http as never),
      request: { integrationId, action: 'webhook.send', input: { payload: { text: 'private message' } }, idempotencyKey: 'delivery:test:1' },
      context: { actorType: 'automation' as const, actorId: 'test-delivery' },
    };
  }

  it('never repeats an uncertain publication or exposes an echoed credential', async () => {
    let calls = 0;
    const f = await webhookFixture({ request: async () => { calls++; throw new Error('lost response with private-secret-12345'); } });
    await expect(f.service.execute(f.workspace.id, f.request, f.context)).rejects.toThrow('uncertain');
    await expect(f.service.execute(f.workspace.id, f.request, f.context)).rejects.toThrow('uncertain');
    expect(calls).toBe(1);
    const events = await f.service.listEvents(f.workspace.id);
    expect(events[0]).toMatchObject({ status: 'uncertain', deliveryState: 'uncertain', receipt: null });
    expect(JSON.stringify(events)).not.toContain('private-secret');
    expect(JSON.stringify(await autonomyPolicyService.listAudit(f.workspace.id))).not.toContain('private-secret');
  });

  it('binds each idempotency key to the exact normalized operation', async () => {
    let calls = 0;
    const f = await webhookFixture({ request: async () => { calls++; return { ok: true, status: 202, json: {} }; } });
    const first = await f.service.execute(f.workspace.id, f.request, f.context);
    expect(first).toMatchObject({ receipt: { state: 'accepted', evidence: 'http_response', messageIds: [] } });
    await expect(f.service.execute(f.workspace.id, { ...f.request, input: { payload: { text: 'different message' } } }, f.context)).rejects.toThrow('another');
    expect(calls).toBe(1);
    expect((await f.service.listEvents(f.workspace.id))[0]).toMatchObject({ deliveryState: 'accepted' });
  });

  it('allows only one concurrent sender for a given key', async () => {
    let started!: () => void, finish!: () => void, calls = 0;
    const ready = new Promise<void>(resolve => { started = resolve; });
    const hold = new Promise<void>(resolve => { finish = resolve; });
    const f = await webhookFixture({ request: async () => { calls++; started(); await hold; return { ok: true, status: 200, json: {} }; } });
    const pending = f.service.execute(f.workspace.id, f.request, f.context);
    await ready;
    try { await expect(f.service.execute(f.workspace.id, f.request, f.context)).rejects.toThrow('in progress'); }
    finally { finish(); }
    await pending;
    expect(calls).toBe(1);
  });

  it('does not dispatch when the owner revokes the account during credential resolution', async () => {
    let calls = 0;
    const f = await webhookFixture({ request: async () => { calls++; return { ok: true, status: 202, json: {} }; } });
    const secret = await secretRefService.create(f.workspace.id, {
      name: 'Test webhook', purpose: 'Delivery regression', provider: 'host_vault',
      bindings: { integrations: ['webhook'], operations: ['webhook.send'], destinations: ['example.com'] },
    });
    await AgentAutomationIntegration.query().where('id', f.integrationId).update({
      config_json: JSON.stringify({ url: 'https://example.com/hooks/test', method: 'POST', authScheme: 'bearer' }),
      secret_refs_json: JSON.stringify([secret.ref]),
    });
    vaultState.__orkestraiHostVaultResolve = async reference => {
      if (reference !== secret.ref) return null;
      await AgentAutomationIntegration.query().where('id', f.integrationId).update({ enabled: false });
      return 'private-regression-secret';
    };
    await expect(f.service.execute(f.workspace.id, f.request, f.context)).rejects.toThrow('before publication');
    expect(calls).toBe(0);
    const events = await f.service.listEvents(f.workspace.id);
    expect(events[0]).toMatchObject({ status: 'failed', deliveryState: 'not_submitted' });
    expect(JSON.stringify(events)).not.toContain('private-regression-secret');
    // A confirmed pre-dispatch rejection remains retryable after authorization
    // is restored, unlike an uncertain publication.
    await AgentAutomationIntegration.query().where('id', f.integrationId).update({ enabled: true });
    vaultState.__orkestraiHostVaultResolve = async reference => reference === secret.ref ? 'private-regression-secret' : null;
    expect(await f.service.execute(f.workspace.id, f.request, f.context)).toMatchObject({ duplicate: false, receipt: { state: 'accepted' } });
    expect(calls).toBe(1);
  });

  it('claims a new request atomically when two service instances start together', async () => {
    let calls = 0;
    const http = { request: async () => { calls++; return { ok: true, status: 202, json: {} }; } };
    const f = await webhookFixture(http);
    const results = await Promise.allSettled([
      f.service.execute(f.workspace.id, f.request, f.context),
      new IntegrationExecutionService(http as never).execute(f.workspace.id, f.request, f.context),
    ]);
    expect(results.some(result => result.status === 'fulfilled')).toBe(true);
    expect(calls).toBe(1);
    expect(await AgentIntegrationEvent.query().where('integration_id', f.integrationId).count()).toBe(1);
  });

  it('does not replay an interrupted dispatch after creating another service instance', async () => {
    let calls = 0;
    const http = { request: async () => { calls++; return { ok: true, status: 200, json: {} }; } };
    const f = await webhookFixture(http);
    await f.service.execute(f.workspace.id, f.request, f.context);
    await AgentIntegrationEvent.query().where('integration_id', f.integrationId).update({ status: 'dispatching', payload_json: null });
    await expect(new IntegrationExecutionService(http as never).execute(f.workspace.id, f.request, f.context)).rejects.toThrow('uncertain');
    expect(calls).toBe(1);
  });

  it('does not guess request identity for historical events without a digest', async () => {
    let calls = 0;
    const f = await webhookFixture({ request: async () => { calls++; return { ok: true, status: 200, json: {} }; } });
    await f.service.execute(f.workspace.id, f.request, f.context);
    await AgentIntegrationEvent.query().where('integration_id', f.integrationId).update({ request_digest: null, status: 'failed' });
    await expect(f.service.execute(f.workspace.id, f.request, f.context)).rejects.toThrow('legacy');
    expect((await f.service.listEvents(f.workspace.id))[0].deliveryState).toBe('unknown');
    expect(calls).toBe(1);
  });

  it('publishes bounded manifests and rejects an insecure webhook', () => {
    expect(publicIntegrationCatalog().map((item) => item.id)).toEqual(['github', 'gmail', 'slack', 'telegram', 'whatsapp', 'webhook']);
    expect(() => integrationConnectionSchema.parse({
      type: 'webhook', name: 'Unsafe', secretRefs: [], permissions: ['webhook.send'], enabled: true,
      config: { url: 'http://example.com/hook', method: 'POST', authScheme: 'none' },
    })).toThrow();
  });

  it('resolves a token only inside the adapter and deduplicates external delivery', async () => {
    const root = await mkdtemp(join(tmpdir(), 'orkestrai-integration-'));
    roots.push(root);
    const workspace = await workspaceRepository.createWorkspace({ name: 'Integration', workingDir: root });
    const secret = await secretRefService.create(workspace.id, {
      name: 'Slack bot', purpose: 'Reports', provider: 'host_vault',
      bindings: { integrations: ['slack'], operations: ['slack.send_message'], destinations: ['slack.com'] },
    });
    const state = globalThis as typeof globalThis & { __orkestraiHostVaultResolve?: (reference: string) => Promise<string | null> };
    state.__orkestraiHostVaultResolve = async (reference) => reference === secret.ref ? 'unit-test-secret' : null;
    const integrationId = uuidv7();
    const now = new Date();
    await AgentAutomationIntegration.create({
      id: integrationId, workspace_id: workspace.id, type: 'slack', name: 'Team Slack',
      config_json: JSON.stringify({ defaultChannel: 'C123' }), secret_key: null,
      manifest_version: '1.0.0', secret_refs_json: JSON.stringify([secret.ref]),
      permissions_json: JSON.stringify(['slack.send_message']), enabled: true, status: 'connected',
      last_checked_at: now, last_used_at: null, error: null, created_at: now, updated_at: now,
    });
    let calls = 0;
    const http = { request: async (_url: string, init: RequestInit) => {
      calls += 1;
      expect((init.headers as Record<string, string>).authorization).toBe('Bearer unit-test-secret');
      return { ok: true, status: 200, json: { ok: true, channel: 'C123', ts: '123.45', message: { text: 'private report body' } } };
    } };
    const service = new IntegrationExecutionService(http as never);
    const request = { integrationId, action: 'slack.send_message', input: { text: 'private report body' }, idempotencyKey: 'task:daily-report:1' };
    const first = await service.execute(workspace.id, request, { actorType: 'automation', actorId: 'daily-report' });
    const duplicate = await service.execute(workspace.id, request, { actorType: 'automation', actorId: 'daily-report' });

    expect(first).toMatchObject({ duplicate: false, channel: 'C123', receipt: { state: 'accepted', messageIds: ['123.45'] } });
    expect(duplicate).toMatchObject({ duplicate: true, channel: 'C123', receipt: { state: 'accepted', messageIds: ['123.45'] } });
    expect(calls).toBe(1);
    const event = await AgentIntegrationEvent.query().where('integration_id', integrationId).first();
    expect(String(event?.getAttribute('payload_json'))).not.toContain('private report body');
    const audit = await autonomyPolicyService.listAudit(workspace.id);
    expect(JSON.stringify(audit)).not.toContain('private report body');
    expect(JSON.stringify(audit)).not.toContain('unit-test-secret');
    expect(await autonomyPolicyService.verifyAudit(workspace.id)).toMatchObject({ valid: true });
    delete state.__orkestraiHostVaultResolve;
  });
});
