import { Migration } from '@beeblock/svelar/database';

export default class CreateAgentBotDeliveriesTable extends Migration {
  async up() {
    await this.schema.createTable('agent_bot_deliveries', (table) => {
      table.uuid('id').primary();
      table.uuid('workspace_id').references('id', 'agent_workspaces').onDelete('cascade');
      table.uuid('node_id');
      table.uuid('binding_id');
      table.string('state', 30).default('queued');
      table.uuid('lease_token').nullable();
      table.timestamp('created_at');
      table.timestamp('updated_at');
      table.index(['state', 'id']);
    });
  }

  async down() {
    await this.schema.dropTable('agent_bot_deliveries');
  }
}
