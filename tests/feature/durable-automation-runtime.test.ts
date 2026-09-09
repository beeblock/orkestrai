import { describe, expect, it } from 'vitest';
import { useSvelarTest } from '@beeblock/svelar/testing';
import { uuidv7 } from '@beeblock/svelar/support';
import type { AutomationFormInput } from '$lib/modules/agent-room/contracts/schemas/automation.schema.js';
import { AgentRoutineRun } from '$lib/modules/agent-room/domain/models/AgentRoutineRun.js';
import { routineService } from '$lib/modules/agent-room/application/services/RoutineService.js';
import { taskBoardService } from '$lib/modules/agent-room/application/services/TaskBoardService.js';
import { workspaceRepository } from '$lib/modules/agent-room/infrastructure/repositories/WorkspaceRepository.js';

function form(input: Partial<AutomationFormInput>): AutomationFormInput {
  return {
    name: 'Durable automation', triggerType: 'manual', intervalMinutes: null,
    taskEvent: null, taskStatus: null, messageContains: null, gitBranch: null,
    githubEvent: null, webhookSecret: null, filePath: null, usageProvider: null,
    usageWindow: null, usagePercent: null, actionType: 'create_task',
    targetNodeId: null, prompt: null, taskTitle: 'Recovered task',
    taskDescription: null, notificationTitle: null, notificationMessage: null,
    enabled: true, recipeId: null, ...input,
  };
}

async function persistedRun(routineId: string, input: Record<string, unknown> = {}) {
  const now = new Date();
  return AgentRoutineRun.create({
    id: uuidv7(), routine_id: routineId, ran_at: now, ok: false, detail: null,
    status: 'queued', trigger_type: 'manual', trigger_key: `test:${uuidv7()}`,
    idempotency_key: `test:${uuidv7()}`, input_json: JSON.stringify(input),
    output_json: null, error: null, agent_node_id: null, provider: null,
    usage_before_json: null, usage_after_json: null, started_at: null,
    finished_at: null, duration_ms: null, attempt: 0, retry_of_id: null,
    lease_owner: null, lease_expires_at: null, heartbeat_at: null,
    checkpoint_json: JSON.stringify({ stage: 'queued' }), cancel_requested_at: null,
    timeout_at: null, max_attempts: 3, next_attempt_at: null,
    dead_lettered_at: null,
  });
}

describe('durable automation runtime', () => {
  useSvelarTest({ refreshDatabase: true });

  it('claims one persisted run only once even under concurrent workers', async () => {
    const workspace = await workspaceRepository.createWorkspace({ name: 'durable', workingDir: '/tmp' });
    const automation = await routineService.createAutomation(workspace.id, form({}));
    const run = await persistedRun(automation.id);

    await Promise.all([
      routineService.executeRun(String(run.getAttribute('id')), false),
      routineService.executeRun(String(run.getAttribute('id')), false),
    ]);

    const tasks = await taskBoardService.list(workspace.id);
    expect(tasks.filter((task) => task.title === 'Recovered task')).toHaveLength(1);
    expect((await routineService.getRun(String(run.getAttribute('id'))))?.status).toBe('succeeded');
  });

  it('returns an expired worker lease to the queue with its checkpoint', async () => {
    const workspace = await workspaceRepository.createWorkspace({ name: 'recovery', workingDir: '/tmp' });
    const automation = await routineService.createAutomation(workspace.id, form({}));
    const run = await persistedRun(automation.id);
    await AgentRoutineRun.query().where('id', run.getAttribute('id')).update({
      status: 'running', attempt: 1, lease_owner: 'dead-worker',
      lease_expires_at: new Date(Date.now() - 1_000),
    });

    expect(await routineService.recoverInterruptedRuns()).toBe(1);
    const recovered = await routineService.getRun(String(run.getAttribute('id')));
    expect(recovered).toMatchObject({ status: 'queued', attempt: 1 });
    expect(recovered?.checkpoint).toMatchObject({ stage: 'recovered', reason: 'lease_expired' });
  });

  it('cancels a queued run before it can execute', async () => {
    const workspace = await workspaceRepository.createWorkspace({ name: 'cancel', workingDir: '/tmp' });
    const automation = await routineService.createAutomation(workspace.id, form({}));
    const run = await persistedRun(automation.id);

    const cancelled = await routineService.cancel(String(run.getAttribute('id')));
    await routineService.processQueuedRuns();

    expect(cancelled?.status).toBe('cancelled');
    expect(await taskBoardService.list(workspace.id)).toHaveLength(0);
  });

  it('keeps already queued work paused while its workspace is suspended', async () => {
    const workspace = await workspaceRepository.createWorkspace({ name: 'paused queue', workingDir: '/tmp' });
    const automation = await routineService.createAutomation(workspace.id, form({}));
    const run = await persistedRun(automation.id);
    await workspaceRepository.setWorkspaceSuspended(workspace.id, true);

    await routineService.processQueuedRuns();

    expect((await routineService.getRun(String(run.getAttribute('id'))))?.status).toBe('queued');
    expect(await taskBoardService.list(workspace.id)).toHaveLength(0);
  });
});
