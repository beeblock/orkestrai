import { Model } from '@beeblock/svelar/orm';

export class AgentApprovalGate extends Model {
  static table = 'agent_approval_gates';
  static primaryKey = 'id';
  static incrementing = false;
  static timestamps = false;
  static fillable = ['id', 'workspace_id', 'run_id', 'step_id', 'risk', 'capability', 'target', 'summary', 'status', 'requirement', 'requested_by', 'resolved_by', 'resolution_note', 'request_digest', 'expires_at', 'resolved_at', 'created_at', 'updated_at'];
}
