import { Model } from '@beeblock/svelar/orm';

export class AgentBotResult extends Model {
  static table = 'agent_bot_results';
  static primaryKey = 'id';
  static incrementing = false;
  static timestamps = false;
  static fillable = ['id', 'workspace_id', 'node_id', 'message_ids_json', 'body', 'processed_at', 'created_at', 'updated_at'];
  declare id: string;
  declare workspace_id: string;
  declare node_id: string;
  declare message_ids_json: string;
  declare body: string;
}
