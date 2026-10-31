import { Model } from '@beeblock/svelar/orm';

export class AgentLeadershipHandoff extends Model {
  static table = 'agent_leadership_handoffs';
  static primaryKey = 'id';
  static incrementing = false;
  static timestamps = false;
  static fillable = ['id', 'workspace_id', 'from_node_id', 'to_node_id', 'configuration_revision', 'request_id', 'context_json', 'brief', 'status', 'acknowledged_at', 'created_at', 'updated_at'];
  static casts = { created_at: 'date' as const, updated_at: 'date' as const, acknowledged_at: 'date' as const };

  declare id: string;
}
