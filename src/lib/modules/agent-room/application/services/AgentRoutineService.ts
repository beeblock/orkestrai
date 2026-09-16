import { createHash } from 'node:crypto';
import type { BridgeAutomationInput } from '../../contracts/schemas/bridge-automation.schema.js';
import { automationFormSchema } from '../../contracts/schemas/automation.schema.js';
import { AgentRoutine } from '../../domain/models/AgentRoutine.js';
import { AgentRoutineRun } from '../../domain/models/AgentRoutineRun.js';
import { AgentBoardTask } from '../../domain/models/AgentBoardTask.js';
import { workspaceRepository } from '../../infrastructure/repositories/WorkspaceRepository.js';
import { routineService } from './RoutineService.js';
import { autonomyPolicyService } from './AutonomyPolicyService.js';

export class AgentRoutineService {
  async execute(workspaceId: string, actorId: string, request: BridgeAutomationInput, assertRelevant: () => Promise<void> = async () => {}) {
    const validate = async () => {
      await assertRelevant();
      const workspace = await workspaceRepository.getWorkspace(workspaceId);
      const task = await AgentBoardTask.query().where('workspace_id', workspaceId).where('id', request.taskId).first();
      const agent = await workspaceRepository.getNode(actorId);
      if (!workspace || workspace.suspendedAt || agent?.workspaceId !== workspaceId || agent.type !== 'terminal' || !task || task.getAttribute('archived_at') || task.getAttribute('status') === 'done' || task.getAttribute('assignee_node_id') !== actorId) throw new Error('Automation requires an active assigned task and terminal in this workspace.');
    };
    await validate();
    const input = request.input;
    const owned = async (id: string) => {
      const routine = await routineService.get(id);
      if (!routine || routine.workspaceId !== workspaceId || routine.authorAgentId !== actorId || routine.authorTaskId !== request.taskId || routine.targetNodeId !== actorId || routine.actionType !== 'prompt_agent') throw new Error('This automation is not owned by the current agent and task.');
      return routine;
    };
    if (input.command === 'list') return (await routineService.list(workspaceId)).filter(r => r.authorAgentId === actorId && r.authorTaskId === request.taskId);
    if (input.command === 'history') { await owned(input.id); return routineService.history(input.id); }
    const hash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    return autonomyPolicyService.execute({ workspaceId, capability: 'agent', operation: `automation.author:${input.command}`, mutation: true, actorType: 'agent', actorId, input: { taskId: request.taskId, idempotencyKey: request.idempotencyKey, requestDigest: hash }, certainty: 'semantic', auditOutput: result => ({ id: (result as { id?: string }).id, command: input.command }) }, async () => {
      await validate();
      if (input.command === 'save') {
        const definition = input.definition;
        const form = automationFormSchema.parse({ name: definition.name, triggerType: definition.trigger === 'manual' ? 'manual' : 'schedule', intervalMinutes: definition.trigger === 'interval' ? definition.intervalMinutes : null, calendar: definition.trigger === 'calendar' ? definition.calendar : null, actionType: 'prompt_agent', targetNodeId: actorId, prompt: definition.prompt, enabled: definition.enabled });
        if (input.id) {
          await owned(input.id);
          if (!input.revision) throw new Error('Read the automation revision before editing.');
          return routineService.updateAutomation(input.id, form, input.revision);
        }
        const previous = async () => AgentRoutine.query().where('workspace_id', workspaceId).where('author_agent_id', actorId).where('author_key', request.idempotencyKey).first();
        const reuse = async (row: AgentRoutine) => {
          if (row.getAttribute('author_digest') !== hash || row.getAttribute('author_task_id') !== request.taskId) throw new Error('This automation key belongs to a different request.');
          return owned(String(row.getAttribute('id')));
        };
        const existing = await previous();
        if (existing) return reuse(existing);
        if ((await routineService.list(workspaceId)).filter(r => r.authorAgentId === actorId).length >= 100) throw new Error('Agent automation limit reached. Review existing routines.');
        try { return await routineService.createAutomation(workspaceId, form, { agentId: actorId, taskId: request.taskId, key: request.idempotencyKey, digest: hash }); }
        catch (error) { const raced = await previous(); if (raced) return reuse(raced); throw error; }
      }
      await owned(input.id);
      const updated = await routineService.setEnabled(input.id, input.command === 'enabled' ? input.enabled : false, input.revision);
      if (input.command === 'cancel') {
        const active = await AgentRoutineRun.query().where('routine_id', input.id).whereIn('status', ['queued', 'running', 'waiting_approval']).get();
        for (const run of active) await routineService.cancel(String(run.getAttribute('id')));
      }
      return updated;
    });
  }
}
export const agentRoutineService = new AgentRoutineService();
