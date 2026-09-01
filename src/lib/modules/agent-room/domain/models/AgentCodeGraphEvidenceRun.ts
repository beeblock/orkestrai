import { Model } from '@beeblock/svelar/orm';

export class AgentCodeGraphEvidenceRun extends Model {
  static table = 'agent_code_graph_evidence_runs';
  static primaryKey = 'id';
  static incrementing = false;
  static timestamps = false;
  static fillable = ['id', 'workspace_id', 'project_id', 'revision_id', 'kind', 'label', 'source_path', 'content_hash', 'stats_json', 'imported_at', 'created_at', 'updated_at'];

  declare id: string;
  declare workspace_id: string;
  declare project_id: string;
  declare revision_id: string;
  declare kind: string;
  declare label: string;
  declare source_path: string;
  declare content_hash: string;
  declare stats_json: string;
  declare imported_at: Date;
  declare created_at: Date;
  declare updated_at: Date;
}
