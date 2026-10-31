import { Model } from '@beeblock/svelar/orm';

export class AgentWorkspaceLeadership extends Model {
  static table = 'agent_workspace_leaderships';
  static primaryKey = 'id';
  static incrementing = false;
  static timestamps = false;
  static fillable = ['id', 'workspace_id', 'leader_node_id', 'deputy_node_id', 'revision', 'last_request_id', 'created_at', 'updated_at'];
  static casts = { created_at: 'date' as const, updated_at: 'date' as const };

  declare id: string;
}
