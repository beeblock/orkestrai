import { Model } from '@beeblock/svelar/orm';

export class AgentCodeGraphInvestigation extends Model {
  static table = 'agent_code_graph_investigations';
  static primaryKey = 'id';
  static incrementing = false;
  static timestamps = false;
  static fillable = ['id', 'workspace_id', 'name', 'state_json', 'created_by', 'created_at', 'updated_at'];

  declare id: string;
  declare workspace_id: string;
  declare name: string;
  declare state_json: string;
  declare created_by: string;
  declare created_at: Date;
  declare updated_at: Date;
}
