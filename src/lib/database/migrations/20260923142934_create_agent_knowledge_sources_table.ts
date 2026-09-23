import { Migration } from '@beeblock/svelar/database';

export default class CreateAgentKnowledgeSourcesTable extends Migration {
  async up() {
    await this.schema.createTable('agent_knowledge_sources', (table) => {
      table.uuid('id').primary();
      table.uuid('workspace_id').references('id', 'agent_workspaces');
      table.string('source_key');
      table.text('document_json');
      table.timestamp('updated_at');
      table.uniqueIndex(['workspace_id', 'source_key']);
    });
  }

  async down() {
    await this.schema.dropTable('agent_knowledge_sources');
  }
}
