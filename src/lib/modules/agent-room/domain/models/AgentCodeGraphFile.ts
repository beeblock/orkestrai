import { Model } from '@beeblock/svelar/orm';

export class AgentCodeGraphFile extends Model {
  static table = 'agent_code_graph_files';
  static primaryKey = 'id';
  static incrementing = false;
  static timestamps = false;
  static fillable = [
    'id', 'workspace_id', 'project_id', 'revision_id', 'path', 'language',
    'content_hash', 'byte_size', 'generated', 'symbol_count', 'edge_count',
    'source_modified_at', 'created_at', 'updated_at',
  ];

  static casts = {
    byte_size: 'number' as const,
    generated: 'boolean' as const,
    symbol_count: 'number' as const,
    edge_count: 'number' as const,
    source_modified_at: 'date' as const,
    created_at: 'date' as const,
    updated_at: 'date' as const,
  };

  declare id: string;
  declare workspace_id: string;
  declare project_id: string;
  declare revision_id: string;
  declare path: string;
  declare language: string;
  declare content_hash: string;
  declare byte_size: number;
  declare generated: boolean;
  declare symbol_count: number;
  declare edge_count: number;
  declare source_modified_at: Date | null;
  declare created_at: Date;
  declare updated_at: Date;
}
