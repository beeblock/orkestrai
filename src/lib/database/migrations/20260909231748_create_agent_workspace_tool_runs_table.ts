import { Migration } from '@beeblock/svelar/database';

export default class CreateAgentWorkspaceToolRunsTable extends Migration {
  async up() {
    await this.schema.createTable('agent_workspace_tool_runs', (table) => {
      table.uuid('id').primary();
      table.uuid('workspace_id').references('id', 'agent_workspaces');
      table.uuid('tool_id').references('id', 'agent_workspace_tools').onDelete('cascade');
      table.integer('revision');
      table.text('actor_type');
      table.text('actor_id').nullable();
      table.uuid('automation_run_id').nullable();
      table.text('idempotency_key');
      table.text('request_digest');
      table.text('status');
      table.text('input_json');
      table.text('output_json').nullable();
      table.text('output_digest').nullable();
      table.text('error').nullable();
      table.timestamp('started_at');
      table.timestamp('finished_at').nullable();
      table.integer('duration_ms').nullable();
      table.timestamp('created_at');
      table.timestamp('updated_at');
      table.uniqueIndex(['workspace_id', 'idempotency_key']);
      table.index(['workspace_id', 'created_at']);
      table.index(['tool_id', 'created_at']);
    });
  }

  async down() { await this.schema.dropTableIfExists('agent_workspace_tool_runs'); }
}
