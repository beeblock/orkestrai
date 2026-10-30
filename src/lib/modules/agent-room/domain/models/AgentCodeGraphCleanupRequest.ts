import { Model } from '@beeblock/svelar/orm';
/** Durable primary outbox, committed atomically with workspace deletion. */
export class AgentCodeGraphCleanupRequest extends Model {
  static table = 'agent_code_graph_cleanup_requests';
  static primaryKey = 'id';
  static incrementing = false;
  static timestamps = false;
  static fillable = ['id', 'workspace_id', 'requested_at'];
}
