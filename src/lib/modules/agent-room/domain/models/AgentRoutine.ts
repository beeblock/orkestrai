import { Model } from '@beeblock/svelar/orm';

export class AgentRoutine extends Model {
  static table = 'agent_routines';
  static primaryKey = 'id';
  static incrementing = false;
  static timestamps = false;
  static fillable = [
    'author_agent_id', 'author_task_id', 'author_key', 'author_digest', 'revision',
    'id',
    'workspace_id',
    'target_node_id',
    'prompt',
    'interval_minutes',
    'enabled',
    'last_run_at',
    'run_count',
    'name',
    'trigger_type',
    'trigger_config_json',
    'action_type',
    'action_config_json',
    'recipe_id',
    'last_trigger_key',
    'updated_at',
    'created_at',
  ];

  static casts = {
    interval_minutes: 'number' as const,
    enabled: 'boolean' as const,
    run_count: 'number' as const,
    last_run_at: 'date' as const,
    created_at: 'date' as const,
    updated_at: 'date' as const,
  };

  declare id: string;
  declare workspace_id: string;
  declare target_node_id: string;
  declare prompt: string;
  declare interval_minutes: number | null;
  declare enabled: boolean;
  declare last_run_at: Date | null;
  declare run_count: number;
  declare name: string | null;
  declare trigger_type: string | null;
  declare trigger_config_json: string | null;
  declare action_type: string | null;
  declare action_config_json: string | null;
  declare recipe_id: string | null;
  declare last_trigger_key: string | null;
  declare updated_at: Date | null;
  declare created_at: Date;
}
