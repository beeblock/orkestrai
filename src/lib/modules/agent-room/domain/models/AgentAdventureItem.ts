import { Model } from '@beeblock/svelar/orm';

/** A piece of Adventure gear: in the inventory, the stash or worn by a hero. */
export class AgentAdventureItem extends Model {
  static table = 'agent_adventure_items';
  static primaryKey = 'id';
  static incrementing = false;
  static timestamps = true;
  static fillable = ['id', 'workspace_id', 'location', 'hero_id', 'slot', 'class_id', 'rarity', 'level', 'affixes_json', 'sockets_json', 'locked'];

  static casts = {
    level: 'number' as const,
    locked: 'boolean' as const,
    created_at: 'date' as const,
    updated_at: 'date' as const,
  };

  declare id: string;
  declare workspace_id: string;
  declare location: string;
  declare hero_id: string | null;
  declare slot: string;
  declare class_id: string | null;
  declare rarity: string;
  declare level: number;
  declare affixes_json: string;
  declare sockets_json: string;
  declare locked: boolean;
  declare created_at: Date;
  declare updated_at: Date;
}
