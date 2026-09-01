import { Migration } from '@beeblock/svelar/database';

export default class CreateAgentCodeGraphSemanticIndexesTable extends Migration {
  async up() {
    await this.schema.createTable('agent_code_graph_semantic_indexes', (table) => {
      table.uuid('id').primary();
      table.uuid('workspace_id').references('id', 'agent_workspaces').onDelete('cascade');
      table.string('model');
      table.timestamp('built_at');
      table.timestamp('created_at');
      table.timestamp('updated_at');
      table.uniqueIndex(['workspace_id', 'model']);
    });
  }

  async down() {
    await this.schema.dropTable('agent_code_graph_semantic_indexes');
  }
}
