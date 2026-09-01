import { Model } from '@beeblock/svelar/orm';

export class AgentCodeGraphEvidenceEdge extends Model {
  static table = 'agent_code_graph_evidence_edges';
  static primaryKey = 'id';
  static incrementing = false;
  static timestamps = false;
  static fillable = ['id', 'run_id', 'workspace_id', 'project_id', 'revision_id', 'source_symbol_id', 'target_symbol_id', 'kind', 'count', 'confidence', 'metadata_json', 'created_at'];

  declare id: string;
  declare run_id: string;
  declare workspace_id: string;
  declare project_id: string;
  declare revision_id: string;
  declare source_symbol_id: string | null;
  declare target_symbol_id: string;
  declare kind: string;
  declare count: number;
  declare confidence: number;
  declare metadata_json: string | null;
  declare created_at: Date;
}
