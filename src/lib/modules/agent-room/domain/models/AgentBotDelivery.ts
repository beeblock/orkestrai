import { Model } from '@beeblock/svelar/orm';

export class AgentBotDelivery extends Model {
  static table = 'agent_bot_deliveries';
  static primaryKey = 'id';
  static incrementing = false;
  static timestamps = false;
  static fillable = ['id', 'workspace_id', 'node_id', 'binding_id', 'state', 'lease_token', 'created_at', 'updated_at'];
  declare id: string;
  declare workspace_id: string;
  declare node_id: string;
  declare binding_id: string;
  declare state: string;
  declare lease_token: string | null;
}
