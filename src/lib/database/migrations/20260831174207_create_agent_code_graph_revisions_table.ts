import { Migration } from '@beeblock/svelar/database';

export default class CreateAgentCodeGraphRevisionsTable extends Migration {
  async up() {
    await this.schema.createTable('agent_code_graph_revisions', (table) => {
      table.uuid('id').primary();
      table.uuid('workspace_id').references('id', 'agent_workspaces').onDelete('cascade');
      table.uuid('project_id').references('id', 'agent_code_graph_projects').onDelete('cascade');
      table.integer('sequence');
      table.string('state').default('building');
      table.string('source_hash').nullable();
      table.string('git_head').nullable();
      table.text('stats_json').nullable();
      table.text('diagnostics_json').nullable();
      table.timestamp('started_at');
      table.timestamp('completed_at').nullable();
      table.timestamp('created_at');
      table.timestamp('updated_at');
      table.uniqueIndex(['project_id', 'sequence']);
      table.index(['workspace_id', 'state']);
    });
  }

  async down() {
    await this.schema.dropTable('agent_code_graph_revisions');
  }
}
