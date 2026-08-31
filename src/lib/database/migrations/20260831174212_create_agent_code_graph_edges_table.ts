import { Migration } from '@beeblock/svelar/database';

export default class CreateAgentCodeGraphEdgesTable extends Migration {
  async up() {
    await this.schema.createTable('agent_code_graph_edges', (table) => {
      table.uuid('id').primary();
      table.uuid('workspace_id').references('id', 'agent_workspaces').onDelete('cascade');
      table.uuid('project_id').references('id', 'agent_code_graph_projects').onDelete('cascade');
      table.uuid('revision_id').references('id', 'agent_code_graph_revisions').onDelete('cascade');
      table.uuid('source_symbol_id').references('id', 'agent_code_graph_symbols').onDelete('cascade');
      table.uuid('target_symbol_id').references('id', 'agent_code_graph_symbols').onDelete('cascade');
      table.uuid('site_file_id').nullable().references('id', 'agent_code_graph_files').onDelete('cascade');
      table.string('kind');
      table.integer('confidence').default(100);
      table.integer('site_line').nullable();
      table.integer('site_column').nullable();
      table.text('metadata_json').nullable();
      table.string('fingerprint');
      table.timestamp('created_at');
      table.timestamp('updated_at');
      table.uniqueIndex(['revision_id', 'fingerprint']);
      table.index(['revision_id', 'source_symbol_id', 'kind']);
      table.index(['revision_id', 'target_symbol_id', 'kind']);
      // SQLite's FK checks query these columns without revision_id. Without
      // dedicated leading indexes, replacing a large revision becomes O(n²).
      table.index(['source_symbol_id']);
      table.index(['target_symbol_id']);
      table.index(['site_file_id']);
      table.index(['workspace_id', 'project_id', 'kind']);
    });
  }

  async down() {
    await this.schema.dropTable('agent_code_graph_edges');
  }
}
