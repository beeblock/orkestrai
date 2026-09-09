import { Model } from '@beeblock/svelar/orm';

export class AgentComputerAction extends Model {
  static table = 'agent_computer_actions';
  static primaryKey = 'id';
  static incrementing = false;
  static timestamps = false;
  static fillable = [
    'id', 'workspace_id', 'node_id', 'actor_type', 'actor_id', 'command',
    'idempotency_key', 'request_digest', 'status', 'result_json', 'error', 'created_at', 'updated_at',
  ];

  static casts = {
    created_at: 'date' as const,
    updated_at: 'date' as const,
  };
}
