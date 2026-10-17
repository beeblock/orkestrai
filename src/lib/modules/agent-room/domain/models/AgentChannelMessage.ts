import { Model } from '@beeblock/svelar/orm';

export class AgentChannelMessage extends Model {
  static table = 'agent_channel_messages';
  static primaryKey = 'id';
  static incrementing = false;
  static timestamps = false;
  static fillable = [
    'id', 'workspace_id', 'channel', 'author_kind', 'author_node_id', 'kind', 'body',
    'meta_json', 'reply_to_id', 'answered_at', 'created_at', 'updated_at',
  ];

  static casts = {
    answered_at: 'date' as const,
    created_at: 'date' as const,
    updated_at: 'date' as const,
  };

  declare id: string;
  declare workspace_id: string;
  declare channel: string;
  declare author_kind: string;
  declare author_node_id: string | null;
  declare kind: string;
  declare body: string;
  declare meta_json: string | null;
  declare reply_to_id: string | null;
  declare answered_at: Date | null;
  declare created_at: Date;
  declare updated_at: Date;
}
