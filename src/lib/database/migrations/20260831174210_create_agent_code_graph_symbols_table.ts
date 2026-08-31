import { Migration } from '@beeblock/svelar/database';

export default class CreateAgentCodeGraphSymbolsTable extends Migration {
  async up() {
    await this.schema.createTable('agent_code_graph_symbols', (table) => {
      table.uuid('id').primary();
      table.uuid('workspace_id').references('id', 'agent_workspaces').onDelete('cascade');
      table.uuid('project_id').references('id', 'agent_code_graph_projects').onDelete('cascade');
      table.uuid('revision_id').references('id', 'agent_code_graph_revisions').onDelete('cascade');
      table.uuid('file_id').nullable().references('id', 'agent_code_graph_files').onDelete('cascade');
      table.uuid('parent_symbol_id').nullable();
      table.string('kind');
      table.text('name');
      table.text('qualified_name');
      table.text('signature').nullable();
      table.text('documentation').nullable();
      table.text('modifiers_json').nullable();
      table.boolean('exported').default(false);
      table.integer('start_line').nullable();
      table.integer('start_column').nullable();
      table.integer('end_line').nullable();
      table.integer('end_column').nullable();
      table.string('fingerprint');
      table.timestamp('created_at');
      table.timestamp('updated_at');
      table.uniqueIndex(['revision_id', 'fingerprint']);
      table.index(['workspace_id', 'project_id', 'kind']);
      table.index(['revision_id', 'name']);
      table.index(['revision_id', 'qualified_name']);
      table.index(['file_id', 'start_line']);
    });
  }

  async down() {
    await this.schema.dropTable('agent_code_graph_symbols');
  }
}
