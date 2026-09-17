import { Model } from '@beeblock/svelar/orm';

export class CreativeBrandKit extends Model {
  static table = 'creative_brand_kits';
  static primaryKey = 'id';
  static incrementing = false;
  static timestamps = false;
  static fillable = ['id', 'workspace_id', 'family_id', 'version', 'revision', 'state', 'definition_json', 'snapshot_json', 'created_at', 'updated_at'];
}
