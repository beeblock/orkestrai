import { Migration } from '@beeblock/svelar/database';

export default class AddBotSourceMessageToAgentBoardTasksTable extends Migration {
  async up() {
    await this.schema.table('agent_board_tasks', table => { table.uuid('bot_source_message_id').nullable(); });
  }
  async down() {
    await this.schema.table('agent_board_tasks', table => { table.dropColumn('bot_source_message_id'); });
  }
}
