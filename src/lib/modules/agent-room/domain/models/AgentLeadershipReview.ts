import { Model } from '@beeblock/svelar/orm';

export class AgentLeadershipReview extends Model {
  static table = 'agent_leadership_reviews';
  static primaryKey = 'id';
  static incrementing = false;
  static timestamps = false;
  static fillable = ['id', 'workspace_id', 'task_id', 'leadership_revision', 'leader_node_id', 'deputy_node_id', 'artifacts_json', 'revision', 'task_revision', 'leader_vote_json', 'deputy_vote_json', 'leader_decision', 'deputy_decision', 'findings_count', 'completion_pending', 'status', 'created_at', 'updated_at'];
  static casts = { created_at: 'date' as const, updated_at: 'date' as const };

  declare id: string;
}
