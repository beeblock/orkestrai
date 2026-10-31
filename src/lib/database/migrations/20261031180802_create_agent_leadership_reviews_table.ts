import { Migration } from '@beeblock/svelar/database';

export default class CreateAgentLeadershipReviewsTable extends Migration {
  async up() {
    await this.schema.createTable('agent_leadership_reviews', (table) => {
      table.uuid('id').primary();
      table.uuid('workspace_id').references('id', 'agent_workspaces').onDelete('cascade');
      table.uuid('task_id').references('id', 'agent_board_tasks').onDelete('cascade');
      table.uuid('leadership_revision');
      table.uuid('leader_node_id');
      table.uuid('deputy_node_id');
      table.text('artifacts_json');
      table.string('revision');
      table.string('task_revision');
      table.text('leader_vote_json').nullable();
      table.text('deputy_vote_json').nullable();
      table.string('leader_decision').nullable();
      table.string('deputy_decision').nullable();
      table.integer('findings_count').default(0);
      table.boolean('completion_pending').default(false);
      table.string('status').default('pending');
      table.timestamps();
      table.index(['workspace_id', 'task_id', 'created_at']);
      table.index(['workspace_id', 'status']);
      table.index(['completion_pending']);
    });
  }

  async down() {
    await this.schema.dropTable('agent_leadership_reviews');
  }
}
