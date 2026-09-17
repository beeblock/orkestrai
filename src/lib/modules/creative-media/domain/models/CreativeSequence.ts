import { Model } from '@beeblock/svelar/orm';

export class CreativeSequence extends Model {
  static table = 'creative_sequences';
  static primaryKey = 'id'; static incrementing = false; static timestamps = false;
  static fillable = ['id', 'workspace_id', 'node_id', 'revision', 'document_json', 'export_json', 'created_at', 'updated_at'];
}
