import { Migration } from '@beeblock/svelar/database';
export default class CreateAgentCodeGraphParseCacheTable extends Migration {
  async up() {
    await this.schema.createTable('agent_code_graph_parse_cache', table => {
      table.uuid('id').primary();
      table.uuid('workspace_id').references('id', 'agent_workspaces').onDelete('cascade');
      table.uuid('project_id').references('id', 'agent_code_graph_projects').onDelete('cascade');
      table.string('path');
      table.string('content_hash');
      table.string('config_hash');
      table.blob('data');
      table.timestamp('saved_at');
      table.uniqueIndex(['project_id', 'path']);
    });
  }
  async down() { await this.schema.dropTable('agent_code_graph_parse_cache'); }
}
