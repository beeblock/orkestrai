import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSvelarTest } from '@beeblock/svelar/testing';
import { uuidv7 } from '@beeblock/svelar/support';
import { ControlCenterService, controlCenterService } from '$lib/modules/agent-room/application/services/ControlCenterService.js';
import { ControlCenterController } from '$lib/modules/agent-room/interface/http/controllers/ControlCenterController.js';
import { controlCenterRepository } from '$lib/modules/agent-room/infrastructure/repositories/ControlCenterRepository.js';
import { workspaceRepository } from '$lib/modules/agent-room/infrastructure/repositories/WorkspaceRepository.js';
import { AgentMessageDelivery } from '$lib/modules/agent-room/domain/models/AgentMessageDelivery.js';

describe('control center status and audit projections', () => {
  useSvelarTest({ refreshDatabase: true });
  afterEach(() => vi.restoreAllMocks());

  it('validates status-only and explicit full-audit queries before invoking the service', async () => {
    const snapshot = vi.spyOn(controlCenterService, 'snapshot').mockResolvedValue({} as never);
    const controller = new ControlCenterController();
    const event = (query = '') => ({ params: { id: 'workspace' }, url: new URL(`http://localhost/control-center${query}`) });
    expect((await controller.show(event('?communications=0'))).status).toBe(200);
    expect(snapshot).toHaveBeenLastCalledWith('workspace', false, 'compact');
    await controller.show(event('?projection=full'));
    expect(snapshot).toHaveBeenLastCalledWith('workspace', true, 'full');
    await controller.show(event());
    expect(snapshot).toHaveBeenLastCalledWith('workspace', true, 'compact');
    snapshot.mockClear();
    for (const query of ['?communications=false', '?communications=2', '?projection=unknown']) {
      expect((await controller.show(event(query))).status).toBe(400);
    }
    expect(snapshot).not.toHaveBeenCalled();
  });

  it('keeps a 1,200-event retry history out of live status while retaining the full audit and current result', async () => {
    const service = new ControlCenterService();
    const workspace = await workspaceRepository.createWorkspace({ name: 'large retry history', workingDir: '/tmp' });
    const agent = await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'terminal', title: 'Leader' });
    await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'note', title: 'Large note', payload: { content: 'Do not load in status '.repeat(1000) } as never });
    const messageId = uuidv7(), started = Date.now() - 1_200_000;
    const body = 'Owner task '.repeat(750), batchPrompt = 'Repeated dispatch context '.repeat(500);
    const rows = Array.from({ length: 1200 }, (_, index) => ({ id: uuidv7(), message_id: messageId,
      workspace_id: workspace.id, from_node_id: null, to_node_id: agent.id,
      state: index === 1199 ? 'failed' : index === 1198 ? 'replied' : index % 2 ? 'queued' : 'sent',
      content: body, reply: index === 1198 ? 'Earlier confirmed answer' : null,
      error: index === 1199 ? 'Delivery was not confirmed' : null,
      metadata_json: JSON.stringify({ kind: 'leader_supervision', batchPrompt }),
      created_at: new Date(started + index * 1000).toISOString() }));
    for (let index = 0; index < rows.length; index += 100) {
      await AgentMessageDelivery.query().insertMany(rows.slice(index, index + 100));
    }
    const timings: Record<string, { bytes: number; milliseconds: number }> = {};
    const measure = async (name: string, communications: boolean, projection: 'full' | 'compact') => {
      const start = performance.now();
      const snapshot = await service.snapshot(workspace.id, communications, projection);
      const json = JSON.stringify(snapshot);
      timings[name] = { bytes: Buffer.byteLength(json), milliseconds: Math.round((performance.now() - start) * 100) / 100 };
      return snapshot;
    };
    const full = await measure('full', true, 'full');
    const compact = await measure('compact', true, 'compact');
    const reads = vi.spyOn(controlCenterRepository, 'listDeliveries');
    const allNodes = vi.spyOn(workspaceRepository, 'listNodes');
    const lean = await measure('status', false, 'compact');
    expect(reads).not.toHaveBeenCalled();
    expect(allNodes).toHaveBeenCalledWith(workspace.id, undefined, false, false, true);
    expect(lean.communications).toEqual([]);
    expect(lean.communicationsProjection).toBe('none');
    expect(compact.agents).toEqual(full.agents);
    expect(lean.agents).toEqual(full.agents);
    expect(lean.counts).toEqual(full.counts);
    const thread = compact.communications[0];
    expect(thread).toMatchObject({ content: body, reply: 'Earlier confirmed answer',
      error: 'Delivery was not confirmed', state: 'failed', eventDetailsOmitted: true });
    expect(thread.events).toHaveLength(1200);
    expect(thread.events.map(item => [item.id, item.state, item.createdAt]))
      .toEqual(full.communications[0].events.map(item => [item.id, item.state, item.createdAt]));
    expect(thread.events.every(item => item.content === '' && item.reply === null && item.error === null
      && JSON.stringify(item.metadata) === JSON.stringify({ kind: 'leader_supervision' }))).toBe(true);
    expect(full.communications[0].events[0].metadata.batchPrompt).toBe(batchPrompt);
    expect((await AgentMessageDelivery.find(rows[0].id))!.getAttribute('metadata_json')).toBe(rows[0].metadata_json);
    expect(timings.full.bytes).toBeGreaterThan(20_000_000);
    expect(timings.compact.bytes).toBeLessThan(timings.full.bytes / 30);
    expect(timings.status.bytes).toBeLessThan(4096);
    console.log('[control-center-projection]', JSON.stringify(timings));
  });

  it('bounds the origin discriminator and tolerates malformed legacy metadata', async () => {
    const workspace = await workspaceRepository.createWorkspace({ name: 'legacy metadata', workingDir: '/tmp' });
    const agent = await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'terminal' });
    const values = [null, '{broken', JSON.stringify({ kind: { batch: 'untrusted' } }), JSON.stringify({ kind: 'x'.repeat(1000) })];
    for (const metadata of values) {
      await AgentMessageDelivery.create({ id: uuidv7(), message_id: uuidv7(), workspace_id: workspace.id,
        from_node_id: null, to_node_id: agent.id, state: 'queued', content: 'Owner message',
        reply: null, error: null, metadata_json: metadata, created_at: new Date().toISOString() });
    }
    const projected = await controlCenterRepository.listDeliveries(workspace.id, 1200, 'compact');
    expect(projected.map(event => event.metadata)).toEqual([{}, {}, {}, { kind: 'x'.repeat(80) }]);
    const full = await controlCenterRepository.listDeliveries(workspace.id);
    expect(full[3].metadata.kind).toBe('x'.repeat(1000));
  });
});
