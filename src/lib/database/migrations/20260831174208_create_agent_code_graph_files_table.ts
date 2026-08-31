import { Migration } from '@beeblock/svelar/database';

export default class CreateAgentCodeGraphFilesTable extends Migration {
  async up() {
    await this.schema.createTable('agent_code_graph_files', (table) => {
      table.uuid('id').primary();
      table.uuid('workspace_id').references('id', 'agent_workspaces').onDelete('cascade');
      table.uuid('project_id').references('id', 'agent_code_graph_projects').onDelete('cascade');
      table.uuid('revision_id').references('id', 'agent_code_graph_revisions').onDelete('cascade');
      table.text('path');
      table.string('language');
      table.string('content_hash');
      table.integer('byte_size');
      table.boolean('generated').default(false);
      table.integer('symbol_count').default(0);
      table.integer('edge_count').default(0);
      table.timestamp('source_modified_at').nullable();
      table.timestamp('created_at');
      table.timestamp('updated_at');
      table.uniqueIndex(['revision_id', 'path']);
      table.index(['workspace_id', 'project_id', 'language']);
      table.index(['project_id', 'content_hash']);
    });
  }

  async down() {
    await this.schema.dropTable('agent_code_graph_files');
  }
}
