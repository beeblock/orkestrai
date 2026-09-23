import { Model } from '@beeblock/svelar/orm';

export class AgentLearningEntry extends Model {
  static table = 'agent_learning_entries';
  static primaryKey = 'id';
  static incrementing = false;
  static timestamps = false;
  static fillable = ['id', 'workspace_id', 'node_id', 'task_id', 'status', 'fingerprint', 'revision', 'document_json', 'created_at', 'updated_at'];
}
