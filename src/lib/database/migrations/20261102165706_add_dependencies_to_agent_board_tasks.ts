import { Migration } from '@beeblock/svelar/database';

export default class AddDependenciesToAgentBoardTasks extends Migration {
  async up() {
    await this.schema.table('agent_board_tasks', (table) => {
      table.text('dependencies_json').nullable();
    });
  }

  async down() {
    await this.schema.table('agent_board_tasks', (table) => {
      table.dropColumn('dependencies_json');
    });
  }
}
