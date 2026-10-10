import { chmod, open, readdir, unlink } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { Connection, Migrator, Schema } from '@beeblock/svelar/database';
import Database from 'better-sqlite3';

export async function runStartupMigrations(migrations, { databasePath, existingDatabase = false } = {}) {
  // Desktop SQLite supports transactional DDL. Keep Svelar's migrator/history
  // and other driver behavior; only the SQLite boot batch gets an atomic guard.
  if (Connection.getDriver() !== 'sqlite') return new Migrator().run(migrations);
  const schema = new Schema();
  const ran = await schema.hasTable('migrations')
    ? (await Connection.raw('SELECT migration FROM migrations')).map((row) => row.migration) : [];
  if (migrations.every((entry) => ran.includes(entry.name))) return [];

  if (existingDatabase) {
    if (!databasePath) throw new Error('A database backup path is required before startup migrations.');
    const client = await Connection.rawClient();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    // VACUUM INTO writes a consistent snapshot including committed WAL pages,
    // like the backup API, but only live pages: a mostly-free 1.9 GB database
    // backs up as its few hundred MB of data. A plain file copy is never used.
    const backupPath = `${databasePath}.bak-${stamp}`;
    const reserved = await open(backupPath, 'wx', 0o600);
    await reserved.close();
    client.prepare('VACUUM INTO ?').run(backupPath);
    // Make the backup independently restorable as one file, not a DB/WAL pair.
    const snapshot = new Database(backupPath);
    try {
      snapshot.pragma('journal_mode = DELETE');
      if (snapshot.pragma('quick_check', { simple: true }) !== 'ok') throw new Error('The startup database backup failed integrity verification.');
    } finally { snapshot.close(); }
    await chmod(backupPath, 0o600);
    // Keep the newest completed backup; pruning failure must not invalidate it.
    const prefix = `${basename(databasePath)}.bak-`;
    const backups = (await readdir(dirname(databasePath))).filter((name) => name.startsWith(prefix)
      && /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}(?:-\d{3}Z)?$/.test(name.slice(prefix.length)));
    for (const old of backups.filter((name) => name !== basename(backupPath))) await unlink(join(dirname(databasePath), old)).catch(() => undefined);
  }

  // Table/column/index changes and their migration records commit together.
  // A failed statement or interrupted process cannot leave another half-batch.
  return Connection.transaction(() => new Migrator().run(migrations));
}

/**
 * Reclaims free pages left by deleted data (the desktop database reached
 * 1.9 GB with 84% free pages) and truncates the WAL. Runs at boot, before the
 * server accepts requests, only when it is worth it and the disk has room.
 */
export async function compactStartupDatabase({ minFreeBytes = 256 * 1024 * 1024, minFreeRatio = 0.25, freeDiskBytes = null } = {}) {
  if (Connection.getDriver() !== 'sqlite') return { compacted: false };
  const client = await Connection.rawClient();
  client.pragma('journal_size_limit = 67108864');
  const pageSize = Number(client.pragma('page_size', { simple: true }));
  const pageCount = Number(client.pragma('page_count', { simple: true }));
  const freePages = Number(client.pragma('freelist_count', { simple: true }));
  const liveBytes = (pageCount - freePages) * pageSize;
  const reclaimable = freePages * pageSize;
  let compacted = false;
  if (reclaimable >= minFreeBytes && freePages / Math.max(1, pageCount) >= minFreeRatio
    && (freeDiskBytes === null || freeDiskBytes > liveBytes * 2)) {
    client.exec('VACUUM');
    compacted = true;
  }
  client.pragma('wal_checkpoint(TRUNCATE)');
  return { compacted, reclaimedBytes: compacted ? reclaimable : 0 };
}
