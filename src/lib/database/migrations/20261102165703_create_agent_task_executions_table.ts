import { Migration } from '@beeblock/svelar/database';

export default class CreateAgentTaskExecutionsTable extends Migration {
  async up() {
    await this.schema.createTable('agent_task_executions', (table) => {
      table.uuid('id').primary();
      table.uuid('workspace_id').references('id', 'agent_workspaces').onDelete('cascade');
      table.uuid('task_id').references('id', 'agent_board_tasks').onDelete('cascade');
      table.uuid('node_id');
      table.uuid('active_task_id').nullable();
      table.uuid('active_node_id').nullable();
      table.uuid('session_id').nullable();
      table.uuid('envelope_id').nullable();
      table.string('state').default('queued');
      table.string('stop_key').nullable();
      table.timestamp('claimed_at').nullable();
      table.timestamp('submitted_at').nullable();
      table.timestamp('accepted_at').nullable();
      table.timestamp('settled_at').nullable();
      table.uniqueIndex(['active_task_id']);
      table.uniqueIndex(['active_node_id']);
      table.index(['workspace_id', 'node_id', 'state']);
      table.index(['workspace_id', 'task_id', 'id']);
      table.timestamps();
    });
  }

  async down() {
    await this.schema.dropTable('agent_task_executions');
  }
}
