import { Model } from '@beeblock/svelar/orm';

export class AgentWorkspaceToolRun extends Model {
  static table = 'agent_workspace_tool_runs';
  static primaryKey = 'id';
  static incrementing = false;
  static timestamps = false;
  static fillable = [
    'id', 'workspace_id', 'tool_id', 'revision', 'actor_type', 'actor_id',
    'automation_run_id', 'idempotency_key', 'request_digest', 'status',
    'input_json', 'output_json', 'output_digest', 'error', 'started_at',
    'finished_at', 'duration_ms', 'created_at', 'updated_at',
  ];
  static casts = {
    started_at: 'date' as const, finished_at: 'date' as const,
    created_at: 'date' as const, updated_at: 'date' as const,
  };
}
