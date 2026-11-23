import { AgentBotWorkflowRun } from '../../domain/models/AgentBotWorkflowRun.js';
import type { BotWorkflow, BotWorkflowState } from '../../contracts/schemas/bot-workflow.schema.js';
export type WorkflowRun = {
  id: string; workspaceId: string; nodeId: string; state: BotWorkflowState;
  plan: BotWorkflow; index: number; acknowledgmentId: string; finalId: string; errorId: string;
  steps: Array<{ messageId: string; taskId?: string; output?: string }>;
};
function map(row: AgentBotWorkflowRun): WorkflowRun {
  return { ...JSON.parse(row.getAttribute('run_json')), id: row.getAttribute('id'), workspaceId: row.getAttribute('workspace_id'), nodeId: row.getAttribute('node_id'), state: row.getAttribute('state') };
}
export class BotWorkflowRepository {
  async find(id: string) { const row = await AgentBotWorkflowRun.find(id); return row ? map(row) : null; }
  async create(run: WorkflowRun) {
    const previous = await this.find(run.id); if (previous) return previous;
    const now = new Date().toISOString();
    return map(await AgentBotWorkflowRun.create({ id: run.id, workspace_id: run.workspaceId, node_id: run.nodeId, state: run.state, run_json: JSON.stringify(run), created_at: now, updated_at: now }));
  }
  async save(run: WorkflowRun) {
    await AgentBotWorkflowRun.query().where('id', run.id).update({ state: run.state, run_json: JSON.stringify(run), updated_at: new Date().toISOString() });
  }
  async pending(afterId?: string, limit = 20) {
    const query = AgentBotWorkflowRun.query().whereIn('state', ['queued', 'running', 'waiting']);
    if (afterId) query.where('id', '>', afterId);
    return (await query.orderBy('id').limit(limit).get()).map(map);
  }
  async active(workspaceId: string, nodeId: string) {
    return Boolean(await AgentBotWorkflowRun.query().where('workspace_id', workspaceId).where('node_id', nodeId).whereIn('state', ['queued', 'running', 'waiting']).first());
  }
}
export const botWorkflowRepository = new BotWorkflowRepository();
