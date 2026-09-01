import { Migration } from '@beeblock/svelar/database';

export default class CreateAgentCodeGraphEvidenceRunsTable extends Migration {
  async up() {
    await this.schema.createTable('agent_code_graph_evidence_runs', (table) => {
      table.uuid('id').primary();
      table.uuid('workspace_id').references('id', 'agent_workspaces').onDelete('cascade');
      table.uuid('project_id').references('id', 'agent_code_graph_projects').onDelete('cascade');
      table.uuid('revision_id').references('id', 'agent_code_graph_revisions').onDelete('cascade');
      table.string('kind');
      table.string('label');
      table.text('source_path');
      table.string('content_hash');
      table.text('stats_json');
      table.timestamp('imported_at');
      table.timestamp('created_at');
      table.timestamp('updated_at');
      table.uniqueIndex(['project_id', 'source_path']);
      table.index(['workspace_id', 'imported_at']);
      table.index(['revision_id']);
    });
  }

  async down() {
    await this.schema.dropTable('agent_code_graph_evidence_runs');
  }
}
