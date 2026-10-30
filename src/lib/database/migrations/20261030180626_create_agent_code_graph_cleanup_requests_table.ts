import { Migration } from '@beeblock/svelar/database';
export default class CreateAgentCodeGraphCleanupRequestsTable extends Migration {
  async up() {
    await this.schema.createTable('agent_code_graph_cleanup_requests', table => {
      table.uuid('id').primary();
      // Intentionally no FK: a committed deletion must survive its workspace.
      table.uuid('workspace_id');
      table.timestamp('requested_at');
      table.uniqueIndex(['workspace_id']);
    });
  }
  async down() { await this.schema.dropTable('agent_code_graph_cleanup_requests'); }
}
