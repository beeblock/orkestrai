import { Model } from '@beeblock/svelar/orm';

export class AgentIntegrationEvent extends Model {
  static table = 'agent_integration_events';
  static primaryKey = 'id';
  static incrementing = false;
  static timestamps = false;
  static fillable = [
    'id', 'workspace_id', 'integration_id', 'direction', 'kind', 'idempotency_key',
    'status', 'payload_json', 'error', 'processed_at', 'created_at', 'updated_at',
  ];

  static casts = {
    processed_at: 'date' as const,
    created_at: 'date' as const,
    updated_at: 'date' as const,
  };
}
