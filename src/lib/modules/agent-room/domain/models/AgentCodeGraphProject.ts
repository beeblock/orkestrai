import { Model } from '@beeblock/svelar/orm';

export class AgentCodeGraphProject extends Model {
  static table = 'agent_code_graph_projects';
  static primaryKey = 'id';
  static incrementing = false;
  static timestamps = false;
  static fillable = [
    'id', 'workspace_id', 'name', 'root_path', 'relative_path', 'status',
    'current_revision_id', 'git_head', 'config_hash', 'stats_json',
    'diagnostics_json', 'last_indexed_at', 'created_at', 'updated_at',
  ];

  static casts = {
    last_indexed_at: 'date' as const,
    created_at: 'date' as const,
    updated_at: 'date' as const,
  };

  declare id: string;
  declare workspace_id: string;
  declare name: string;
  declare root_path: string;
  declare relative_path: string | null;
  declare status: string;
  declare current_revision_id: string | null;
  declare git_head: string | null;
  declare config_hash: string | null;
  declare stats_json: string | null;
  declare diagnostics_json: string | null;
  declare last_indexed_at: Date | null;
  declare created_at: Date;
  declare updated_at: Date;
}
