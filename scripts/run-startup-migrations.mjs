import { chmod, open, readdir, unlink, access } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { Connection, Migrator, Schema } from '@beeblock/svelar/database';
import Database from 'better-sqlite3';

/**
 * `onPhase` hears each slow step before it starts ('backup', 'migrating'),
 * so the desktop can tell a long preparation from a stuck server.
 * @param {any[]} migrations
 * @param {{databasePath?: string, existingDatabase?: boolean, onPhase?: (phase: string) => void | Promise<void>}} [options]
 */
export async function runStartupMigrations(migrations, { databasePath, existingDatabase = false, onPhase } = {}) {
  // Desktop SQLite supports transactional DDL. Keep Svelar's migrator/history
  // and other driver behavior; only the SQLite boot batch gets an atomic guard.
  if (Connection.getDriver() !== 'sqlite') return new Migrator().run(migrations);
  const schema = new Schema();
  const ran = await schema.hasTable('migrations')
    ? (await Connection.raw('SELECT migration FROM migrations')).map((row) => row.migration) : [];
  if (migrations.every((entry) => ran.includes(entry.name))) return [];

  if (existingDatabase) {
    if (!databasePath) throw new Error('A database backup path is required before startup migrations.');
    await onPhase?.('backup');
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
    // User annotations/evidence now live beside the main database. A backup is
    // a pair; verify both files before pruning the previous recoverable pair.
    const graphPath = `${databasePath}.code-graph.sqlite`;
    let graphBackupPath;
    if (await access(graphPath).then(() => true, () => false)) {
      graphBackupPath = `${graphPath}.bak-${stamp}`;
      const graphReserved = await open(graphBackupPath, 'wx', 0o600);
      await graphReserved.close();
      const graph = new Database(graphPath, { readonly: true, fileMustExist: true });
      try { graph.prepare('VACUUM INTO ?').run(graphBackupPath); } finally { graph.close(); }
      const graphSnapshot = new Database(graphBackupPath);
      try {
        graphSnapshot.pragma('journal_mode = DELETE');
        if (graphSnapshot.pragma('quick_check', { simple: true }) !== 'ok') throw new Error('The code graph backup failed integrity verification.');
      } finally { graphSnapshot.close(); }
      await chmod(graphBackupPath, 0o600);
    }
    // Keep the newest completed backup; pruning failure must not invalidate it.
    const prefix = `${basename(databasePath)}.bak-`;
    const backups = (await readdir(dirname(databasePath))).filter((name) => name.startsWith(prefix)
      && /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}(?:-\d{3}Z)?$/.test(name.slice(prefix.length)));
    for (const old of backups.filter((name) => name !== basename(backupPath))) await unlink(join(dirname(databasePath), old)).catch(() => undefined);
    if (graphBackupPath) {
      const graphPrefix = `${basename(graphPath)}.bak-`;
      const graphBackups = (await readdir(dirname(graphPath))).filter(name => name.startsWith(graphPrefix)
        && /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}(?:-\d{3}Z)?$/.test(name.slice(graphPrefix.length)));
      for (const old of graphBackups.filter(name => name !== basename(graphBackupPath))) await unlink(join(dirname(graphPath), old)).catch(() => undefined);
    }
  }

  // Table/column/index changes and their migration records commit together.
  // A failed statement or interrupted process cannot leave another half-batch.
  await onPhase?.('migrating');
  return Connection.transaction(() => new Migrator().run(migrations));
}

/**
 * Reclaims free pages left by deleted data (the desktop database reached
 * 1.9 GB with 84% free pages) and truncates the WAL. Runs at boot, before the
 * server accepts requests, only when it is worth it and the disk has room.
 */
export async function compactStartupDatabase({ minFreeBytes = 256 * 1024 * 1024, minFreeRatio = 0.25, freeDiskBytes = null, onPhase } = {}) {
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
    await onPhase?.('compacting');
    client.exec('VACUUM');
    compacted = true;
  }
  client.pragma('wal_checkpoint(TRUNCATE)');
  return { compacted, reclaimedBytes: compacted ? reclaimable : 0 };
}
