import { Migration } from '@beeblock/svelar/database';

export default class CreateAgentCodeGraphEmbeddingsTable extends Migration {
  async up() {
    await this.schema.createTable('agent_code_graph_embeddings', (table) => {
      table.uuid('id').primary();
      table.uuid('workspace_id').references('id', 'agent_workspaces').onDelete('cascade');
      table.uuid('project_id').references('id', 'agent_code_graph_projects').onDelete('cascade');
      table.uuid('revision_id').references('id', 'agent_code_graph_revisions').onDelete('cascade');
      table.uuid('symbol_id').references('id', 'agent_code_graph_symbols').onDelete('cascade');
      table.string('model');
      table.integer('dimensions');
      table.blob('vector');
      table.string('content_hash');
      table.timestamp('created_at');
      table.timestamp('updated_at');
      table.uniqueIndex(['symbol_id', 'model']);
      table.index(['workspace_id', 'project_id', 'model']);
      table.index(['revision_id']);
    });
  }

  async down() {
    await this.schema.dropTable('agent_code_graph_embeddings');
  }
}
