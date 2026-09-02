import { Migration } from '@beeblock/svelar/database';

export default class AddCodeIntelligenceModeToAgentWorkspacesTable extends Migration {
  async up() {
    await this.schema.table('agent_workspaces', (table) => {
      table.string('code_intelligence_mode').default('assisted');
    });
  }

  async down() {
    await this.schema.table('agent_workspaces', (table) => {
      table.dropColumn('code_intelligence_mode');
    });
  }
}
