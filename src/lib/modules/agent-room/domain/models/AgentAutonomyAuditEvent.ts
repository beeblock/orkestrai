import { Model } from '@beeblock/svelar/orm';

export class AgentAutonomyAuditEvent extends Model {
  static table = 'agent_autonomy_audit_events';
  static primaryKey = 'id';
  static incrementing = false;
  static timestamps = false;
  static fillable = ['id', 'workspace_id', 'run_id', 'step_id', 'correlation_id', 'actor_type', 'actor_id', 'event_type', 'capability', 'target', 'certainty', 'policy_revision', 'input_digest', 'output_digest', 'metadata_json', 'previous_hash', 'event_hash', 'created_at'];
}
