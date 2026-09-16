import { Model } from '@beeblock/svelar/orm';

export class AgentConversationMemory extends Model {
  static table = 'agent_conversation_memories';
  static primaryKey = 'id';
  static incrementing = false;
  static timestamps = false;
  static fillable = ['id', 'workspace_id', 'grant_id', 'identity', 'title', 'content', 'sources_json', 'revision', 'created_at', 'updated_at'];
}
