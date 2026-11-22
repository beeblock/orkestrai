import { Migration } from '@beeblock/svelar/database';

export default class AddHiddenAtToAgentChannelMessages extends Migration {
  async up() {
    await this.schema.table('agent_channel_messages', (table) => {
      table.timestamp('hidden_at').nullable();
      table.index(['workspace_id', 'channel', 'hidden_at', 'created_at'], 'agent_channel_history_visible');
      table.index(['workspace_id', 'hidden_at', 'created_at'], 'agent_channel_history_latest');
    });
  }

  async down() {
    await this.schema.table('agent_channel_messages', (table) => {
      table.dropIndex('agent_channel_history_visible');
      table.dropIndex('agent_channel_history_latest');
      table.dropColumn('hidden_at');
    });
  }
}
