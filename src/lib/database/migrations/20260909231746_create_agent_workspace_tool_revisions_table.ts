import { Migration } from '@beeblock/svelar/database';

export default class CreateAgentWorkspaceToolRevisionsTable extends Migration {
  async up() {
    await this.schema.createTable('agent_workspace_tool_revisions', (table) => {
      table.uuid('id').primary();
      table.uuid('tool_id').references('id', 'agent_workspace_tools').onDelete('cascade');
      table.integer('revision');
      table.text('manifest_json');
      table.text('change_summary').nullable();
      table.text('created_by_type');
      table.text('created_by_id').nullable();
      table.timestamp('created_at');
      table.uniqueIndex(['tool_id', 'revision']);
      table.index(['tool_id']);
    });
  }

  async down() { await this.schema.dropTableIfExists('agent_workspace_tool_revisions'); }
}
