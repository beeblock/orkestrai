import { Model } from '@beeblock/svelar/orm';

export class AgentCodeGraphRevision extends Model {
  static table = 'agent_code_graph_revisions';
  static primaryKey = 'id';
  static incrementing = false;
  static timestamps = false;
  static fillable = [
    'id', 'workspace_id', 'project_id', 'sequence', 'state', 'source_hash',
    'git_head', 'stats_json', 'diagnostics_json', 'started_at', 'completed_at',
    'created_at', 'updated_at',
  ];

  static casts = {
    sequence: 'number' as const,
    started_at: 'date' as const,
    completed_at: 'date' as const,
    created_at: 'date' as const,
    updated_at: 'date' as const,
  };

  declare id: string;
  declare workspace_id: string;
  declare project_id: string;
  declare sequence: number;
  declare state: string;
  declare source_hash: string | null;
  declare git_head: string | null;
  declare stats_json: string | null;
  declare diagnostics_json: string | null;
  declare started_at: Date;
  declare completed_at: Date | null;
  declare created_at: Date;
  declare updated_at: Date;
}
