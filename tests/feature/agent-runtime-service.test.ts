import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSvelarTest } from '@beeblock/svelar/testing';
import { agentRuntimeService, AgentRuntimeService, AgentRuntimePolicyError } from '$lib/modules/agent-room/application/services/AgentRuntimeService.js';
import { uuidv7 } from '@beeblock/svelar/support';
import { AgentBoardTask } from '$lib/modules/agent-room/domain/models/AgentBoardTask.js';
import { AgentFloor } from '$lib/modules/agent-room/domain/models/AgentFloor.js';
import { autonomyPolicyService } from '$lib/modules/agent-room/application/services/AutonomyPolicyService.js';
import { controlCenterService } from '$lib/modules/agent-room/application/services/ControlCenterService.js';
import { controlCenterRepository } from '$lib/modules/agent-room/infrastructure/repositories/ControlCenterRepository.js';
import { agentTerminalDeliveryService } from '$lib/modules/agent-room/application/services/AgentTerminalDeliveryService.js';
import * as transcript from '$lib/modules/agent-room/infrastructure/transcript/AgentTranscript.js';
import { usageService } from '$lib/modules/agent-room/application/services/UsageService.js';
import { workspaceRepository } from '$lib/modules/agent-room/infrastructure/repositories/WorkspaceRepository.js';
import { ptySessionManager } from '$lib/modules/agent-room/infrastructure/pty/PtySessionManager.ts';
import { routineService } from '$lib/modules/agent-room/application/services/RoutineService.js';

async function setup() {
  const workspace = await workspaceRepository.createWorkspace({ name: 'agent runtime', workingDir: '/tmp' });
  const node = await workspaceRepository.createNode({
    workspaceId: workspace.id,
    type: 'terminal',
    title: 'Background agent',
    payload: { command: '/bin/cat', provider: 'runtime-test' as never },
  });
  return { workspace, node };
}

async function supervisorTick(service: AgentRuntimeService) {
  const internal = service as unknown as { tick(): Promise<void>; leaderChecks: Map<string, AbortController> };
  await internal.tick();
  await vi.waitFor(() => expect(internal.leaderChecks.size).toBe(0));
}

async function setupLeader(status = 'todo') {
  const { workspace, node } = await setup();
  const sessionId = uuidv7();
  await workspaceRepository.updateNode(node.id, { payload: { ...node.payload, maestro: true, sessionId } });
  const session = {
    id: sessionId, workspaceId: workspace.id, nodeId: node.id, provider: 'runtime-test',
    command: '/bin/cat', args: [], cols: 80, rows: 24, cwd: '/tmp', runtimeKey: 'native',
    createdAt: new Date(Date.now() - 600_000).toISOString(),
    lastActivityAt: new Date(Date.now() - 180_000).toISOString(), exited: false, exitCode: null, waiting: true, hasOutput: true,
  };
  vi.spyOn(ptySessionManager, 'get').mockReturnValue(session);
  const ready = vi.spyOn(ptySessionManager, 'canAcceptAutomaticMessage').mockReturnValue(true);
  const complete = vi.spyOn(transcript, 'latestTurnComplete').mockResolvedValue(true);
  vi.spyOn(usageService, 'getAll').mockResolvedValue([]);
  const deliver = vi.spyOn(agentTerminalDeliveryService, 'deliver').mockResolvedValue();
  const taskId = uuidv7();
  await AgentBoardTask.query().insert({ id: taskId, workspace_id: workspace.id, title: 'Pending work', status,
    created_by: 'user', created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
  return { workspace, node, session, ready, complete, deliver, taskId };
}

describe('AgentRuntimeService', () => {
  useSvelarTest({ refreshDatabase: true });

  afterEach(() => {
    agentRuntimeService.stopSupervisor();
    routineService.stopScheduler();
    vi.useRealTimers();
    ptySessionManager.killAll();
    vi.restoreAllMocks();
  });

  it('keeps a completed board quiet even when Floors remain active for cleanup or promotion', async () => {
    const { workspace, deliver, complete } = await setupLeader('done');
    await AgentFloor.create({ id: uuidv7(), workspace_id: workspace.id, name: 'Pending integration', branch: 'orkestrai/pending', path: '/not-a-real-worktree', status: 'active' });
    await supervisorTick(new AgentRuntimeService());
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 5 * 60 * 60_000);
    await supervisorTick(new AgentRuntimeService());
    expect(deliver).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
    expect(usageService.getAll).not.toHaveBeenCalled();
  });

  it('cancels a reminder when the last card finishes even if a Floor remains active', async () => {
    const { workspace, deliver, taskId } = await setupLeader();
    await AgentFloor.create({ id: uuidv7(), workspace_id: workspace.id, name: 'Development', branch: 'orkestrai/dev', path: '/not-a-real-worktree', status: 'active' });
    deliver.mockImplementationOnce(async (input) => {
      await AgentBoardTask.query().where('id', taskId).update({ status: 'done' });
      expect(await input.isStillRelevant?.()).toBe(false);
      throw Object.assign(new Error('Obsolete'), { code: 'PTY_DELIVERY_OBSOLETE' });
    });
    await supervisorTick(new AgentRuntimeService());
    expect(deliver).toHaveBeenCalledTimes(1);
    await supervisorTick(new AgentRuntimeService());
    expect(deliver).toHaveBeenCalledTimes(1);
  });

  it('persists safeguards and wakes or sleeps the same resumable agent node', async () => {
    const { workspace, node } = await setup();
    const configured = await agentRuntimeService.configure(workspace.id, node.id, {
      mode: 'on_demand',
      idleMinutes: 45,
      concurrency: 2,
      usageLimit: 88,
    });
    expect(configured).toMatchObject({ mode: 'on_demand', idleMinutes: 45, concurrency: 2, usageLimit: 88, state: 'sleeping' });

    const awake = await agentRuntimeService.wake(workspace.id, node.id);
    expect(awake.state).toBe('awake');
    expect(awake.sessionId).toBeTruthy();
    expect(ptySessionManager.get(awake.sessionId!)).toMatchObject({ nodeId: node.id, workspaceId: workspace.id });

    const sleeping = await agentRuntimeService.sleep(workspace.id, node.id);
    expect(sleeping).toMatchObject({ state: 'sleeping', sessionId: null });
    const persisted = await workspaceRepository.getNode(node.id);
    expect(persisted?.payload).toMatchObject({
      agentRuntimeMode: 'on_demand',
      agentRuntimeIdleMinutes: 45,
      agentRuntimeConcurrency: 2,
      agentRuntimeUsageLimit: 88,
    });
  });

  it('keeps existing agents interactive by default', async () => {
    const { workspace, node } = await setup();
    await expect(agentRuntimeService.status(workspace.id, node.id)).resolves.toMatchObject({
      mode: 'interactive', idleMinutes: 30, concurrency: 1, usageLimit: 95, state: 'sleeping',
    });
  });

  it('keeps the Core alive and retries after a transient supervisor database failure', async () => {
    vi.useFakeTimers();
    const list = vi.spyOn(workspaceRepository, 'listWorkspaces')
      .mockRejectedValueOnce(new Error('database temporarily unavailable'))
      .mockResolvedValue([]);
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    agentRuntimeService.startSupervisor();
    await vi.advanceTimersByTimeAsync(0);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('Supervisor tick failed'));
    await vi.advanceTimersByTimeAsync(15_000);
    expect(list).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalledOnce();
  });

  it('keeps the Core alive and retries after a transient automation scheduler failure', async () => {
    vi.useFakeTimers();
    const tick = vi.spyOn(routineService, 'tick')
      .mockRejectedValueOnce(new Error('database temporarily unavailable'))
      .mockResolvedValue(undefined);
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    routineService.startScheduler();
    await vi.advanceTimersByTimeAsync(0);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('Scheduler tick failed'));
    await vi.advanceTimersByTimeAsync(15_000);
    expect(tick).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalledOnce();
  });

  it('blocks unattended work at the configured provider usage cap but permits a manual wake', async () => {
    const { workspace, node } = await setup();
    await agentRuntimeService.configure(workspace.id, node.id, {
      mode: 'on_demand', idleMinutes: 30, concurrency: 1, usageLimit: 80,
    });
    vi.spyOn(usageService, 'getAll').mockResolvedValue([{
      provider: 'runtime-test', plan: null, error: null, fetchedAt: new Date().toISOString(),
      windows: [{ kind: 'weekly', label: 'Weekly', usedPercent: 80, resetsAt: null }],
    }]);

    await expect(agentRuntimeService.assertAutomaticWorkAllowed(node.id)).rejects.toEqual(
      expect.objectContaining<Partial<AgentRuntimePolicyError>>({ code: 'AGENT_USAGE_LIMIT' }),
    );
    await expect(agentRuntimeService.wake(workspace.id, node.id, true)).resolves.toMatchObject({ state: 'awake' });
  });

  it('starts persistent agents immediately when the policy allows it', async () => {
    const { workspace, node } = await setup();
    vi.spyOn(usageService, 'getAll').mockResolvedValue([]);
    const configured = await agentRuntimeService.configure(workspace.id, node.id, {
      mode: 'persistent', idleMinutes: 30, concurrency: 1, usageLimit: 95,
    });
    expect(configured).toMatchObject({ mode: 'persistent', state: 'awake' });
  });

  it.each(['todo', 'doing'])('reminds an idle leader about %s once per board state, across five hours and supervisor restarts', async (status) => {
    const { workspace, node, deliver } = await setupLeader(status);
    await supervisorTick(new AgentRuntimeService());
    expect(deliver).toHaveBeenCalledOnce();
    expect(deliver.mock.calls[0][0].message).toContain('supervisao automatica do Kanban');
    expect(await controlCenterRepository.latestLeaderSupervision(workspace.id, node.id)).toMatchObject({ state: 'delivered', kind: 'leader_supervision' });
    await supervisorTick(new AgentRuntimeService());
    expect(deliver).toHaveBeenCalledOnce();
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now');
    for (let reminder = 1; reminder <= 60; reminder += 1) {
      clock.mockReturnValue(now + reminder * 5 * 60_000);
      await supervisorTick(new AgentRuntimeService());
    }
    expect(deliver).toHaveBeenCalledOnce();
  });

  it('does not repeat unchanged work after a PTY restart or a timestamp-only card update', async () => {
    const { workspace, node, taskId, session, deliver } = await setupLeader();
    await supervisorTick(new AgentRuntimeService());
    const receipt = await controlCenterRepository.latestLeaderSupervision(workspace.id, node.id);
    expect(receipt?.metadata.workFingerprint).toMatch(/^[a-f0-9]{64}$/);
    session.id = uuidv7();
    await workspaceRepository.updateNode(node.id, { payload: { ...node.payload, maestro: true, sessionId: session.id } });
    await AgentBoardTask.query().where('id', taskId).update({ updated_at: new Date().toISOString() });
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 360_000);
    await supervisorTick(new AgentRuntimeService());
    expect(deliver).toHaveBeenCalledOnce();
  });

  it.each(['title', 'description', 'assignee_node_id', 'status'])('allows a new reminder after a meaningful %s change, subject to cooldown', async (field) => {
    const { workspace, node, taskId, deliver } = await setupLeader();
    await supervisorTick(new AgentRuntimeService());
    const before = await controlCenterRepository.latestLeaderSupervision(workspace.id, node.id);
    await AgentBoardTask.query().where('id', taskId).update({ [field]: field === 'status' ? 'doing' : field === 'assignee_node_id' ? node.id : 'New authorized work' });
    await supervisorTick(new AgentRuntimeService());
    expect(deliver).toHaveBeenCalledOnce();
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 360_000);
    await supervisorTick(new AgentRuntimeService());
    expect(deliver).toHaveBeenCalledTimes(2);
    const after = await controlCenterRepository.latestLeaderSupervision(workspace.id, node.id);
    expect(after?.metadata.workFingerprint).not.toBe(before?.metadata.workFingerprint);
  });

  it('bounds reminder context while tracking changes beyond its five-card sample', async () => {
    const { workspace, deliver } = await setupLeader();
    let lastId = '';
    for (let index = 0; index < 25; index += 1) {
      lastId = uuidv7();
      await AgentBoardTask.query().insert({ id: lastId, workspace_id: workspace.id, title: 'Long task '.repeat(50), status: 'todo',
        created_by: 'user', created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
    }
    await supervisorTick(new AgentRuntimeService());
    const message = deliver.mock.calls[0][0].message;
    expect(message.length).toBeLessThan(2_000);
    expect(message).toContain('26 tarefas');
    expect(message).not.toContain(lastId);
    expect(message).not.toContain('floor_audit');
    await AgentBoardTask.query().where('id', lastId).update({ title: 'Changed work outside the sample' });
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 360_000);
    await supervisorTick(new AgentRuntimeService());
    expect(deliver).toHaveBeenCalledTimes(2);
  });

  it('cancels queued context if pending work changes before delivery', async () => {
    const { workspace, node, taskId, deliver } = await setupLeader();
    deliver.mockImplementationOnce(async (input) => {
      await AgentBoardTask.query().where('id', taskId).update({ title: 'Different authorized work' });
      expect(await input.isStillRelevant?.()).toBe(false);
      throw Object.assign(new Error('Obsolete'), { code: 'PTY_DELIVERY_OBSOLETE' });
    });
    await supervisorTick(new AgentRuntimeService());
    expect(await controlCenterRepository.latestLeaderSupervision(workspace.id, node.id)).toMatchObject({ state: 'failed', metadata: { cancelled: true } });
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 360_000);
    await supervisorTick(new AgentRuntimeService());
    expect(deliver).toHaveBeenCalledTimes(2);
  });

  it('lets an on-demand leader sleep after board completion despite active Floors', async () => {
    const { workspace, node, session, deliver } = await setupLeader('done');
    await workspaceRepository.updateNode(node.id, { payload: { ...node.payload, maestro: true, sessionId: session.id, agentRuntimeMode: 'on_demand' } });
    session.lastActivityAt = new Date(Date.now() - 40 * 60_000).toISOString();
    await AgentFloor.create({ id: uuidv7(), workspace_id: workspace.id, name: 'Development', branch: 'orkestrai/dev', path: '/not-a-real-worktree', status: 'active' });
    const service = new AgentRuntimeService();
    const sleep = vi.spyOn(service, 'sleep');
    await supervisorTick(service);
    expect(sleep).toHaveBeenCalledWith(workspace.id, node.id, 'idle');
    expect(deliver).not.toHaveBeenCalled();
  });

  it.each(['done', 'review'])('does not invent work when the board only contains %s cards', async (status) => {
    const { deliver } = await setupLeader(status);
    await supervisorTick(new AgentRuntimeService());
    expect(deliver).not.toHaveBeenCalled();
  });

  it('ignores archived backlog and suspended workspaces', async () => {
    const { workspace, taskId, deliver } = await setupLeader();
    await AgentBoardTask.query().where('id', taskId).update({ archived_at: new Date().toISOString() });
    await supervisorTick(new AgentRuntimeService());
    expect(deliver).not.toHaveBeenCalled();
    await AgentBoardTask.query().where('id', taskId).update({ archived_at: null });
    await workspaceRepository.setWorkspaceSuspended(workspace.id, true);
    await supervisorTick(new AgentRuntimeService());
    expect(deliver).not.toHaveBeenCalled();
  });

  it.each(['waiting_input', 'waiting_permission', 'blocked', 'error'] as const)('respects %s without submitting another prompt', async (state) => {
    const { workspace, node, deliver } = await setupLeader();
    await controlCenterService.recordActivity({ workspaceId: workspace.id, nodeId: node.id, state, action: 'needs:user' });
    await supervisorTick(new AgentRuntimeService());
    expect(deliver).not.toHaveBeenCalled();
  });

  it('does not confuse quiet output with a running or unknown provider turn', async () => {
    const { complete, deliver, ready, session } = await setupLeader();
    complete.mockResolvedValue(false);
    await supervisorTick(new AgentRuntimeService());
    complete.mockResolvedValue(null);
    await supervisorTick(new AgentRuntimeService());
    complete.mockResolvedValue(true);
    ready.mockReturnValue(false); // human draft, startup gate or pending delivery
    await supervisorTick(new AgentRuntimeService());
    ready.mockReturnValue(true);
    session.lastActivityAt = new Date().toISOString();
    await supervisorTick(new AgentRuntimeService());
    expect(deliver).not.toHaveBeenCalled();
  });

  it('cancels a queued reminder when the last card is completed', async () => {
    const { workspace, node, deliver, taskId } = await setupLeader();
    deliver.mockImplementation(async (input) => {
      await AgentBoardTask.query().where('id', taskId).update({ status: 'done' });
      expect(await input.isStillRelevant!()).toBe(false);
      throw Object.assign(new Error('Obsolete'), { code: 'PTY_DELIVERY_OBSOLETE' });
    });
    await supervisorTick(new AgentRuntimeService());
    expect(await controlCenterRepository.latestLeaderSupervision(workspace.id, node.id)).toMatchObject({ state: 'failed', metadata: { cancelled: true } });
    await supervisorTick(new AgentRuntimeService());
    expect(deliver).toHaveBeenCalledOnce();
  });

  it('does not blindly retry an unconfirmed delivery after the cooldown', async () => {
    const { deliver } = await setupLeader();
    deliver.mockRejectedValue(new Error('Not confirmed'));
    await supervisorTick(new AgentRuntimeService());
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 360_000);
    await supervisorTick(new AgentRuntimeService());
    expect(deliver).toHaveBeenCalledOnce();
  });

  it('respects the emergency stop even with unfinished cards and a live leader', async () => {
    const { workspace, deliver } = await setupLeader();
    await autonomyPolicyService.emergencyStop(workspace.id);
    await supervisorTick(new AgentRuntimeService());
    expect(deliver).not.toHaveBeenCalled();
  });

  it('does not send duplicate reminders while another tick is waiting for confirmation', async () => {
    const { deliver } = await setupLeader();
    let finish!: () => void;
    deliver.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
    const service = new AgentRuntimeService();
    await (service as unknown as { tick(): Promise<void> }).tick();
    await vi.waitFor(() => expect(deliver).toHaveBeenCalledOnce());
    await (service as unknown as { tick(): Promise<void> }).tick();
    expect(deliver).toHaveBeenCalledOnce();
    finish();
    await supervisorTick(service);
  });

  it('does not wake manually sleeping leaders just because the board has work', async () => {
    const { session, deliver } = await setupLeader();
    session.exited = true;
    const ensure = vi.spyOn(ptySessionManager, 'create');
    await supervisorTick(new AgentRuntimeService());
    expect(deliver).not.toHaveBeenCalled();
    expect(ensure).not.toHaveBeenCalled();
  });
});
