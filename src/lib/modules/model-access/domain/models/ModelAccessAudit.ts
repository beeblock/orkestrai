import { Model } from '@beeblock/svelar/orm';

export class ModelAccessAudit extends Model {
  static table = 'model_access_audits';
  static primaryKey = 'id';
  static incrementing = false;
  static timestamps = true;
  static fillable = ['id', 'grant_id', 'event', 'metadata_json', 'created_at', 'updated_at'];
}
