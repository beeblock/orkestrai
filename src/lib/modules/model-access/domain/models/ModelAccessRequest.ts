import { Model } from '@beeblock/svelar/orm';
export class ModelAccessRequest extends Model {
  static table = 'model_access_requests'; static primaryKey = 'id'; static incrementing = false; static timestamps = true;
  static fillable = ['id','grant_id','revision','status','created_at','updated_at'];
}
