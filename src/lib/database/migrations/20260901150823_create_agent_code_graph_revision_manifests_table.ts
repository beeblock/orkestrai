import { Migration } from '@beeblock/svelar/database';

export default class CreateAgentCodeGraphRevisionManifestsTable extends Migration {
  async up() {
    await this.schema.createTable('agent_code_graph_revision_manifests', (table) => {
      table.uuid('id').primary();
      table.uuid('workspace_id').references('id', 'agent_workspaces').onDelete('cascade');
      table.uuid('project_id').references('id', 'agent_code_graph_projects').onDelete('cascade');
      table.uuid('revision_id').references('id', 'agent_code_graph_revisions').onDelete('cascade');
      table.string('source_hash');
      table.string('git_head').nullable();
      table.blob('manifest');
      table.text('stats_json');
      table.timestamp('completed_at');
      table.timestamp('created_at');
      table.timestamp('updated_at');
      table.uniqueIndex(['revision_id']);
      table.index(['workspace_id', 'project_id', 'completed_at']);
    });
  }

  async down() {
    await this.schema.dropTable('agent_code_graph_revision_manifests');
  }
}
