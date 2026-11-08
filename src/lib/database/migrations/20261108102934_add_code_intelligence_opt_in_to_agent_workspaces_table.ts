import { Migration } from '@beeblock/svelar/database';

export default class AddCodeIntelligenceOptInToAgentWorkspacesTable extends Migration {
  async up() {
    await this.schema.table('agent_workspaces', (table) => {
      table.boolean('code_intelligence_opt_in').default(false);
    });
  }

  async down() {
    await this.schema.table('agent_workspaces', (table) => {
      table.dropColumn('code_intelligence_opt_in');
    });
  }
}
