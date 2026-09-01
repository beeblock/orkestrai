import { Model } from '@beeblock/svelar/orm';

export class AgentCodeGraphRevisionManifest extends Model {
  static table = 'agent_code_graph_revision_manifests';
  static primaryKey = 'id';
  static incrementing = false;
  static timestamps = false;
  static fillable = [
    'id', 'workspace_id', 'project_id', 'revision_id', 'source_hash', 'git_head',
    'manifest', 'stats_json', 'completed_at', 'created_at', 'updated_at',
  ];

  declare id: string;
  declare workspace_id: string;
  declare project_id: string;
  declare revision_id: string;
  declare source_hash: string;
  declare git_head: string | null;
  declare manifest: Uint8Array;
  declare stats_json: string;
  declare completed_at: Date;
  declare created_at: Date;
  declare updated_at: Date;
}
