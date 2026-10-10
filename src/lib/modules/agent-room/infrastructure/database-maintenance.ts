import { Connection } from '@beeblock/svelar/database';

/** WAL files shrink back to this size after each completed checkpoint. */
export const WAL_SIZE_LIMIT_BYTES = 64 * 1024 * 1024;
const CHECKPOINT_INTERVAL_MS = 10 * 60_000;

const state = globalThis as typeof globalThis & { __orkestraiDatabaseMaintenance?: ReturnType<typeof setInterval> };

/**
 * SQLite never truncates a WAL by default: one large write left a 1.5 GB
 * `database.db-wal` on disk forever. Limit it and checkpoint periodically.
 */
export async function startDatabaseMaintenance(): Promise<void> {
  if (state.__orkestraiDatabaseMaintenance || Connection.getDriver() !== 'sqlite') return;
  const client = await Connection.rawClient();
  client.pragma(`journal_size_limit = ${WAL_SIZE_LIMIT_BYTES}`);
  const checkpoint = () => {
    try {
      client.pragma('wal_checkpoint(TRUNCATE)');
    } catch {
      // A busy checkpoint is retried on the next tick.
    }
  };
  checkpoint();
  state.__orkestraiDatabaseMaintenance = setInterval(checkpoint, CHECKPOINT_INTERVAL_MS);
  state.__orkestraiDatabaseMaintenance.unref?.();
}
