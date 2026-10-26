import { Migration } from '@beeblock/svelar/database';

export default class CreateAgentAdventuresTable extends Migration {
  async up() {
    await this.schema.createTable('agent_adventures', (table) => {
      table.uuid('id').primary();
      table.uuid('workspace_id').references('id', 'agent_workspaces').onDelete('cascade');
      table.text('account_json');
      table.timestamp('created_at');
      table.timestamp('updated_at');
      table.uniqueIndex(['workspace_id']);
    });
  }

  async down() {
    await this.schema.dropTable('agent_adventures');
  }
}
