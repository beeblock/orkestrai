import { Connection, Migration } from '@beeblock/svelar/database';

export default class CreateAgentIntegrationEventsTable extends Migration {
  async up() {
    await this.schema.createTable('agent_integration_events', (table) => {
      table.uuid('id').primary();
      table.uuid('workspace_id').references('id', 'agent_workspaces');
      table.uuid('integration_id').references('id', 'agent_automation_integrations');
      table.text('direction');
      table.text('kind');
      table.text('idempotency_key');
      table.text('status').default('received');
      table.text('payload_json').nullable();
      table.text('error').nullable();
      table.timestamp('processed_at').nullable();
      table.timestamp('created_at');
      table.timestamp('updated_at');
      table.index(['workspace_id', 'created_at']);
      table.index(['integration_id', 'created_at']);
    });
    await Connection.raw('CREATE UNIQUE INDEX IF NOT EXISTS agent_integration_events_idempotency_unique ON agent_integration_events (integration_id, idempotency_key)');
  }

  async down() {
    await Connection.raw('DROP INDEX IF EXISTS agent_integration_events_idempotency_unique');
    await this.schema.dropTable('agent_integration_events');
  }
}
