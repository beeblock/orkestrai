import { Migration } from '@beeblock/svelar/database';

export default class CreateCreativeRunsTable extends Migration {
  async up() {
    await this.schema.createTable('creative_runs', (table) => {
      table.string('id', 36).primary();
      table.string('workspace_id', 36);
      table.string('workflow_id', 36);
      table.string('node_id', 36);
      table.string('profile_id', 36);
      table.string('status', 40);
      table.text('snapshot_json');
      table.integer('reserved_cents');
      table.integer('queue_position').nullable();
      table.string('error_code', 120).nullable();
      table.text('output_json').nullable();
      table.text('actor_json');
      table.string('idempotency_key', 36);
      table.uniqueIndex(['workspace_id', 'idempotency_key']);
      table.text('remote_json').nullable();
      table.string('lease_owner', 36).nullable();
      table.timestamp('lease_expires_at').nullable();
      table.timestamp('next_poll_at').nullable();
      table.index(['status', 'next_poll_at']);
      table.index(['workspace_id', 'profile_id', 'created_at']);
      table.index(['profile_id', 'status']);
      table.index(['workspace_id', 'node_id']);
      table.timestamps();
    });
  }

  async down() {
    await this.schema.dropTable('creative_runs');
  }
}
