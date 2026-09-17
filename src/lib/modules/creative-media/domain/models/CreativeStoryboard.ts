import { Model } from '@beeblock/svelar/orm';

export class CreativeStoryboard extends Model {
  static table = 'creative_storyboards';
  static primaryKey = 'id';
  static incrementing = false;
  static timestamps = false;
  static fillable = ['id', 'workspace_id', 'node_id', 'revision', 'document_json', 'created_at', 'updated_at'];
}
