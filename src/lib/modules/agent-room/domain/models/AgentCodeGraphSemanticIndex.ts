import { Model } from '@beeblock/svelar/orm';

export class AgentCodeGraphSemanticIndex extends Model {
  static table = 'agent_code_graph_semantic_indexes';
  static primaryKey = 'id';
  static incrementing = false;
  static timestamps = false;
  static fillable = ['id', 'workspace_id', 'model', 'built_at', 'created_at', 'updated_at'];

  declare id: string;
  declare workspace_id: string;
  declare model: string;
  declare built_at: Date;
  declare created_at: Date;
  declare updated_at: Date;
}
