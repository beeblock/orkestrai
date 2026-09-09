import { Model } from '@beeblock/svelar/orm';

export class AgentSecretRef extends Model {
  static table = 'agent_secret_refs';
  static primaryKey = 'id';
  static incrementing = false;
  static timestamps = false;
  static fillable = ['id', 'workspace_id', 'name', 'purpose', 'provider', 'secret_key', 'bindings_json', 'enabled', 'last_used_at', 'created_at', 'updated_at'];
}
