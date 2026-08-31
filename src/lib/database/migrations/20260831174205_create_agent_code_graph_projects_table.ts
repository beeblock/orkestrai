import { Migration } from '@beeblock/svelar/database';

export default class CreateAgentCodeGraphProjectsTable extends Migration {
  async up() {
    await this.schema.createTable('agent_code_graph_projects', (table) => {
      table.uuid('id').primary();
      table.uuid('workspace_id').references('id', 'agent_workspaces').onDelete('cascade');
      table.text('name');
      table.text('root_path');
      table.text('relative_path').nullable();
      table.string('status').default('idle');
      table.uuid('current_revision_id').nullable();
      table.string('git_head').nullable();
      table.string('config_hash').nullable();
      table.text('stats_json').nullable();
      table.text('diagnostics_json').nullable();
      table.timestamp('last_indexed_at').nullable();
      table.timestamp('created_at');
      table.timestamp('updated_at');
      table.uniqueIndex(['workspace_id', 'root_path']);
      table.index(['workspace_id', 'status']);
    });
  }

  async down() {
    await this.schema.dropTable('agent_code_graph_projects');
  }
}
