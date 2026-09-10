import { Migration } from '@beeblock/svelar/database';

export default class AddCheckpointToAgentWorkspaceToolRuns extends Migration {
  async up() {
    await this.schema.table('agent_workspace_tool_runs', (table) => {
      table.text('checkpoint_json').nullable();
    });
  }

  async down() {
    await this.schema.table('agent_workspace_tool_runs', (table) => {
      table.dropColumn('checkpoint_json');
    });
  }
}
