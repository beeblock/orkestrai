import { Migration } from '@beeblock/svelar/database';

export default class CreateAgentWorkspaceToolsTable extends Migration {
  async up() {
    await this.schema.createTable('agent_workspace_tools', (table) => {
      table.uuid('id').primary();
      table.uuid('workspace_id').references('id', 'agent_workspaces');
      table.uuid('node_id').nullable();
      table.text('name');
      table.text('slug');
      table.text('description');
      table.text('status').default('draft');
      table.integer('current_revision').default(1);
      table.integer('published_revision').nullable();
      table.text('manifest_json');
      table.text('created_by_type');
      table.text('created_by_id').nullable();
      table.timestamp('created_at');
      table.timestamp('updated_at');
      table.uniqueIndex(['workspace_id', 'slug']);
      table.index(['workspace_id', 'status']);
      table.index(['node_id']);
    });
  }

  async down() { await this.schema.dropTableIfExists('agent_workspace_tools'); }
}
