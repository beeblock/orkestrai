import { Model } from '@beeblock/svelar/orm';

export class CreativeWorkspacePolicy extends Model {
  static table = 'creative_workspace_policies';
  static primaryKey = 'id';
  static incrementing = false;
  static timestamps = false;
  static fillable = ['id', 'workspace_id', 'profile_id', 'policy_json', 'revision', 'created_at', 'updated_at'];
}
