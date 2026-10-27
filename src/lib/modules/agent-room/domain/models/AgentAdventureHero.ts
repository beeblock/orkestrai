import { Model } from '@beeblock/svelar/orm';

/** A hero of a workspace's Adventure guild; agents come and go, the hero stays. */
export class AgentAdventureHero extends Model {
  static table = 'agent_adventure_heroes';
  static primaryKey = 'id';
  static incrementing = false;
  static timestamps = true;
  static fillable = ['id', 'workspace_id', 'name', 'class_id', 'chosen_class', 'leader', 'agent_node_id', 'agent_title', 'level', 'paragon', 'xp', 'skills_json', 'actives_json', 'auto_skills', 'auto_gear', 'kills'];

  static casts = {
    leader: 'boolean' as const,
    level: 'number' as const,
    paragon: 'number' as const,
    xp: 'number' as const,
    kills: 'number' as const,
    auto_skills: 'boolean' as const,
    auto_gear: 'boolean' as const,
    created_at: 'date' as const,
    updated_at: 'date' as const,
  };

  declare id: string;
  declare workspace_id: string;
  declare name: string;
  declare class_id: string;
  declare chosen_class: string | null;
  declare leader: boolean;
  declare agent_node_id: string | null;
  declare agent_title: string | null;
  declare level: number;
  declare paragon: number;
  declare xp: number;
  declare skills_json: string;
  declare actives_json: string;
  declare auto_skills: boolean;
  declare auto_gear: boolean;
  declare kills: number;
  declare created_at: Date;
  declare updated_at: Date;
}
