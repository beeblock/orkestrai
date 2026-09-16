import { Model } from '@beeblock/svelar/orm';

export class AgentConversationMessage extends Model {
  static table = 'agent_conversation_messages';
  static primaryKey = 'id';
  static incrementing = false;
  static timestamps = false;
  static fillable = ['id', 'workspace_id', 'grant_id', 'identity', 'digest', 'direction', 'action_id', 'content', 'observed_at'];
}
