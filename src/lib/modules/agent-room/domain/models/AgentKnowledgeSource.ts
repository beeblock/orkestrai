import { Model } from '@beeblock/svelar/orm';

export class AgentKnowledgeSource extends Model {
  static table = 'agent_knowledge_sources';
  static primaryKey = 'id';
  static incrementing = false;
  static timestamps = false;
  static fillable = ['id', 'workspace_id', 'source_key', 'document_json', 'updated_at'];
}
