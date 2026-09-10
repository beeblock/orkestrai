import { Model } from '@beeblock/svelar/orm';

export class AgentWorkspaceTool extends Model {
  static table = 'agent_workspace_tools';
  static primaryKey = 'id';
  static incrementing = false;
  static timestamps = false;
  static fillable = [
    'id', 'workspace_id', 'node_id', 'name', 'slug', 'description', 'status',
    'current_revision', 'published_revision', 'manifest_json', 'created_by_type', 'created_by_id',
    'created_at', 'updated_at',
  ];
  static casts = { created_at: 'date' as const, updated_at: 'date' as const };
}
