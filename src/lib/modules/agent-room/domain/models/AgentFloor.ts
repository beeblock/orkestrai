import { Model } from '@beeblock/svelar/orm';

export class AgentFloor extends Model {
  static table = 'agent_floors';
  static primaryKey = 'id';
  static incrementing = false;
  static timestamps = true;
  static fillable = ['id', 'workspace_id', 'name', 'branch', 'path', 'status', 'base_commit', 'base_kind', 'landed_head'];

  static casts = {
    created_at: 'date' as const,
    updated_at: 'date' as const,
  };

  declare id: string;
  declare workspace_id: string;
  declare name: string;
  declare branch: string;
  declare path: string;
  declare status: string;
  declare base_commit: string | null;
  declare base_kind: string | null;
  declare landed_head: string | null;
  declare created_at: Date;
  declare updated_at: Date;
}
