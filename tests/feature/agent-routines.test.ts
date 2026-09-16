import { describe, expect, it } from 'vitest';
import { useSvelarTest } from '@beeblock/svelar/testing';
import { AgentRoutineService } from '$lib/modules/agent-room/application/services/AgentRoutineService.js';
import { routineService } from '$lib/modules/agent-room/application/services/RoutineService.js';
import { autonomyPolicyService } from '$lib/modules/agent-room/application/services/AutonomyPolicyService.js';
import { workspaceRepository } from '$lib/modules/agent-room/infrastructure/repositories/WorkspaceRepository.js';
import { taskBoardService } from '$lib/modules/agent-room/application/services/TaskBoardService.js';
import { bridgeAutomationCommandSchema } from '$lib/modules/agent-room/contracts/schemas/bridge-automation.schema.js';
import { AgentRoutine } from '$lib/modules/agent-room/domain/models/AgentRoutine.js';

async function setup() {
  const workspace = await workspaceRepository.createWorkspace({ name: 'Agent schedules', workingDir: '/tmp' });
  const agent = await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'terminal' });
  const task = await taskBoardService.create(workspace.id, { title: 'Weekly reports', assigneeNodeId: agent.id, dispatch: false });
  const prior = await autonomyPolicyService.get(workspace.id);
  await autonomyPolicyService.update(workspace.id, { enabled: true, mode: 'bounded', policy: { ...prior.policy, capabilities: ['agent'] } });
  const service = new AgentRoutineService();
  const command = (input: unknown, idempotencyKey = 'weekly-report-one') => service.execute(workspace.id, agent.id, bridgeAutomationCommandSchema.parse({ from: agent.id, taskId: task.id, idempotencyKey, input }));
  return { workspace, agent, task, service, command };
}
const definition = { name: 'Monday report', prompt: 'Produce the report and deliver only to the approved recipient. Do not mark dispatch as delivery.', trigger: 'calendar', calendar: { frequency: 'weekly', timeZone: 'America/Sao_Paulo', time: '14:00', weekdays: [1] } };

describe('Agent-authored existing workspace routines', () => {
  useSvelarTest({ refreshDatabase: true });
  it('creates idempotently, persists through service restart, and reuses the standard owner-visible routine', async () => {
    const s = await setup();
    const first = await s.command({ command: 'save', definition });
    expect(first).toMatchObject({ authorAgentId: s.agent.id, authorTaskId: s.task.id, triggerType: 'schedule', actionType: 'prompt_agent', revision: 1 });
    expect(await s.command({ command: 'save', definition })).toEqual(first);
    expect(await AgentRoutine.query().count()).toBe(1);
    expect(await routineService.list(s.workspace.id)).toEqual([first]);
    expect(await new AgentRoutineService().execute(s.workspace.id, s.agent.id, bridgeAutomationCommandSchema.parse({ from: s.agent.id, taskId: s.task.id, idempotencyKey: 'read-list', input: { command: 'list' } }))).toEqual([first]);
    await expect(s.command({ command: 'save', definition: { ...definition, prompt: 'Changed' } })).rejects.toThrow('different request');
  });
  it('guards revisions, preserves history on cancellation, and refuses foreign/owner routines', async () => {
    const s = await setup(), other = await setup();
    const first = await s.command({ command: 'save', definition }) as { id: string; revision: number };
    await expect(other.command({ command: 'enabled', id: first.id, revision: 1, enabled: false })).rejects.toThrow('not owned');
    const changed = await s.command({ command: 'enabled', id: first.id, revision: 1, enabled: false });
    expect(changed).toMatchObject({ enabled: false, revision: 2 });
    await expect(s.command({ command: 'enabled', id: first.id, revision: 1, enabled: true })).rejects.toThrow('changed');
    const cancelled = await s.command({ command: 'cancel', id: first.id, revision: 2 });
    expect(cancelled).toMatchObject({ enabled: false, revision: 3 });
    expect(await s.command({ command: 'history', id: first.id })).toEqual([]);
    const owner = await routineService.create({ workspaceId: s.workspace.id, targetNodeId: s.agent.id, prompt: 'Owner routine', intervalMinutes: 10 });
    await expect(s.command({ command: 'cancel', id: owner.id, revision: 1 })).rejects.toThrow('not owned');
  });
  it('does not author when the workspace is unloaded or the task is reassigned', async () => {
    const s = await setup();
    await workspaceRepository.setWorkspaceSuspended(s.workspace.id, true);
    await expect(s.command({ command: 'save', definition })).rejects.toThrow('active assigned');
    expect(await AgentRoutine.query().count()).toBe(0);
  });
});
