import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSvelarTest } from '@beeblock/svelar/testing';
import { agentRuntimeService, AgentRuntimePolicyError } from '$lib/modules/agent-room/application/services/AgentRuntimeService.js';
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

describe('AgentRuntimeService', () => {
  useSvelarTest({ refreshDatabase: true });

  afterEach(() => {
    agentRuntimeService.stopSupervisor();
    routineService.stopScheduler();
    vi.useRealTimers();
    ptySessionManager.killAll();
    vi.restoreAllMocks();
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
});
