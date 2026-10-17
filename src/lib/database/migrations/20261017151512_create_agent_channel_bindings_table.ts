import { Migration } from '@beeblock/svelar/database';

export default class CreateAgentChannelBindingsTable extends Migration {
  async up() {
    await this.schema.createTable('agent_channel_bindings', (table) => {
      table.uuid('id').primary();
      table.uuid('workspace_id').references('id', 'agent_workspaces');
      table.uuid('node_id');
      table.uuid('integration_id');
      // 'telegram' | 'slack'
      table.string('kind');
      // Telegram chat id or Slack channel id the agent listens to and answers in.
      table.string('external_chat_id');
      // JSON array of sender ids allowed to talk to the agent; empty = anyone in that chat.
      table.text('allowed_senders_json').nullable();
      table.string('cursor').nullable();
      table.boolean('enabled').default(true);
      table.text('last_error').nullable();
      table.timestamp('last_inbound_at').nullable();
      table.timestamp('created_at');
      table.timestamp('updated_at');
      table.index(['workspace_id', 'node_id']);
      table.index(['enabled']);
    });
  }

  async down() {
    await this.schema.dropTable('agent_channel_bindings');
  }
}
