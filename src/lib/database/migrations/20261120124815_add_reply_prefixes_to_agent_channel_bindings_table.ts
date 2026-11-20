import { Migration } from '@beeblock/svelar/database';

export default class AddReplyPrefixesToAgentChannelBindingsTable extends Migration {
  async up() {
    await this.schema.table('agent_channel_bindings', (table) => {
      table.text('reply_prefixes_json').nullable();
    });
  }

  async down() {
    await this.schema.table('agent_channel_bindings', (table) => {
      table.dropColumn('reply_prefixes_json');
    });
  }
}
