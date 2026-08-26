import { Model } from '@beeblock/svelar/orm';

export class AgentWorkspace extends Model {
  static table = 'agent_workspaces';
  static primaryKey = 'id';
  static incrementing = false;
  static timestamps = true;
  static fillable = [
    'id',
    'name',
    'working_dir',
    'runtime_kind',
    'wsl_distribution',
    'wsl_working_dir',
    'icon',
    'instructions',
    'sync_agent_instruction_files',
    'repository_roots_json',
    'bridge_token',
    'hooks_json',
    'suspended_at',
    'group_id',
    'position',
  ];

  static casts = {
    sync_agent_instruction_files: 'boolean' as const,
    position: 'number' as const,
    suspended_at: 'date' as const,
    created_at: 'date' as const,
    updated_at: 'date' as const,
  };

  declare id: string;
  declare name: string;
  declare working_dir: string;
  declare runtime_kind: string;
  declare wsl_distribution: string | null;
  declare wsl_working_dir: string | null;
  declare icon: string | null;
  declare instructions: string | null;
  declare sync_agent_instruction_files: boolean;
  declare repository_roots_json: string | null;
  declare hooks_json: string | null;
  declare suspended_at: Date | null;
  declare group_id: string | null;
  declare position: number;
  declare created_at: Date;
  declare updated_at: Date;
}
