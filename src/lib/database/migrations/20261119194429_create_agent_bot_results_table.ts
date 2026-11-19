import { Migration } from '@beeblock/svelar/database';

export default class CreateAgentBotResultsTable extends Migration {
  async up() {
    await this.schema.createTable('agent_bot_results', (table) => {
      table.uuid('id').primary();
      table.uuid('workspace_id').references('id', 'agent_workspaces').onDelete('cascade');
      table.uuid('node_id');
      table.text('message_ids_json');
      table.text('body');
      table.timestamp('processed_at').nullable();
      table.timestamp('created_at');
      table.timestamp('updated_at');
      table.index(['processed_at', 'id']);
    });
  }

  async down() {
    await this.schema.dropTable('agent_bot_results');
  }
}
