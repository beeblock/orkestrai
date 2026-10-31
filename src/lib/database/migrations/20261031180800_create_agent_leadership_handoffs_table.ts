import { Migration } from '@beeblock/svelar/database';

export default class CreateAgentLeadershipHandoffsTable extends Migration {
  async up() {
    await this.schema.createTable('agent_leadership_handoffs', (table) => {
      table.uuid('id').primary();
      table.uuid('workspace_id').references('id', 'agent_workspaces').onDelete('cascade');
      table.uuid('from_node_id').nullable();
      table.uuid('to_node_id');
      table.uuid('configuration_revision');
      table.uuid('request_id');
      table.text('context_json');
      table.text('brief').nullable();
      table.string('status').default('queued');
      table.timestamp('acknowledged_at').nullable();
      table.timestamps();
      table.uniqueIndex(['workspace_id', 'request_id']);
      table.index(['workspace_id', 'created_at']);
    });
  }

  async down() {
    await this.schema.dropTable('agent_leadership_handoffs');
  }
}
