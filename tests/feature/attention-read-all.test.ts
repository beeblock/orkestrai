import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSvelarTest } from '@beeblock/svelar/testing';
import { uuidv7 } from '@beeblock/svelar/support';
import { AgentAttentionItem } from '$lib/modules/agent-room/domain/models/AgentAttentionItem.js';
import { attentionRepository } from '$lib/modules/agent-room/infrastructure/repositories/AttentionRepository.js';
import { workspaceRepository } from '$lib/modules/agent-room/infrastructure/repositories/WorkspaceRepository.js';
import { attentionService } from '$lib/modules/agent-room/application/services/AttentionService.js';
import { bridgeService } from '$lib/modules/agent-room/application/services/BridgeService.js';
import { ptySessionManager } from '$lib/modules/agent-room/infrastructure/pty/PtySessionManager.js';
import { BridgeController } from '$lib/modules/agent-room/interface/http/controllers/BridgeController.js';

async function fixture() {
  return workspaceRepository.createWorkspace({ name: 'Attention read fixture', workingDir: process.cwd() });
}
async function item(workspaceId: string, values: Record<string, unknown> = {}) {
  const now = new Date().toISOString();
  return AgentAttentionItem.create({ id: uuidv7(), workspace_id: workspaceId, category: 'message', severity: 'info', status: 'open', title: 'Unread', created_at: now, updated_at: now, ...values });
}

describe('mark all attention items as read', () => {
  useSvelarTest({ refreshDatabase: true });
  afterEach(() => { vi.restoreAllMocks(); delete (globalThis as any).__orkestraiBroadcast; });
  it('acknowledges every unread item beyond the visible page without resolving or deciding anything', async () => {
    const first = await fixture();
    const second = await fixture();
    for (let i = 0; i < 305; i++) await item(first.id);
    const question = await item(second.id, { source_type: 'owner_question', source_id: uuidv7(), action_json: JSON.stringify({ question: true, options: ['Yes', 'No'] }) });
    const approval = await item(second.id, { category: 'review', source_type: 'approval', source_id: uuidv7() });
    const snoozed = await item(first.id, { status: 'snoozed', snoozed_until: '2099-01-01T00:00:00.000Z' });
    const resolved = await item(first.id, { status: 'resolved', resolved_at: new Date().toISOString() });
    const broadcast = vi.fn();
    (globalThis as any).__orkestraiBroadcast = broadcast;
    expect(await attentionService.markAllRead({})).toMatchObject({ count: 307 });
    expect(broadcast).toHaveBeenCalledTimes(2);
    expect(await AgentAttentionItem.query().where('status', 'read').count()).toBe(307);
    for (const record of [question, approval]) {
      const after = await AgentAttentionItem.find(record.id);
      expect(after?.getAttribute('status')).toBe('read');
      expect(after?.getAttribute('resolved_at')).toBeNull();
      expect(after?.getAttribute('source_id')).toBe(record.getAttribute('source_id'));
      expect(after?.getAttribute('action_json')).toBe(record.getAttribute('action_json') ?? null);
    }
    expect((await AgentAttentionItem.find(snoozed.id))?.status).toBe('snoozed');
    expect((await AgentAttentionItem.find(resolved.id))?.status).toBe('resolved');
    expect(await attentionService.markAllRead({})).toMatchObject({ count: 0 });
  });
  it('scopes workspace reads and makes concurrent acknowledgements idempotent', async () => {
    const first = await fixture(); const second = await fixture();
    const one = await item(first.id); const two = await item(second.id);
    const results = await Promise.all([attentionRepository.markAllRead(first.id), attentionRepository.markAllRead(first.id)]);
    expect(results.reduce((sum, result) => sum + result.count, 0)).toBe(1);
    expect((await AgentAttentionItem.find(one.id))?.status).toBe('read');
    expect((await AgentAttentionItem.find(two.id))?.status).toBe('open');
  });
  it('requires a live agent token and cannot acknowledge another workspace through the bridge', async () => {
    const first = await fixture(); const second = await fixture();
    await item(first.id); await item(second.id);
    vi.spyOn(bridgeService, 'resolveWorkspaceByToken').mockResolvedValue(first);
    const actor = vi.spyOn(ptySessionManager, 'resolveBridgeAgent').mockReturnValue(null);
    const event = (body: unknown) => ({ params: {}, url: new URL('http://localhost/api'), request: new Request('http://localhost/api', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer fixture', 'x-orkestrai-agent-token': 'fixture' }, body: JSON.stringify(body) }) });
    const controller = new BridgeController();
    expect((await controller.attentionMarkAllRead(event({}))).status).toBe(403);
    actor.mockReturnValue('real-agent');
    expect((await controller.attentionMarkAllRead(event({ workspaceId: second.id }))).status).toBe(403);
    expect((await controller.attentionMarkAllRead(event({ from: 'leader' }))).status).toBeGreaterThanOrEqual(400);
    const response = await controller.attentionMarkAllRead(event({}));
    expect(response.status).toBe(200);
    expect((await response.json()).data.count).toBe(1);
    expect(await AgentAttentionItem.query().where('workspace_id', second.id).where('status', 'open').count()).toBe(1);
  });
});
