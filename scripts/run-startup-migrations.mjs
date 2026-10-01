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
    // SQLite's backup API includes committed WAL pages. A plain file copy does
    // not, and cannot be relied on before automatically repairing a schema.
    const backupPath = `${databasePath}.bak-${stamp}`;
    const reserved = await open(backupPath, 'wx', 0o600);
    await reserved.close();
    await client.backup(backupPath);
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
