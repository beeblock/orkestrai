import { Model } from '@beeblock/svelar/orm';

export class AgentComputerInbox extends Model {
  static table = 'agent_computer_inboxes';
  static primaryKey = 'id';
  static incrementing = false;
  static timestamps = false;
  static fillable = ['id', 'workspace_id', 'grant_id', 'revision', 'state_json', 'updated_at'];
}
