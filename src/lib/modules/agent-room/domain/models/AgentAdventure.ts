import { Model } from '@beeblock/svelar/orm';

/** A workspace's Adventure account: map, wallet, chests, runes, cube and settings (JSON). */
export class AgentAdventure extends Model {
  static table = 'agent_adventures';
  static primaryKey = 'id';
  static incrementing = false;
  static timestamps = true;
  static fillable = ['id', 'workspace_id', 'account_json'];

  static casts = {
    created_at: 'date' as const,
    updated_at: 'date' as const,
  };

  declare id: string;
  declare workspace_id: string;
  declare account_json: string;
  declare created_at: Date;
  declare updated_at: Date;
}
