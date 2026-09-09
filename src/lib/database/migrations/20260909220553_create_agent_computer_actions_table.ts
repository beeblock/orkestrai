import { Connection, Migration } from '@beeblock/svelar/database';

export default class CreateAgentComputerActionsTable extends Migration {
  async up() {
    await this.schema.createTable('agent_computer_actions', (table) => {
      table.uuid('id').primary();
      table.uuid('workspace_id').references('id', 'agent_workspaces').onDelete('cascade');
      table.uuid('node_id').nullable().references('id', 'agent_canvas_nodes').onDelete('set null');
      table.text('actor_type');
      table.text('actor_id').nullable();
      table.text('command');
      table.text('idempotency_key');
      table.text('request_digest');
      table.text('status');
      table.text('result_json').nullable();
      table.text('error').nullable();
      table.timestamp('created_at');
      table.timestamp('updated_at');
      table.index(['workspace_id', 'created_at']);
      table.index(['node_id', 'created_at']);
    });
    await Connection.raw('CREATE UNIQUE INDEX IF NOT EXISTS agent_computer_actions_idempotency_unique ON agent_computer_actions (workspace_id, idempotency_key)');
  }

  async down() {
    await Connection.raw('DROP INDEX IF EXISTS agent_computer_actions_idempotency_unique');
    await this.schema.dropTable('agent_computer_actions');
  }
}
