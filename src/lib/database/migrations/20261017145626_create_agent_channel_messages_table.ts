import { Migration } from '@beeblock/svelar/database';

export default class CreateAgentChannelMessagesTable extends Migration {
  async up() {
    await this.schema.createTable('agent_channel_messages', (table) => {
      table.uuid('id').primary();
      table.uuid('workspace_id').references('id', 'agent_workspaces');
      // 'team' or 'dm:<nodeId>'.
      table.string('channel');
      // 'owner' | 'agent' | 'system'.
      table.string('author_kind');
      table.uuid('author_node_id').nullable();
      // 'text' | 'question' | 'answer' | 'event'.
      table.string('kind').default('text');
      table.text('body');
      table.text('meta_json').nullable();
      table.uuid('reply_to_id').nullable();
      table.timestamp('answered_at').nullable();
      table.timestamp('created_at');
      table.timestamp('updated_at');
      table.index(['workspace_id', 'channel', 'created_at']);
      table.index(['workspace_id', 'kind', 'answered_at']);
    });
  }

  async down() {
    await this.schema.dropTable('agent_channel_messages');
  }
}
