import { describe, expect, it, vi } from 'vitest';
import { useSvelarTest } from '@beeblock/svelar/testing';
import type { AutomationFormInput } from '$lib/modules/agent-room/contracts/schemas/automation.schema.js';
import { AutomationTriggerReceived } from '$lib/modules/agent-room/domain/events/AutomationTriggerReceived.js';
import { routineService, RoutineService } from '$lib/modules/agent-room/application/services/RoutineService.js';
import { AgentWorkspaceToolService } from '$lib/modules/agent-room/application/services/AgentWorkspaceToolService.js';
import { autonomyPolicyService } from '$lib/modules/agent-room/application/services/AutonomyPolicyService.js';
import { taskBoardService } from '$lib/modules/agent-room/application/services/TaskBoardService.js';
import { workspaceToolManifestSchema } from '$lib/modules/agent-room/contracts/schemas/agent-workspace-tool.schema.js';
import { workspaceRepository } from '$lib/modules/agent-room/infrastructure/repositories/WorkspaceRepository.js';
import { ptySessionManager } from '$lib/modules/agent-room/infrastructure/pty/PtySessionManager.ts';
import { AgentRoutine } from '$lib/modules/agent-room/domain/models/AgentRoutine.js';

function form(input: Partial<AutomationFormInput>): AutomationFormInput {
  return {
    name: 'Automation', triggerType: 'manual', intervalMinutes: null, taskEvent: null,
    taskStatus: null, messageContains: null, gitBranch: null, githubEvent: null,
    webhookSecret: null, filePath: null, usageProvider: null, usageWindow: null,
    usagePercent: null, actionType: 'notify', targetNodeId: null, prompt: null,
    taskTitle: null, taskDescription: null, notificationTitle: null,
    notificationMessage: 'Done', enabled: true, recipeId: null,
    portalNodeId: null, portalAction: null, portalUrl: null, portalRef: null,
    portalText: null, portalSubmit: false, integrationId: null, integrationAction: null,
    integrationPayload: '{}', toolId: null, toolInput: '{}', ...input,
  };
}

describe('workspace automations', () => {
  useSvelarTest({ refreshDatabase: true });

  it('runs a calendar occurrence only once across ticks and a restarted runner', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-09-14T16:59:00Z'));
      const workspace = await workspaceRepository.createWorkspace({ name: 'Calendar restart', workingDir: '/tmp' });
      const automation = await routineService.createAutomation(workspace.id, form({ triggerType: 'schedule', calendar: { frequency: 'weekly', timeZone: 'America/Sao_Paulo', time: '14:00', weekdays: [1], missed: 'latest', maxLatenessMinutes: 60 }, actionType: 'create_task', taskTitle: 'Monday report', notificationMessage: null }));
      expect(await routineService.dueRoutines()).toEqual([]);
      vi.setSystemTime(new Date('2026-09-14T17:00:01Z'));
      await routineService.tick();
      await new RoutineService().tick();
      expect((await taskBoardService.list(workspace.id)).filter(t => t.title === 'Monday report')).toHaveLength(1);
      expect(await routineService.history(automation.id)).toHaveLength(1);
      vi.setSystemTime(new Date('2026-09-21T17:00:01Z'));
      await new RoutineService().tick();
      expect((await taskBoardService.list(workspace.id)).filter(t => t.title === 'Monday report')).toHaveLength(2);
    } finally { vi.useRealTimers(); }
  });

  it('does not replay missed slots after sleep or run a paused calendar', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-09-14T16:59:00Z'));
      const workspace = await workspaceRepository.createWorkspace({ name: 'Calendar pause', workingDir: '/tmp' });
      const automation = await routineService.createAutomation(workspace.id, form({ triggerType: 'schedule', calendar: { frequency: 'daily', timeZone: 'America/Sao_Paulo', time: '14:00', missed: 'skip', maxLatenessMinutes: 60 }, actionType: 'create_task', taskTitle: 'Should not run', notificationMessage: null }));
      vi.setSystemTime(new Date('2026-09-14T18:00:00Z'));
      await routineService.tick();
      expect(await routineService.history(automation.id)).toHaveLength(0);
      await routineService.setEnabled(automation.id, false);
      vi.setSystemTime(new Date('2026-09-15T17:00:01Z'));
      await routineService.tick();
      expect(await routineService.history(automation.id)).toHaveLength(0);
      expect(await taskBoardService.list(workspace.id)).toHaveLength(0);
    } finally { vi.useRealTimers(); }
  });

  it('keeps manual event consumers enabled across consecutive runs, including legacy once metadata', async () => {
    const workspace = await workspaceRepository.createWorkspace({ name: 'Continuous conversation', workingDir: '/tmp' });
    const automation = await routineService.createAutomation(workspace.id, form({
      actionType: 'create_task', taskTitle: 'Observed event', notificationMessage: null,
    }));
    expect(automation.triggerConfig).toEqual({});
    for (let i = 0; i < 3; i++) {
      if (i === 1) await AgentRoutine.query().where('id', automation.id).update({ trigger_config_json: JSON.stringify({ once: true }) });
      expect((await routineService.runNow(automation.id)).ok).toBe(true);
      expect(await routineService.get(automation.id)).toMatchObject({ enabled: true, runCount: i + 1 });
    }
  });

  it('records agent, provider and output while restoring a stopped terminal', async () => {
    const workspace = await workspaceRepository.createWorkspace({ name: 'automations', workingDir: '/tmp' });
    const session = ptySessionManager.create({ command: '/bin/cat', cwd: '/tmp' });
    const terminal = await workspaceRepository.createNode({
      workspaceId: workspace.id,
      type: 'terminal',
      title: 'Operator',
      payload: { command: '/bin/cat', provider: 'shell', sessionId: session.id },
    });
    const automation = await routineService.createAutomation(workspace.id, form({
      name: 'Send check', actionType: 'prompt_agent', targetNodeId: terminal.id, prompt: 'check now',
    }));

    const result = await routineService.runNow(automation.id);
    expect(result.ok).toBe(true);
    expect(result.run.agentNodeId).toBe(terminal.id);
    expect(result.run.provider).toBe('shell');
    expect(result.run.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.run.output).toMatchObject({ steps: 1, target: 'Operator' });

    ptySessionManager.kill(session.id);
    const resumed = await routineService.runNow(automation.id);
    expect(resumed.ok).toBe(true);
    expect(resumed.run.output).toMatchObject({ sessionState: 'started' });
    const refreshed = await workspaceRepository.getNode(terminal.id);
    ptySessionManager.kill(String((refreshed?.payload as Record<string, unknown>).sessionId ?? ''));
  });

  it('dispatches a task event once and creates one traceable task', async () => {
    const workspace = await workspaceRepository.createWorkspace({ name: 'events', workingDir: '/tmp' });
    const automation = await routineService.createAutomation(workspace.id, form({
      name: 'Create handoff', triggerType: 'task', taskEvent: 'completed',
      actionType: 'create_task', taskTitle: 'Review {{title}}', taskDescription: 'Source {{id}}',
      notificationMessage: null,
    }));
    const event = new AutomationTriggerReceived(
      workspace.id, 'task', 'completed', 'task:source:completed', { id: 'source', title: 'Campaign' },
    );

    expect(await routineService.dispatchEvent(event)).toBe(1);
    expect(await routineService.dispatchEvent(event)).toBe(0);
    const tasks = await taskBoardService.list(workspace.id);
    expect(tasks.filter((task) => task.title === 'Review Campaign')).toHaveLength(1);
    const history = await routineService.history(automation.id);
    expect(history).toHaveLength(1);
    expect(history[0].status).toBe('succeeded');
    expect(history[0].input).toMatchObject({ id: 'source', title: 'Campaign' });
  });

  it('does not enqueue background automation while the workspace is suspended', async () => {
    const workspace = await workspaceRepository.createWorkspace({ name: 'paused automation', workingDir: '/tmp' });
    const automation = await routineService.createAutomation(workspace.id, form({
      name: 'Paused handoff', triggerType: 'task', taskEvent: 'completed',
      actionType: 'create_task', taskTitle: 'Should not run', notificationMessage: null,
    }));
    await workspaceRepository.setWorkspaceSuspended(workspace.id, true);

    const dispatched = await routineService.dispatchEvent(new AutomationTriggerReceived(
      workspace.id, 'task', 'completed', 'task:paused:completed', { id: 'paused' },
    ));

    expect(dispatched).toBe(0);
    expect(await routineService.history(automation.id)).toHaveLength(0);
  });

  it('executes a published workspace tool as a durable automation action', async () => {
    const workspace = await workspaceRepository.createWorkspace({ name: 'tool automation', workingDir: '/tmp' });
    const policy = await autonomyPolicyService.get(workspace.id);
    await autonomyPolicyService.update(workspace.id, {
      enabled: true, mode: 'bounded',
      policy: { ...policy.policy, capabilities: [...new Set([...policy.policy.capabilities, 'tool' as const])] },
    });
    const tools = new AgentWorkspaceToolService();
    const tool = await tools.create(workspace.id, {
      name: 'Build report', slug: 'build-report', description: 'Build a traceable report.',
      manifest: workspaceToolManifestSchema.parse({
        schemaVersion: 1,
        executor: { kind: 'transform', operations: [{ kind: 'set', path: 'report.status', value: 'ready' }] },
        inputSchema: { type: 'object', properties: {}, additionalProperties: true },
        outputSchema: { type: 'object', properties: {}, additionalProperties: true },
        capabilities: ['tool'], secretRefs: [], timeoutMs: 5_000, maxOutputBytes: 65_536, fixtures: [],
      }),
      actor: { type: 'user', id: 'workspace-owner' },
    });
    await tools.publish(workspace.id, tool.id, { type: 'user', id: 'workspace-owner' });
    const automation = await routineService.createAutomation(workspace.id, form({
      name: 'Daily report', actionType: 'tool', toolId: tool.id, toolInput: '{}', notificationMessage: null,
    }));

    const result = await routineService.runNow(automation.id);

    expect(result.ok).toBe(true);
    expect(result.run.output).toMatchObject({ toolId: tool.id, result: { report: { status: 'ready' } } });
    expect(result.run.output?.toolRunId).toEqual(expect.any(String));
  });
});
