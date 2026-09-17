import { Model } from '@beeblock/svelar/orm';

export class CreativeRecipe extends Model {
  static table = 'creative_recipes';
  static primaryKey = 'id';
  static incrementing = false;
  static timestamps = false;
  static fillable = ['id', 'workspace_id', 'family_id', 'version', 'name', 'description', 'definition_json', 'digest', 'created_at', 'updated_at'];
}
