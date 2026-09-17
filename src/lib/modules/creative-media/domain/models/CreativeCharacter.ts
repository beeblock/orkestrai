import { Model } from '@beeblock/svelar/orm';

export class CreativeCharacter extends Model {
  static table = 'creative_characters';
  static primaryKey = 'id';
  static incrementing = false;
  static timestamps = false;
  static fillable = ['id', 'workspace_id', 'family_id', 'version', 'revision', 'state', 'definition_json', 'snapshot_json', 'created_at', 'updated_at'];
}
