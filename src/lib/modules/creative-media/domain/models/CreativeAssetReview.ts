import { Model } from '@beeblock/svelar/orm';

export class CreativeAssetReview extends Model {
  static table = 'creative_asset_reviews';
  static primaryKey = 'id';
  static incrementing = false;
  static timestamps = false;
  static fillable = ['id', 'workspace_id', 'node_id', 'revision', 'digest', 'decision', 'snapshot_json', 'comment', 'actor_type', 'actor_id', 'created_at', 'updated_at'];
}
