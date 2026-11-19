import { Migration } from '@beeblock/svelar/database';

export default class CreateAgentBotGroupsTable extends Migration {
  async up() {
    await this.schema.createTable('agent_bot_groups', (table) => {
      table.uuid('id').primary();
      table.uuid('workspace_id').references('id', 'agent_workspaces').onDelete('cascade');
      table.string('title', 120);
      table.text('instructions').nullable();
      table.text('member_ids_json');
      table.uuid('coordinator_id');
      table.integer('revision').default(1);
      table.boolean('archived').default(false);
      table.timestamp('created_at');
      table.timestamp('updated_at');
      table.index(['workspace_id', 'archived']);
    });
  }

  async down() {
    await this.schema.dropTable('agent_bot_groups');
  }
}
