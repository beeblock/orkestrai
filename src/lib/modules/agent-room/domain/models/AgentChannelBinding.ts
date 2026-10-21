import { Model } from '@beeblock/svelar/orm';

export class AgentChannelBinding extends Model {
  static table = 'agent_channel_bindings';
  static primaryKey = 'id';
  static incrementing = false;
  static timestamps = false;
  static fillable = [
    'id', 'workspace_id', 'node_id', 'integration_id', 'kind', 'external_chat_id', 'allowed_senders_json',
    'cursor', 'enabled', 'last_error', 'last_inbound_at', 'created_at', 'updated_at',
  ];

  static casts = {
    enabled: 'boolean' as const,
    last_inbound_at: 'date' as const,
    created_at: 'date' as const,
    updated_at: 'date' as const,
  };

  declare id: string;
  declare workspace_id: string;
  declare node_id: string;
  declare integration_id: string;
  declare kind: string;
  declare external_chat_id: string;
  declare allowed_senders_json: string | null;
  declare cursor: string | null;
  declare enabled: boolean;
  declare last_error: string | null;
  declare last_inbound_at: Date | null;
  declare created_at: Date;
  declare updated_at: Date;
}
