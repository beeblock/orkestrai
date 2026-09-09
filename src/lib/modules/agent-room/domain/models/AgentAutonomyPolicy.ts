import { Model } from '@beeblock/svelar/orm';

export class AgentAutonomyPolicy extends Model {
  static table = 'agent_autonomy_policies';
  static primaryKey = 'id';
  static incrementing = false;
  static timestamps = false;
  static fillable = ['id', 'workspace_id', 'mode', 'enabled', 'policy_json', 'revision', 'created_at', 'updated_at'];
}
