import { Model } from '@beeblock/svelar/orm';

/** One agent's hero in a workspace's Adventure: level, experience and skills. */
export class AgentAdventureHero extends Model {
  static table = 'agent_adventure_heroes';
  static primaryKey = 'id';
  static incrementing = false;
  static timestamps = true;
  static fillable = ['id', 'workspace_id', 'node_id', 'chosen_class', 'level', 'xp', 'skills_json', 'actives_json', 'auto_skills', 'kills'];

  static casts = {
    level: 'number' as const,
    xp: 'number' as const,
    kills: 'number' as const,
    auto_skills: 'boolean' as const,
    created_at: 'date' as const,
    updated_at: 'date' as const,
  };

  declare id: string;
  declare workspace_id: string;
  declare node_id: string;
  declare chosen_class: string | null;
  declare level: number;
  declare xp: number;
  declare skills_json: string;
  declare actives_json: string;
  declare auto_skills: boolean;
  declare kills: number;
  declare created_at: Date;
  declare updated_at: Date;
}
