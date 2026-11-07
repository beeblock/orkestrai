import { Connection } from '@beeblock/svelar/database';
import { uuidv7 } from '@beeblock/svelar/support';
import { AgentTaskExecution } from '../../domain/models/AgentTaskExecution.js';
import { AgentBoardTask } from '../../domain/models/AgentBoardTask.js';
import { workspaceRepository } from './WorkspaceRepository.js';

export type ExecutionState = 'queued' | 'dispatching' | 'running' | 'waiting' | 'blocked' | 'stopped' | 'reported' | 'completed' | 'cancelled';
export type TaskExecution = {
  id: string; workspaceId: string; taskId: string; nodeId: string; state: ExecutionState;
  sessionId: string | null; envelopeId: string | null; stopKey: string | null;
  claimedAt: string | null; submittedAt: string | null; acceptedAt: string | null;
  createdAt: string; updatedAt: string;
};
function iso(value: unknown): string | null { return value == null ? null : value instanceof Date ? value.toISOString() : String(value); }
function map(row: AgentTaskExecution): TaskExecution {
  const get = (name: string) => row.getAttribute(name);
  return { id: get('id'), workspaceId: get('workspace_id'), taskId: get('task_id'), nodeId: get('node_id'),
    state: get('state'), sessionId: get('session_id') ?? null, envelopeId: get('envelope_id') ?? null,
    stopKey: get('stop_key') ?? null, claimedAt: iso(get('claimed_at')), submittedAt: iso(get('submitted_at')),
    acceptedAt: iso(get('accepted_at')), createdAt: iso(get('created_at'))!, updatedAt: iso(get('updated_at'))! };
}
export function taskDependencies(task: AgentBoardTask): string[] {
  const value = task.getAttribute('dependencies_json');
  if (!value) return [];
  const parsed = JSON.parse(String(value));
  if (!Array.isArray(parsed) || parsed.length > 64 || parsed.some(id => typeof id !== 'string')) throw new Error('Invalid task dependencies.');
  return parsed;
}

export class TaskExecutionRepository {
  private async verifiedState(row: AgentTaskExecution): Promise<AgentTaskExecution> {
    if (row.getAttribute('state') !== 'running' || row.getAttribute('accepted_at') != null) return row;
    // Older versions promoted a timeout to running without a receipt. Repair
    // that state without releasing custody or resending an uncertain prompt.
    await AgentTaskExecution.query().where('id', row.getAttribute('id')).where('state', 'running').whereNull('accepted_at')
      .update({ state: 'dispatching', updated_at: new Date().toISOString() });
    return await AgentTaskExecution.find(row.getAttribute('id')) ?? row;
  }
  async current(workspaceId: string, taskId: string): Promise<TaskExecution | null> {
    const row = await AgentTaskExecution.query().where('workspace_id', workspaceId).where('active_task_id', taskId).first();
    return row ? map(await this.verifiedState(row)) : null;
  }
  async forTasks(workspaceId: string, taskIds: string[]): Promise<Map<string, TaskExecution>> {
    if (!taskIds.length) return new Map();
    const rows = await AgentTaskExecution.query().where('workspace_id', workspaceId).whereIn('active_task_id', taskIds).get();
    return new Map(await Promise.all(rows.map(async row => { const execution = map(await this.verifiedState(row)); return [execution.taskId, execution] as const; })));
  }
  async activeForNode(workspaceId: string, nodeId: string): Promise<TaskExecution | null> {
    const row = await AgentTaskExecution.query().where('workspace_id', workspaceId).where('active_node_id', nodeId).first();
    return row ? map(await this.verifiedState(row)) : null;
  }
  async schedule(workspaceId: string, taskId: string, nodeId: string): Promise<TaskExecution | null> {
    return Connection.transaction(async () => {
      const task = await AgentBoardTask.query().where('workspace_id', workspaceId).where('id', taskId).first();
      if (!task || task.getAttribute('archived_at') || ['todo', 'done', 'blocked', 'error', 'failed'].includes(task.getAttribute('status'))
        || task.getAttribute('assignee_node_id') !== nodeId) return null;
      const prior = await this.current(workspaceId, taskId);
      if (prior?.nodeId === nodeId) return prior;
      if (prior) await this.finish(prior, 'cancelled');
      const now = new Date().toISOString();
      return map(await AgentTaskExecution.create({ id: uuidv7(), workspace_id: workspaceId, task_id: taskId, node_id: nodeId,
        active_task_id: taskId, active_node_id: null, state: 'queued', created_at: now, updated_at: now }));
    });
  }
  async dependenciesReady(workspaceId: string, dependencies: string[]): Promise<boolean> {
    if (!dependencies.length) return true;
    const rows = await AgentBoardTask.query().where('workspace_id', workspaceId).whereIn('id', dependencies).get();
    return rows.length === dependencies.length && rows.every(task => task.getAttribute('status') === 'done');
  }
  async claim(workspaceId: string, taskId: string, nodeId: string, sessionId: string | null, envelopeId: string, resume = false): Promise<TaskExecution | null> {
    await this.schedule(workspaceId, taskId, nodeId);
    return Connection.transaction(async () => {
      const task = await AgentBoardTask.query().where('workspace_id', workspaceId).where('id', taskId).first();
      const execution = await this.current(workspaceId, taskId);
      if (!task || !execution || execution.nodeId !== nodeId || task.getAttribute('assignee_node_id') !== nodeId
        || task.getAttribute('archived_at') || ['todo', 'done', 'blocked', 'error', 'failed'].includes(task.getAttribute('status'))
        || !(await this.dependenciesReady(workspaceId, taskDependencies(task)))) return null;
      if (execution.envelopeId === envelopeId && execution.sessionId === sessionId && ['dispatching', 'running'].includes(execution.state)) return execution;
      if (execution.state !== 'queued' && !(resume && ['waiting', 'blocked', 'stopped'].includes(execution.state))) return null;
      const node = await workspaceRepository.getNode(nodeId);
      const coordinator = node?.workspaceId === workspaceId && Boolean((node.payload as {maestro?:boolean}).maestro);
      const occupied = coordinator ? null : await this.activeForNode(workspaceId, nodeId);
      if (occupied && occupied.id !== execution.id) {
        const occupiedTask = await AgentBoardTask.query().where('workspace_id', workspaceId).where('id', occupied.taskId).first();
        if (!occupiedTask || occupiedTask.getAttribute('archived_at') || ['todo', 'done'].includes(occupiedTask.getAttribute('status'))
          || occupiedTask.getAttribute('assignee_node_id') !== nodeId) await this.finish(occupied, occupiedTask?.getAttribute('status') === 'done' ? 'completed' : 'cancelled');
        else return null;
      }
      const changed = await AgentTaskExecution.query().where('id', execution.id).where('state', execution.state).update({
        active_node_id: coordinator ? null : nodeId, state: 'dispatching', session_id: sessionId, envelope_id: envelopeId,
        claimed_at: new Date().toISOString(), submitted_at: null, accepted_at: null, stop_key: null, updated_at: new Date().toISOString(),
      });
      return changed ? this.current(workspaceId, taskId) : null;
    });
  }
  async submitted(executionId: string, at = new Date().toISOString()): Promise<void> {
    await AgentTaskExecution.query().where('id', executionId).whereIn('state', ['dispatching', 'running']).whereNull('submitted_at')
      .update({ submitted_at: at, updated_at: new Date().toISOString() });
  }
  async accepted(executionId: string, verified = true): Promise<void> {
    if (!verified) return;
    await AgentTaskExecution.query().where('id', executionId).whereIn('state', ['dispatching', 'running']).whereNull('accepted_at')
      .update({ state: 'running', accepted_at: new Date().toISOString(), updated_at: new Date().toISOString() });
  }
  async park(execution: TaskExecution, state: 'waiting' | 'blocked' | 'stopped' | 'reported', stopKey?: string): Promise<boolean> {
    const changed = await AgentTaskExecution.query().where('id', execution.id).where('state', execution.state)
      .where('updated_at', execution.updatedAt).update({ state, active_node_id: null,
        ...(stopKey ? { stop_key: stopKey } : {}), updated_at: new Date().toISOString() });
    return Boolean(changed);
  }
  async finish(execution: TaskExecution, state: 'completed' | 'cancelled'): Promise<void> {
    await AgentTaskExecution.query().where('id', execution.id).where('active_task_id', execution.taskId)
      .update({ state, active_task_id: null, active_node_id: null, settled_at: new Date().toISOString(), updated_at: new Date().toISOString() });
  }
  async releaseUnsubmitted(executionId: string): Promise<void> {
    await AgentTaskExecution.query().where('id', executionId).where('state', 'dispatching').whereNull('submitted_at')
      .update({ state: 'queued', active_node_id: null, envelope_id: null, session_id: null, updated_at: new Date().toISOString() });
  }
  async inboxSelection(workspaceId: string, nodeId: string): Promise<{ known: string[]; ready: string[]; recovery: string[] }> {
    const rows = await AgentTaskExecution.query().select('active_task_id', 'state', 'active_node_id')
      .where('workspace_id', workspaceId).where('node_id', nodeId).whereNotNull('active_task_id').get();
    const known = rows.map(row => String(row.getAttribute('active_task_id')));
    if (!known.length) return { known, ready: [], recovery: [] };
    const tasks = await AgentBoardTask.query().select('id', 'status', 'dependencies_json').where('workspace_id', workspaceId).whereIn('id', known).get();
    const deps = [...new Set(tasks.flatMap(taskDependencies))];
    const completed = new Set(deps.length ? (await AgentBoardTask.query().select('id').where('workspace_id', workspaceId).whereIn('id', deps).where('status', 'done').get()).map(task => String(task.getAttribute('id'))) : []);
    const eligible = new Set(tasks.filter(task => taskDependencies(task).every(id => completed.has(id))).map(task => String(task.getAttribute('id'))));
    const node = await workspaceRepository.getNode(nodeId);
    const coordinator = node?.workspaceId === workspaceId && Boolean((node.payload as {maestro?:boolean}).maestro);
    const occupied = coordinator ? null : rows.find(row => row.getAttribute('active_node_id'));
    return { known, ready: rows.filter(row => eligible.has(String(row.getAttribute('active_task_id')))
      && (occupied ? row === occupied : row.getAttribute('state') === 'queued')).map(row => String(row.getAttribute('active_task_id'))),
      recovery: occupied ? [String(occupied.getAttribute('active_task_id'))] : rows.filter(row => eligible.has(String(row.getAttribute('active_task_id')))
        && ['queued', 'waiting', 'blocked', 'stopped'].includes(row.getAttribute('state'))).map(row => String(row.getAttribute('active_task_id'))) };
  }
  async *statsPages(workspaceId: string, since: string, through: string) {
    let cursor: string | null = null;
    for (;;) {
      const query = AgentTaskExecution.query().select('id', 'state', 'created_at', 'claimed_at', 'submitted_at', 'accepted_at')
        .where('workspace_id', workspaceId).where('created_at', '>=', since).where('created_at', '<=', through).orderBy('id', 'asc').limit(500);
      if (cursor) query.where('id', '>', cursor);
      const rows = await query.get();
      yield rows.map(row => ({ id: String(row.getAttribute('id')), state: String(row.getAttribute('state')),
        createdAt: iso(row.getAttribute('created_at'))!, claimedAt: iso(row.getAttribute('claimed_at')),
        submittedAt: iso(row.getAttribute('submitted_at')), acceptedAt: iso(row.getAttribute('accepted_at')) }));
      if (rows.length < 500) return;
      cursor = String(rows.at(-1)!.getAttribute('id'));
    }
  }
  async pendingNodes(workspaceId: string): Promise<string[]> {
    const rows = await AgentTaskExecution.query().where('workspace_id', workspaceId).where('state', 'queued').limit(512).get();
    return [...new Set(rows.map(row => String(row.getAttribute('node_id'))))];
  }
}
export const taskExecutionRepository = new TaskExecutionRepository();
