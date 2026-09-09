import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { uuidv7 } from '@beeblock/svelar/support';
import { describe, expect, it } from 'vitest';
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

  it('publishes bounded manifests and rejects an insecure webhook', () => {
    expect(publicIntegrationCatalog().map((item) => item.id)).toEqual(['github', 'gmail', 'slack', 'telegram', 'whatsapp', 'webhook']);
    expect(() => integrationConnectionSchema.parse({
      type: 'webhook', name: 'Unsafe', secretRefs: [], permissions: ['webhook.send'], enabled: true,
      config: { url: 'http://example.com/hook', method: 'POST', authScheme: 'none' },
    })).toThrow();
  });

  it('resolves a token only inside the adapter and deduplicates external delivery', async () => {
    const root = await mkdtemp(join(tmpdir(), 'orkestrai-integration-'));
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

    expect(first).toMatchObject({ duplicate: false, channel: 'C123' });
    expect(duplicate).toMatchObject({ duplicate: true, channel: 'C123' });
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
