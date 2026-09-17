import { Model } from '@beeblock/svelar/orm';

export class CreativeWorkflow extends Model {
  static table = 'creative_workflows';
  static primaryKey = 'id';
  static incrementing = false;
  static timestamps = false;
  static fillable = ['id', 'workspace_id', 'node_id', 'title', 'config_json', 'revision', 'created_at', 'updated_at'];
}
