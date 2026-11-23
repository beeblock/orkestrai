import { Model } from '@beeblock/svelar/orm';
export class AgentBotWorkflowRun extends Model {
  static table = 'agent_bot_workflow_runs';
  static primaryKey = 'id';
  static incrementing = false;
  static timestamps = false;
  static fillable = ['id', 'workspace_id', 'node_id', 'state', 'run_json', 'created_at', 'updated_at'];
  declare id: string;
}
