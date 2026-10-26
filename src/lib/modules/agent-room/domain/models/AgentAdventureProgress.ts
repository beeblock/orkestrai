import { Model } from '@beeblock/svelar/orm';

/** Where a workspace's party stands on the Adventure's road and what it earned. */
export class AgentAdventureProgress extends Model {
  static table = 'agent_adventure_progress';
  static primaryKey = 'id';
  static incrementing = false;
  static timestamps = true;
  static fillable = ['id', 'workspace_id', 'stage_index', 'wave', 'xp', 'gold', 'kills', 'bosses', 'quests', 'hero_classes_json'];

  static casts = {
    stage_index: 'number' as const,
    wave: 'number' as const,
    xp: 'number' as const,
    gold: 'number' as const,
    kills: 'number' as const,
    bosses: 'number' as const,
    quests: 'number' as const,
    created_at: 'date' as const,
    updated_at: 'date' as const,
  };

  declare id: string;
  declare workspace_id: string;
  declare stage_index: number;
  declare wave: number;
  declare xp: number;
  declare gold: number;
  declare kills: number;
  declare bosses: number;
  declare quests: number;
  declare hero_classes_json: string | null;
  declare created_at: Date;
  declare updated_at: Date;
}
