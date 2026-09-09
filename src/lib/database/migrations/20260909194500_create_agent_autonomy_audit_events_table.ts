import { Connection, Migration } from '@beeblock/svelar/database';

export default class CreateAgentAutonomyAuditEventsTable extends Migration {
  async up() {
    await this.schema.createTable('agent_autonomy_audit_events', (table) => {
      table.uuid('id').primary();
      table.uuid('workspace_id').references('id', 'agent_workspaces');
      table.uuid('run_id').nullable();
      table.text('step_id').nullable();
      table.text('correlation_id');
      table.text('actor_type');
      table.text('actor_id').nullable();
      table.text('event_type');
      table.text('capability');
      table.text('target').nullable();
      table.text('certainty').default('semantic');
      table.integer('policy_revision').default(1);
      table.text('input_digest').nullable();
      table.text('output_digest').nullable();
      table.text('metadata_json');
      table.text('previous_hash').nullable();
      table.text('event_hash');
      table.timestamp('created_at');
      table.index(['workspace_id', 'created_at']);
      table.index(['run_id', 'created_at']);
    });
    await Connection.raw('CREATE UNIQUE INDEX IF NOT EXISTS agent_autonomy_audit_event_hash_unique ON agent_autonomy_audit_events (event_hash)');
  }

  async down() {
    await Connection.raw('DROP INDEX IF EXISTS agent_autonomy_audit_event_hash_unique');
    await this.schema.dropTable('agent_autonomy_audit_events');
  }
}
