import { Migration } from '@beeblock/svelar/database';

export default class AddLeadershipReviewToAgentBoardTasksTable extends Migration {
  async up() {
    await this.schema.table('agent_board_tasks', (table) => {
      table.uuid('leadership_review_id').nullable();
    });
  }

  async down() {
    await this.schema.table('agent_board_tasks', (table) => {
      table.dropColumn('leadership_review_id');
    });
  }
}
