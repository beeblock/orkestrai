import { Model } from '@beeblock/svelar/orm';

export class AgentBotConnection extends Model {
  static table = 'agent_bot_connections';
  static primaryKey = 'id';
  static incrementing = false;
  static timestamps = false;
  static fillable = ['id', 'workspace_id', 'name', 'kind', 'enabled', 'created_at', 'updated_at'];
  static casts = { enabled: 'boolean' as const };
  declare id: string;
  declare workspace_id: string;
  declare name: string;
  declare kind: string;
  declare enabled: boolean;
}
