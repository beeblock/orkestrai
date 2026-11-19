import { Model } from '@beeblock/svelar/orm';

export class AgentBotGroup extends Model {
  static table = 'agent_bot_groups';
  static primaryKey = 'id';
  static incrementing = false;
  static timestamps = false;
  static fillable = ['id', 'workspace_id', 'title', 'instructions', 'member_ids_json', 'coordinator_id', 'revision', 'archived', 'created_at', 'updated_at'];
  static casts = { archived: 'boolean' as const };
  declare id: string;
  declare workspace_id: string;
  declare title: string;
  declare instructions: string | null;
  declare member_ids_json: string;
  declare coordinator_id: string;
  declare revision: number;
  declare archived: boolean;
}
