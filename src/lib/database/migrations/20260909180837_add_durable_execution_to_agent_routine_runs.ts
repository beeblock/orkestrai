import { Connection, Migration } from '@beeblock/svelar/database';

export default class AddDurableExecutionToAgentRoutineRuns extends Migration {
  async up() {
    await this.schema.table('agent_routine_runs', (table) => {
      table.text('lease_owner').nullable();
      table.timestamp('lease_expires_at').nullable();
      table.timestamp('heartbeat_at').nullable();
      table.text('checkpoint_json').nullable();
      table.timestamp('cancel_requested_at').nullable();
      table.timestamp('timeout_at').nullable();
      table.integer('max_attempts').default(3);
      table.timestamp('next_attempt_at').nullable();
      table.timestamp('dead_lettered_at').nullable();
    });
    await Connection.raw(`
      DELETE FROM agent_routine_runs
      WHERE idempotency_key IS NOT NULL
        AND id NOT IN (
          SELECT MIN(id) FROM agent_routine_runs
          WHERE idempotency_key IS NOT NULL
          GROUP BY idempotency_key
        )
    `);
    await Connection.raw('CREATE UNIQUE INDEX IF NOT EXISTS agent_routine_runs_idempotency_unique ON agent_routine_runs (idempotency_key)');
    await Connection.raw('CREATE INDEX IF NOT EXISTS agent_routine_runs_durable_queue ON agent_routine_runs (status, next_attempt_at, ran_at)');
  }

  async down() {
    await Connection.raw('DROP INDEX IF EXISTS agent_routine_runs_durable_queue');
    await Connection.raw('DROP INDEX IF EXISTS agent_routine_runs_idempotency_unique');
    for (const column of [
      'lease_owner', 'lease_expires_at', 'heartbeat_at', 'checkpoint_json',
      'cancel_requested_at', 'timeout_at', 'max_attempts', 'next_attempt_at',
      'dead_lettered_at',
    ]) await this.schema.dropColumn('agent_routine_runs', column);
  }
}
