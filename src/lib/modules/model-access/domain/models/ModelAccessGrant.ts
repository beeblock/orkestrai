import { Model } from '@beeblock/svelar/orm';

export class ModelAccessGrant extends Model {
  static table = 'model_access_grants';
  static primaryKey = 'id';
  static incrementing = false;
  static timestamps = true;
  static fillable = ['id', 'name', 'status', 'relay_url', 'revision', 'policy_json', 'guest_json', 'requests_used', 'expires_at', 'created_at', 'updated_at'];
}
