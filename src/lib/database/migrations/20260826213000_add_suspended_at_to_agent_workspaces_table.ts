import { Migration } from '@beeblock/svelar/database';

export default class AddSuspendedAtToAgentWorkspacesTable extends Migration {
  async up() {
    await this.schema.table('agent_workspaces', (table) => {
      table.timestamp('suspended_at').nullable();
    });
  }

  async down() {
    await this.schema.table('agent_workspaces', (table) => {
      table.dropColumn('suspended_at');
    });
  }
}
