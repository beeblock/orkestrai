import { Migration } from '@beeblock/svelar/database';

export default class CreateAgentCodeGraphManifestChunksTable extends Migration {
  async up() {
    await this.schema.createTable('agent_code_graph_manifest_chunks', (table) => {
      table.uuid('id').primary();
      table.uuid('workspace_id').references('id', 'agent_workspaces').onDelete('cascade');
      table.uuid('project_id').references('id', 'agent_code_graph_projects').onDelete('cascade');
      table.string('content_hash');
      table.blob('data');
      table.uniqueIndex(['project_id', 'content_hash']);
    });
  }

  async down() {
    await this.schema.dropTable('agent_code_graph_manifest_chunks');
  }
}
