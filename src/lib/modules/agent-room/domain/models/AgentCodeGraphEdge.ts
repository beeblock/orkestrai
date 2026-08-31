import { Model } from '@beeblock/svelar/orm';

export class AgentCodeGraphEdge extends Model {
  static table = 'agent_code_graph_edges';
  static primaryKey = 'id';
  static incrementing = false;
  static timestamps = false;
  static fillable = [
    'id', 'workspace_id', 'project_id', 'revision_id', 'source_symbol_id',
    'target_symbol_id', 'site_file_id', 'kind', 'confidence', 'site_line',
    'site_column', 'metadata_json', 'fingerprint', 'created_at', 'updated_at',
  ];

  static casts = {
    confidence: 'number' as const,
    site_line: 'number' as const,
    site_column: 'number' as const,
    created_at: 'date' as const,
    updated_at: 'date' as const,
  };

  declare id: string;
  declare workspace_id: string;
  declare project_id: string;
  declare revision_id: string;
  declare source_symbol_id: string;
  declare target_symbol_id: string;
  declare site_file_id: string | null;
  declare kind: string;
  declare confidence: number;
  declare site_line: number | null;
  declare site_column: number | null;
  declare metadata_json: string | null;
  declare fingerprint: string;
  declare created_at: Date;
  declare updated_at: Date;
}
