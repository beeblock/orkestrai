import { Migration } from '@beeblock/svelar/database';

export default class CreateAgentConversationMemoriesTable extends Migration {
  async up() {
    await this.schema.createTable('agent_conversation_memories', (table) => {
      table.uuid('id').primary();
      table.uuid('workspace_id').references('id', 'agent_workspaces').onDelete('cascade');
      table.uuid('grant_id');
      table.string('identity');
      table.string('title');
      table.text('content');
      table.text('sources_json');
      table.integer('revision').default(1);
      table.timestamp('created_at');
      table.timestamp('updated_at');
    });
  }

  async down() {
    await this.schema.dropTable('agent_conversation_memories');
  }
}
