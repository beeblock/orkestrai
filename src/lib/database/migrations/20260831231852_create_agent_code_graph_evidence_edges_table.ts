import { Migration } from '@beeblock/svelar/database';

export default class CreateAgentCodeGraphEvidenceEdgesTable extends Migration {
  async up() {
    await this.schema.createTable('agent_code_graph_evidence_edges', (table) => {
      table.uuid('id').primary();
      table.uuid('run_id').references('id', 'agent_code_graph_evidence_runs').onDelete('cascade');
      table.uuid('workspace_id').references('id', 'agent_workspaces').onDelete('cascade');
      table.uuid('project_id').references('id', 'agent_code_graph_projects').onDelete('cascade');
      table.uuid('revision_id').references('id', 'agent_code_graph_revisions').onDelete('cascade');
      table.uuid('source_symbol_id').nullable().references('id', 'agent_code_graph_symbols').onDelete('cascade');
      table.uuid('target_symbol_id').references('id', 'agent_code_graph_symbols').onDelete('cascade');
      table.string('kind');
      table.integer('count').default(1);
      table.integer('confidence').default(100);
      table.text('metadata_json').nullable();
      table.timestamp('created_at');
      table.uniqueIndex(['run_id', 'source_symbol_id', 'target_symbol_id', 'kind']);
      table.index(['workspace_id', 'kind']);
      table.index(['revision_id']);
      table.index(['source_symbol_id']);
      table.index(['target_symbol_id']);
    });
  }

  async down() {
    await this.schema.dropTable('agent_code_graph_evidence_edges');
  }
}
