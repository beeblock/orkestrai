import { Model } from '@beeblock/svelar/orm';

/** Durable assignment attempt. Nullable unique claims fence concurrent dispatches. */
export class AgentTaskExecution extends Model {
  static table = 'agent_task_executions';
  static primaryKey = 'id';
  static incrementing = false;
  static timestamps = false;
  static fillable = ['id', 'workspace_id', 'task_id', 'node_id', 'active_task_id', 'active_node_id',
    'session_id', 'envelope_id', 'state', 'stop_key', 'claimed_at', 'submitted_at', 'accepted_at',
    'settled_at', 'created_at', 'updated_at'];
  declare id: string;
}
