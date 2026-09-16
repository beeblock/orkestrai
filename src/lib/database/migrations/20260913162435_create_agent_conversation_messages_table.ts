import { Migration } from '@beeblock/svelar/database';

export default class CreateAgentConversationMessagesTable extends Migration {
  async up() {
    await this.schema.createTable('agent_conversation_messages', (table) => {
      table.uuid('id').primary();
      table.uuid('workspace_id').references('id', 'agent_workspaces').onDelete('cascade');
      table.uuid('grant_id');
      table.string('identity');
      table.string('digest');
      table.string('direction');
      table.uuid('action_id').nullable();
      table.text('content');
      table.timestamp('observed_at');
      table.uniqueIndex(['workspace_id', 'grant_id', 'identity', 'digest'], 'agent_conversation_message_identity');
    });
  }

  async down() {
    await this.schema.dropTable('agent_conversation_messages');
  }
}
