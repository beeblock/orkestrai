import { Model } from '@beeblock/svelar/orm';

/** Small telemetry stays with conversations, independent of long graph publications. */
export class AgentCodeGraphUsageBucket extends Model {
  static table = 'agent_code_graph_usage_buckets';
  static primaryKey = 'id';
  static incrementing = false;
  static timestamps = false;
  static fillable = ['id', 'workspace_id', 'hour', 'actor', 'operation', 'counters_json'];
}
