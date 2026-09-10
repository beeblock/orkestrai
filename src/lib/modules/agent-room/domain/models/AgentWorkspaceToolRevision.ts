import { Model } from '@beeblock/svelar/orm';

export class AgentWorkspaceToolRevision extends Model {
  static table = 'agent_workspace_tool_revisions';
  static primaryKey = 'id';
  static incrementing = false;
  static timestamps = false;
  static fillable = [
    'id', 'tool_id', 'revision', 'manifest_json', 'change_summary',
    'created_by_type', 'created_by_id', 'created_at',
  ];
  static casts = { created_at: 'date' as const };
}
