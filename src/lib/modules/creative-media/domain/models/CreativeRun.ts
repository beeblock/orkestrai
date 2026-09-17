import { Model } from '@beeblock/svelar/orm';

export class CreativeRun extends Model {
  static table = 'creative_runs';
  static primaryKey = 'id';
  static incrementing = false;
  static timestamps = false;
  static fillable = [
    'id', 'workspace_id', 'workflow_id', 'node_id', 'profile_id', 'status', 'snapshot_json',
    'reserved_cents', 'queue_position', 'error_code', 'output_json', 'actor_json', 'idempotency_key',
    'remote_json', 'lease_owner', 'lease_expires_at', 'next_poll_at', 'created_at', 'updated_at',
  ];
}
