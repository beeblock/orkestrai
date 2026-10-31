import { Migration } from '@beeblock/svelar/database';

export default class CreateAgentWorkspaceLeadershipsTable extends Migration {
  async up() {
    await this.schema.createTable('agent_workspace_leaderships', (table) => {
      table.uuid('id').primary();
      table.uuid('workspace_id').references('id', 'agent_workspaces').onDelete('cascade');
      table.uuid('leader_node_id').nullable();
      table.uuid('deputy_node_id').nullable();
      table.uuid('revision');
      table.uuid('last_request_id').nullable();
      table.timestamps();
      table.uniqueIndex(['workspace_id']);
    });
  }

  async down() {
    await this.schema.dropTable('agent_workspace_leaderships');
  }
}
