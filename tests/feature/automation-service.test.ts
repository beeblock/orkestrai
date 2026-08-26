import { describe, expect, it } from 'vitest';
import { useSvelarTest } from '@beeblock/svelar/testing';
import type { AutomationFormInput } from '$lib/modules/agent-room/contracts/schemas/automation.schema.js';
import { AutomationTriggerReceived } from '$lib/modules/agent-room/domain/events/AutomationTriggerReceived.js';
import { routineService } from '$lib/modules/agent-room/application/services/RoutineService.js';
import { taskBoardService } from '$lib/modules/agent-room/application/services/TaskBoardService.js';
import { workspaceRepository } from '$lib/modules/agent-room/infrastructure/repositories/WorkspaceRepository.js';
import { ptySessionManager } from '$lib/modules/agent-room/infrastructure/pty/PtySessionManager.ts';

function form(input: Partial<AutomationFormInput>): AutomationFormInput {
  return {
    name: 'Automation', triggerType: 'manual', intervalMinutes: null, taskEvent: null,
    taskStatus: null, messageContains: null, gitBranch: null, githubEvent: null,
    webhookSecret: null, filePath: null, usageProvider: null, usageWindow: null,
    usagePercent: null, actionType: 'notify', targetNodeId: null, prompt: null,
    taskTitle: null, taskDescription: null, notificationTitle: null,
    notificationMessage: 'Done', enabled: true, recipeId: null, ...input,
  };
}

describe('workspace automations', () => {
  useSvelarTest({ refreshDatabase: true });

  it('records agent, provider, output, duration, and a recoverable failure', async () => {
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
    const failed = await routineService.runNow(automation.id);
    expect(failed.ok).toBe(false);
    expect(failed.run.recoverable).toBe(true);
    expect(failed.run.error).toContain('sessão PTY');
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
});
