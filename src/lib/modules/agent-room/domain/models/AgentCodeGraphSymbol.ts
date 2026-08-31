import { Model } from '@beeblock/svelar/orm';

export class AgentCodeGraphSymbol extends Model {
  static table = 'agent_code_graph_symbols';
  static primaryKey = 'id';
  static incrementing = false;
  static timestamps = false;
  static fillable = [
    'id', 'workspace_id', 'project_id', 'revision_id', 'file_id',
    'parent_symbol_id', 'kind', 'name', 'qualified_name', 'signature',
    'documentation', 'modifiers_json', 'metadata_json', 'exported', 'start_line',
    'start_column', 'end_line', 'end_column', 'fingerprint', 'created_at',
    'updated_at',
  ];

  static casts = {
    exported: 'boolean' as const,
    start_line: 'number' as const,
    start_column: 'number' as const,
    end_line: 'number' as const,
    end_column: 'number' as const,
    created_at: 'date' as const,
    updated_at: 'date' as const,
  };

  declare id: string;
  declare workspace_id: string;
  declare project_id: string;
  declare revision_id: string;
  declare file_id: string | null;
  declare parent_symbol_id: string | null;
  declare kind: string;
  declare name: string;
  declare qualified_name: string;
  declare signature: string | null;
  declare documentation: string | null;
  declare modifiers_json: string | null;
  declare metadata_json: string | null;
  declare exported: boolean;
  declare start_line: number | null;
  declare start_column: number | null;
  declare end_line: number | null;
  declare end_column: number | null;
  declare fingerprint: string;
  declare created_at: Date;
  declare updated_at: Date;
}
