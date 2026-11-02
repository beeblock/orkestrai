import { Model } from '@beeblock/svelar/orm';

export class AgentBoardTask extends Model {
  static table = 'agent_board_tasks';
  static primaryKey = 'id';
  static incrementing = false;
  static timestamps = false;
  static fillable = [
    'id',
    'workspace_id',
    'title',
    'description',
    'dependencies_json',
    'status',
    'assignee_node_id',
    'image_path',
    'images_json',
    'attachments_json',
    'note_node_id',
    'created_by',
    'created_at',
    'updated_at',
    'leadership_review_id',
  ];

  static casts = {
    created_at: 'date' as const,
    updated_at: 'date' as const,
  };

  declare id: string;
  declare workspace_id: string;
  declare title: string;
  declare description: string | null;
  declare status: string;
  declare assignee_node_id: string | null;
  declare image_path: string | null;
  declare images_json: string | null;
  declare attachments_json: string | null;
  declare note_node_id: string | null;
  declare created_by: string;
  declare created_at: string;
  declare updated_at: string;
}
