import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSvelarTest } from '@beeblock/svelar/testing';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { ComputerObservationService, watchSignature } from '$lib/modules/agent-room/application/services/ComputerObservationService.js';
import { computerService } from '$lib/modules/agent-room/application/services/ComputerService.js';
import { routineService } from '$lib/modules/agent-room/application/services/RoutineService.js';
import { taskBoardService } from '$lib/modules/agent-room/application/services/TaskBoardService.js';
import { autonomyPolicyService } from '$lib/modules/agent-room/application/services/AutonomyPolicyService.js';
import { workspaceRepository } from '$lib/modules/agent-room/infrastructure/repositories/WorkspaceRepository.js';
import { computerNodeConfigSchema, computerWatchSchema } from '$lib/modules/agent-room/contracts/schemas/computer.schema.js';
import { automationFormSchema } from '$lib/modules/agent-room/contracts/schemas/automation.schema.js';
import { computerInboxService } from '$lib/modules/agent-room/application/services/ComputerInboxService.js';
import { computerInboxRepository } from '$lib/modules/agent-room/infrastructure/repositories/ComputerInboxRepository.js';
import { ptySessionManager } from '$lib/modules/agent-room/infrastructure/pty/PtySessionManager.js';
import { uuidv7 } from '@beeblock/svelar/support';

const folders: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true }); });
async function setup(mode: 'auto' | 'visual' = 'visual') {
  const folder = await mkdtemp(join(tmpdir(), 'orkestrai-watch-test-')); folders.push(folder);
  const workspace = await workspaceRepository.createWorkspace({ name: 'App observation', workingDir: folder });
  const agent = await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'terminal', title: 'Operator', payload: { provider: 'codex' } });
  const task = await taskBoardService.create(workspace.id, { title: 'Watch authorized app', assigneeNodeId: agent.id, dispatch: false });
  const routine = await routineService.createAutomation(workspace.id, automationFormSchema.parse({ name: 'Local changes', triggerType: 'manual', actionType: 'prompt_agent', targetNodeId: agent.id, prompt: 'Inspect changes; never send without validation.' }));
  const policy = await autonomyPolicyService.get(workspace.id);
  await autonomyPolicyService.update(workspace.id, { enabled: true, mode: 'bounded', policy: { ...policy.policy, capabilities: ['computer', 'agent'], allowedApps: ['com.example.app'] } });
  const watch = computerWatchSchema.parse({ mode, enabled: true, windowId: 'app:1', applicationId: 'com.example.app', routineId: routine.id, taskId: task.id });
  const config = computerNodeConfigSchema.parse({ enabled: true, allowedApplications: ['com.example.app'], watch });
  const node = await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'computer', payload: { computerConfig: config } });
  return { folder, workspace, agent, task, routine, watch, config, node, observer: new ComputerObservationService() };
}

describe('Computer observation lifecycle', () => {
  useSvelarTest({ refreshDatabase: true });

  it('reopens the approved conversation automatically instead of dropping the watch or waking the model to search', async () => {
    const s = await setup('auto');
    const grantId = uuidv7();
    vi.spyOn(computerService, 'observeAccessibility').mockResolvedValueOnce({ state: 'navigation_required', tree: null, grantId });
    const navigate = vi.spyOn(computerService, 'execute').mockResolvedValue({ kind: 'action', completed: true } as never);
    const enqueue = vi.spyOn(routineService, 'enqueueComputerObservation');
    await s.observer.tick();
    expect(navigate).toHaveBeenCalledExactlyOnceWith(s.workspace.id, { command: 'open_conversation', targetId: s.watch.windowId, grantId },
      expect.objectContaining({ actorType: 'automation', actorId: s.routine.id, taskId: s.task.id, assertRelevant: expect.any(Function) }));
    expect(s.observer.status(s.workspace.id)).toMatchObject({ state: 'navigating', error: null });
    expect(enqueue).not.toHaveBeenCalled();
    expect((await workspaceRepository.getNode(s.node.id))?.payload.computerConfig.watch.enabled).toBe(true);
  });

  it('queues every scoped question while the agent is busy and dispatches consecutive batches', async () => {
    const { workspace, observer, agent, node, config, task } = await setup('auto');
    const policy = await autonomyPolicyService.get(workspace.id);
    const grant = { id: uuidv7(), enabled: true, nodeId: node.id, agentId: agent.id, taskId: task.id, applicationId: 'com.example.app',
      recipient: { id: '0.0.0', role: 'AXButton', name: 'Contact' }, composer: { id: '0.0.1', role: 'AXTextArea', name: 'Message' }, send: { id: '0.0.2', role: 'AXButton', name: 'Send' }, incomingMarker: 'Received:', maxCharacters: 2000, maxPerHour: 60, memoryEnabled: false, memoryRetentionDays: 365, allowProactive: false };
    await autonomyPolicyService.update(workspace.id, { enabled: true, mode: 'bounded', policy: { ...policy.policy, computerReplyGrants: [grant] } });
    await workspaceRepository.updateNode(node.id, { payload: { computerConfig: { ...config, watch: { ...config.watch, cooldownSeconds: 1, replyGrantId: grant.id } } } });
    let now = Date.now(); vi.spyOn(Date, 'now').mockImplementation(() => now);
    let busy = false;
    vi.spyOn(ptySessionManager, 'listLiveForNode').mockImplementation(() => [{ waiting: !busy }] as never);
    const tree = { available: true, truncated: false, elements: [] as any[] };
    vi.spyOn(computerService, 'observeAccessibility').mockResolvedValue({ state: 'read', tree });
    const captures = vi.spyOn(computerService, 'observeWindow');
    const enqueue = vi.spyOn(routineService, 'enqueueComputerObservation').mockResolvedValue(true);
    await observer.tick(); now += 1000; busy = true;
    for (let i = 0; i < 10; i++) {
      tree.elements.push({ id: `0.0.${i + 3}`, role: 'AXStaticText', name: `Received: question ${i}`, value: '', protected: false, enabled: true, focused: false, actions: [] });
      await observer.tick(); now += 1000;
    }
    expect(enqueue).not.toHaveBeenCalled();
    expect(observer.status(workspace.id).pendingMessages).toBe(10);
    busy = false; await observer.tick(); now += 1000;
    const first = JSON.parse(observer.eventContent(workspace.id, enqueue.mock.calls[0][2].eventId)!).reply;
    expect(first.messages).toHaveLength(10);
    await computerInboxService.acknowledge(workspace.id, grant, first.batchId, first.inReplyToDigest, 'replied');
    for (let round = 1; round <= 2; round++) {
      tree.elements.push({ ...tree.elements[0], id: `0.0.${round + 20}`, name: `Received: follow-up ${round}` });
      await observer.tick(); now += 1000; await observer.tick(); now += 1000;
      const batch = JSON.parse(observer.eventContent(workspace.id, enqueue.mock.calls[round][2].eventId)!).reply;
      expect(batch.messages.map((m: any) => m.text)).toEqual([`Received: follow-up ${round}`]);
      await computerInboxService.acknowledge(workspace.id, grant, batch.batchId, batch.inReplyToDigest, 'replied');
    }
    expect(enqueue).toHaveBeenCalledTimes(3); expect(captures).not.toHaveBeenCalled();
    expect((await computerInboxRepository.read(workspace.id, grant.id))?.messages.every(m => m.status === 'replied')).toBe(true);
    const restored = new ComputerObservationService(); await restored.tick();
    expect(enqueue).toHaveBeenCalledTimes(3);
  });

  it('delivers a settled native change in two seconds without a single capture, then expires transient text', async () => {
    const { workspace, observer } = await setup('auto');
    let now = Date.now(); vi.spyOn(Date, 'now').mockImplementation(() => now);
    const tree = { available: true, truncated: false, elements: [{ id: '0.0', role: 'text', name: 'Chat', value: 'initial', protected: false, enabled: true, focused: false, actions: [] }] };
    vi.spyOn(computerService, 'observeAccessibility').mockImplementation(async (_workspace, _window, _app, check) => { await check(); return { state: 'read', tree } as never; });
    const captures = vi.spyOn(computerService, 'observeWindow');
    const enqueue = vi.spyOn(routineService, 'enqueueComputerObservation').mockResolvedValue(true);
    await observer.tick(); now += 1000;
    await observer.tick(); now += 1000;
    expect(enqueue).not.toHaveBeenCalled();
    tree.elements[0].value = 'new-private-message';
    await observer.tick(); now += 1000;
    await observer.tick(); now += 1000;
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(captures).not.toHaveBeenCalled();
    const event = enqueue.mock.calls[0][2];
    expect(event.source).toBe('accessibility');
    expect(event.evidencePath).toBeUndefined();
    expect(JSON.stringify(event)).not.toContain('new-private-message');
    expect(observer.eventContent(workspace.id, event.eventId)).toContain('new-private-message');
    await observer.tick();
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(observer.status(workspace.id)).toMatchObject({ source: 'accessibility', notifications: 1 });
    now += 120_001;
    expect(observer.eventContent(workspace.id, event.eventId)).toBeNull();
  });

  it('does not poll unsupported accessibility every tick or take screenshots while native input is busy', async () => {
    const { workspace, observer } = await setup('auto');
    let now = Date.now(); vi.spyOn(Date, 'now').mockImplementation(() => now);
    const native = vi.spyOn(computerService, 'observeAccessibility').mockResolvedValue({ state: 'waiting_agent', tree: null });
    const captures = vi.spyOn(computerService, 'observeWindow').mockResolvedValue({ state: 'waiting_focus', capture: null });
    await observer.tick(); now += 1000;
    expect(captures).not.toHaveBeenCalled();
    expect(observer.status(workspace.id).state).toBe('waiting_agent');
    native.mockResolvedValue({ state: 'unsupported', tree: null });
    await observer.tick(); now += 4000;
    await observer.tick();
    expect(native).toHaveBeenCalledTimes(2);
    expect(captures).toHaveBeenCalledTimes(2);
  });

  it('does not call an agent on initial/unchanged frames, coalesces a settled change and honors pause', async () => {
    const { folder, workspace, observer, node, config } = await setup();
    const path = join(folder, 'frame.png');
    const frame = new PNG({ width: 64, height: 64 }); frame.data.fill(255); await writeFile(path, PNG.sync.write(frame));
    let now = Date.now(); vi.spyOn(Date, 'now').mockImplementation(() => now);
    const capture = vi.spyOn(computerService, 'observeWindow').mockImplementation(async (_workspace, _window, _app, accept, check) => {
      await check();
      return await accept(path) ? { state: 'changed', capture: { path: '.orkestrai/computer/observations/00000000-0000-7000-8000-000000000001.png', evidenceId: '00000000-0000-7000-8000-000000000001', width: 64, height: 64 } } : { state: 'unchanged', capture: null };
    });
    const enqueue = vi.spyOn(routineService, 'enqueueComputerObservation').mockResolvedValue(true);
    for (let i = 0; i < 3; i++) { await observer.tick(); now += 6000; }
    expect(enqueue).not.toHaveBeenCalled();
    expect(observer.status(workspace.id)).toMatchObject({ state: 'unchanged', checks: 3, notifications: 0 });
    frame.data.fill(0); await writeFile(path, PNG.sync.write(frame));
    await observer.tick(); now += 6000;
    expect(enqueue).not.toHaveBeenCalled();
    await observer.tick(); now += 6000;
    expect(enqueue).toHaveBeenCalledTimes(1);
    await observer.tick(); now += 6000;
    expect(enqueue).toHaveBeenCalledTimes(1);
    await workspaceRepository.updateNode(node.id, { payload: { computerConfig: { ...config, watch: { ...config.watch, enabled: false } } } });
    const calls = capture.mock.calls.length;
    await observer.tick();
    expect(capture).toHaveBeenCalledTimes(calls);
    expect(observer.status(workspace.id).state).toBe('paused');
  });

  it('revokes observation when the workspace unloads or the task loses its assignee', async () => {
    const { observer, workspace, watch, task } = await setup();
    const signature = watchSignature(watch);
    await expect(observer.assertCurrent(workspace.id, signature)).resolves.toBeUndefined();
    await workspaceRepository.setWorkspaceSuspended(workspace.id, true);
    await expect(observer.assertCurrent(workspace.id, signature)).rejects.toThrow('unloaded');
    await workspaceRepository.setWorkspaceSuspended(workspace.id, false);
    await taskBoardService.update(workspace.id, task.id, { assigneeNodeId: null });
    await expect(observer.assertCurrent(workspace.id, signature)).rejects.toThrow('active task');
  });

  it('requires explicit owner opt-in and never lets another agent take over a watch', async () => {
    const { observer, workspace, watch, agent, config, node } = await setup();
    await expect(observer.configure(workspace.id, watch, { actorType: 'agent', actorId: agent.id, taskId: watch.taskId! })).rejects.toThrow('owner');
    await workspaceRepository.updateNode(node.id, { payload: { computerConfig: { ...config, allowAgentWatch: true } } });
    await expect(observer.configure(workspace.id, watch, { actorType: 'agent', actorId: 'other-agent', taskId: watch.taskId! })).rejects.toThrow('own automation');
    await expect(observer.configure(workspace.id, watch, { actorType: 'agent', actorId: agent.id, taskId: watch.taskId! })).resolves.toBeUndefined();
  });
});
