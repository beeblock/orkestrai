import { Migration } from '@beeblock/svelar/database';

export default class CreateAgentBotConnectionsTable extends Migration {
  async up() {
    await this.schema.createTable('agent_bot_connections', (table) => {
      table.uuid('id').primary();
      table.uuid('workspace_id').references('id', 'agent_workspaces').onDelete('cascade');
      table.string('name', 120);
      table.string('kind', 30);
      table.boolean('enabled').default(true);
      table.timestamp('created_at');
      table.timestamp('updated_at');
      table.index(['workspace_id', 'enabled']);
    });
  }

  async down() {
    await this.schema.dropTable('agent_bot_connections');
  }
}
