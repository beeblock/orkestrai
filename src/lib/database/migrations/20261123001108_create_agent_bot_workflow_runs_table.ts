import { Migration } from '@beeblock/svelar/database';
export default class CreateAgentBotWorkflowRunsTable extends Migration {
  async up() {
    await this.schema.createTable('agent_bot_workflow_runs', table => {
      table.uuid('id').primary();
      table.uuid('workspace_id').references('id', 'agent_workspaces').onDelete('cascade');
      table.uuid('node_id');
      table.string('state', 30).default('queued');
      table.text('run_json');
      table.timestamp('created_at');
      table.timestamp('updated_at');
      table.index(['state', 'id']);
      table.index(['workspace_id', 'node_id', 'state']);
    });
  }
  async down() { await this.schema.dropTable('agent_bot_workflow_runs'); }
}
