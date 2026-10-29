import { Model } from '@beeblock/svelar/orm';

export class ModelAccessConnection extends Model {
  static table = 'model_access_connections';
  static primaryKey = 'id';
  static incrementing = false;
  static timestamps = true;
  static fillable = ['id', 'grant_id', 'name', 'relay_url', 'owner_public_key', 'guest_id', 'guest_name', 'status', 'policy_json', 'expires_at', 'created_at', 'updated_at'];
}
