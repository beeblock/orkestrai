import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Connection, Migration, Schema } from '@beeblock/svelar/database';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';
import Groups from '../../src/lib/database/migrations/20260825140000_create_agent_workspace_groups_table.ts';
import GroupColumns from '../../src/lib/database/migrations/20260825140100_add_group_id_to_agent_workspaces_table.ts';
import Collapsed from '../../src/lib/database/migrations/20260825150000_add_collapsed_to_agent_workspace_groups_table.ts';
import { runStartupMigrations } from '../../scripts/run-startup-migrations.mjs';
import { createReportedWorkspaceSchema, reportedGroupsDDL } from '../fixtures/reported-workspace-schema.mjs';

const directories: string[] = [];
const migrations = [
  { name: 'groups', migration: new Groups() },
  { name: 'group-columns', migration: new GroupColumns() },
  { name: 'collapsed', migration: new Collapsed() },
];

beforeEach(async () => {
  await Connection.disconnect();
  Connection.configure({ default: 'sqlite', connections: { sqlite: { driver: 'sqlite', filename: ':memory:' } } });
  await new Schema().createTable('agent_workspaces', (table) => { table.uuid('id').primary(); table.string('name'); });
  await Connection.raw('INSERT INTO agent_workspaces (id, name) VALUES (?, ?)', ['workspace', 'Preserve me']);
});

afterEach(async () => {
  await Connection.disconnect();
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

describe('atomic desktop startup migrations', () => {
  it('repairs the actual reported legacy tables without replacing rows or later columns', async () => {
    await Connection.disconnect();
    Connection.configure({ default: 'sqlite', connections: { sqlite: { driver: 'sqlite', filename: ':memory:' } } });
    await createReportedWorkspaceSchema(Connection);
    const originalGroups = await Connection.raw('SELECT * FROM agent_workspace_groups ORDER BY id');
    const originalWorkspaces = await Connection.raw('SELECT * FROM agent_workspaces');
    expect(await runStartupMigrations(migrations)).toHaveLength(3);
    expect(await Connection.raw('SELECT * FROM agent_workspace_groups ORDER BY id')).toEqual(originalGroups.map((row) => ({ ...row, position: 0, collapsed: 0 })));
    expect(await Connection.raw('SELECT * FROM agent_workspaces')).toEqual(originalWorkspaces.map((row) => ({ ...row, position: 0 })));
    expect((await Connection.raw('PRAGMA index_list(agent_workspace_groups)')).some((row: { name: string }) => row.name === 'idx_agent_workspace_groups_parent_id_position')).toBe(true);
    expect(await runStartupMigrations(migrations)).toEqual([]);
    // Legacy ALTER TABLE parent_id has no FK; the existing service must still
    // validate parents and detach children/workspaces before removing a group.
    const { WorkspaceGroupService } = await import('../../src/lib/modules/agent-room/application/services/WorkspaceGroupService.ts');
    const service = new WorkspaceGroupService();
    await expect(service.create({ name: 'Invalid', parentId: 'missing' })).rejects.toThrow();
    expect(await service.remove('parent')).toEqual({ removed: true });
    expect(await Connection.raw('SELECT id, parent_id FROM agent_workspace_groups')).toEqual([{ id: 'child', parent_id: null }]);
    expect(await Connection.raw('SELECT id, group_id FROM agent_workspaces')).toEqual([{ id: 'workspace', group_id: null }]);
  });

  it('validates later existing columns before repairing the missing group position', async () => {
    await Connection.raw(reportedGroupsDDL);
    await new Schema().table('agent_workspace_groups', (table) => { table.text('collapsed').default('private-default-do-not-log'); });
    await Connection.raw('INSERT INTO agent_workspace_groups (id, name) VALUES (?, ?)', ['group', 'Private group name']);
    let error: Error | undefined;
    try { await runStartupMigrations(migrations); } catch (failure) { error = failure as Error; }
    expect(error?.message).toContain('agent_workspace_groups.collapsed');
    expect(error?.message).toContain('expected');
    expect(error?.message).toContain('actual');
    expect(error?.message).not.toContain('private-default-do-not-log');
    expect(error?.message).not.toContain('Private group name');
    expect((await Connection.raw('PRAGMA table_xinfo(agent_workspace_groups)')).some((row: { name: string }) => row.name === 'position')).toBe(false);
    expect(await new Schema().hasTable('migrations')).toBe(false);
  });

  it('can add nullable group metadata but never invents missing identity or names', async () => {
    await Connection.raw('CREATE TABLE agent_workspace_groups (id TEXT PRIMARY KEY, name VARCHAR(255) NOT NULL)');
    await Connection.raw('INSERT INTO agent_workspace_groups (id, name) VALUES (?, ?)', ['group', 'Keep this name']);
    await runStartupMigrations(migrations);
    expect(await Connection.raw('SELECT * FROM agent_workspace_groups')).toEqual([
      { id: 'group', name: 'Keep this name', parent_id: null, position: 0, created_at: null, updated_at: null, collapsed: 0 },
    ]);
  });

  it('rejects a missing identity before adding recoverable columns', async () => {
    await Connection.raw('CREATE TABLE agent_workspace_groups (name VARCHAR(255) NOT NULL)');
    await Connection.raw('INSERT INTO agent_workspace_groups (name) VALUES (?)', ['Keep this row']);
    await expect(runStartupMigrations(migrations)).rejects.toThrow('agent_workspace_groups.id');
    expect(await Connection.raw('SELECT * FROM agent_workspace_groups')).toEqual([{ name: 'Keep this row' }]);
  });

  it('preserves an unresolved legacy parent rather than silently clearing it', async () => {
    await Connection.raw(reportedGroupsDDL);
    await Connection.raw('INSERT INTO agent_workspace_groups (id, name, parent_id) VALUES (?, ?, ?)', ['child', 'Preserve', 'unresolved']);
    await expect(runStartupMigrations(migrations)).rejects.toThrow('unresolved group parent reference');
    expect(await Connection.raw('SELECT parent_id FROM agent_workspace_groups')).toEqual([{ parent_id: 'unresolved' }]);
    expect((await Connection.raw('PRAGMA table_xinfo(agent_workspace_groups)')).some((row: { name: string }) => row.name === 'position')).toBe(false);
  });

  it('rejects an unsafe legacy foreign key before adding the missing position', async () => {
    await Connection.raw(reportedGroupsDDL.replace('parent_id TEXT', 'parent_id TEXT REFERENCES agent_workspace_groups(id) ON DELETE CASCADE'));
    await expect(runStartupMigrations(migrations)).rejects.toThrow('incompatible group foreign key');
    expect((await Connection.raw('PRAGMA table_xinfo(agent_workspace_groups)')).some((row: { name: string }) => row.name === 'position')).toBe(false);
  });

  it('rolls back a legacy repair and preserves its verified pre-repair backup on a later failure', async () => {
    await Connection.disconnect();
    const directory = await mkdtemp(join(tmpdir(), 'orkestrai-reported-schema-'));
    directories.push(directory);
    const databasePath = join(directory, 'database.db');
    Connection.configure({ default: 'sqlite', connections: { sqlite: { driver: 'sqlite', filename: databasePath } } });
    await createReportedWorkspaceSchema(Connection);
    class Failing extends Migration {
      async up() { throw new Error('Failure after legacy repair'); }
      async down() {}
    }
    await expect(runStartupMigrations([...migrations, { name: 'failing', migration: new Failing() }], { databasePath, existingDatabase: true }))
      .rejects.toThrow('Failure after legacy repair');
    expect((await Connection.raw('PRAGMA table_xinfo(agent_workspace_groups)')).some((row: { name: string }) => row.name === 'position')).toBe(false);
    expect(await new Schema().hasTable('migrations')).toBe(false);
    const [backupFile] = (await readdir(directory)).filter((name) => name.startsWith('database.db.bak-'));
    const backup = new Database(join(directory, backupFile), { readonly: true });
    try {
      expect(backup.prepare('SELECT name FROM agent_workspace_groups ORDER BY id').all()).toEqual([{ name: 'Keep this child' }, { name: 'Keep this parent' }]);
      expect(backup.prepare('PRAGMA table_xinfo(agent_workspace_groups)').all().some((row: { name: string }) => row.name === 'position')).toBe(false);
    } finally { backup.close(); }
    expect(await runStartupMigrations(migrations, { databasePath, existingDatabase: true })).toHaveLength(3);
  });

  it('upgrades the full historical schema after an interrupted workspace-group migration', async () => {
    await Connection.disconnect();
    Connection.configure({ default: 'sqlite', connections: { sqlite: { driver: 'sqlite', filename: ':memory:' } } });
    const directory = join(process.cwd(), 'src/lib/database/migrations');
    const files = (await readdir(directory)).filter((name) => name.endsWith('.ts')).sort();
    const all = [];
    for (const file of files) {
      const module = await import(pathToFileURL(join(directory, file)).href);
      all.push({ name: file.replace(/\.ts$/, ''), migration: new module.default() });
    }
    const interrupted = all.findIndex((entry) => entry.name === '20260825140000_create_agent_workspace_groups_table');
    expect(interrupted).toBeGreaterThan(0);
    await runStartupMigrations(all.slice(0, interrupted));
    // Independent legacy DDL, not generated by the migration under test.
    await Connection.raw(reportedGroupsDDL);
    await new Schema().table('agent_workspaces', (table) => { table.uuid('group_id').nullable(); });
    await Connection.raw('INSERT INTO agent_workspace_groups (id, name) VALUES (?, ?)', ['saved-group', 'Keep this folder']);
    await Connection.raw('INSERT INTO agent_workspaces (id, name, working_dir) VALUES (?, ?, ?)', ['saved-workspace', 'Keep this project', '/fixture/project']);
    await runStartupMigrations(all);
    expect(await Connection.raw('SELECT name, collapsed FROM agent_workspace_groups')).toEqual([{ name: 'Keep this folder', collapsed: 0 }]);
    expect(await Connection.raw('SELECT name, working_dir FROM agent_workspaces')).toEqual([{ name: 'Keep this project', working_dir: '/fixture/project' }]);
    expect(await Connection.raw('SELECT migration FROM migrations')).toHaveLength(all.length);
    expect(await runStartupMigrations(all)).toEqual([]);
  });

  it('migrates a new schema and repeated boots do not duplicate history or change data', async () => {
    expect(await runStartupMigrations(migrations)).toEqual(['groups', 'group-columns', 'collapsed']);
    expect(await runStartupMigrations(migrations)).toEqual([]);
    expect(await Connection.raw('SELECT * FROM agent_workspaces')).toEqual([{ id: 'workspace', name: 'Preserve me', group_id: null, position: 0 }]);
    expect(await Connection.raw('SELECT migration FROM migrations')).toHaveLength(3);
  });

  it('recovers the reported existing table without its migration record and retains group rows', async () => {
    await new Groups().up();
    await Connection.raw('INSERT INTO agent_workspace_groups (id, name) VALUES (?, ?)', ['group', 'Existing folder']);
    await runStartupMigrations(migrations);
    expect(await Connection.raw('SELECT id, name, collapsed FROM agent_workspace_groups')).toEqual([{ id: 'group', name: 'Existing folder', collapsed: 0 }]);
    expect(await Connection.raw('SELECT migration FROM migrations')).toHaveLength(3);
  });

  it('resumes a missing index and an ALTER TABLE interrupted between its two columns', async () => {
    await new Groups().up();
    await Connection.raw('DROP INDEX idx_agent_workspace_groups_parent_id_position');
    await new Schema().table('agent_workspaces', (table) => { table.uuid('group_id').nullable(); });
    await Connection.raw('UPDATE agent_workspaces SET group_id = ?', ['group']);
    await runStartupMigrations(migrations);
    expect(await Connection.raw('SELECT group_id, position FROM agent_workspaces')).toEqual([{ group_id: 'group', position: 0 }]);
    expect((await Connection.raw('PRAGMA index_list(agent_workspace_groups)')).some((row: { name: string }) => row.name === 'idx_agent_workspace_groups_parent_id_position')).toBe(true);
  });

  it('accepts all three already-applied migrations with missing history without resetting saved values', async () => {
    for (const entry of migrations) await entry.migration.up();
    await Connection.raw('INSERT INTO agent_workspace_groups (id, name, collapsed) VALUES (?, ?, ?)', ['group', 'Saved', 1]);
    await Connection.raw('UPDATE agent_workspaces SET group_id = ?, position = ?', ['group', 7]);
    await runStartupMigrations(migrations);
    expect(await Connection.raw('SELECT collapsed FROM agent_workspace_groups')).toEqual([{ collapsed: 1 }]);
    expect(await Connection.raw('SELECT group_id, position FROM agent_workspaces')).toEqual([{ group_id: 'group', position: 7 }]);
  });

  it('rejects a same-name but incompatible table without marking it complete', async () => {
    await new Schema().createTable('agent_workspace_groups', (table) => { table.string('id').primary(); table.string('name'); });
    await Connection.raw('INSERT INTO agent_workspace_groups (id, name) VALUES (?, ?)', ['unsafe', 'Do not replace']);
    await expect(runStartupMigrations(migrations)).rejects.toThrow('incompatible');
    expect(await Connection.raw('SELECT * FROM agent_workspace_groups')).toEqual([{ id: 'unsafe', name: 'Do not replace' }]);
    expect(await new Schema().hasTable('migrations')).toBe(false);
  });

  it('validates every existing ALTER target before adding another column', async () => {
    await new Groups().up();
    await new Schema().table('agent_workspaces', (table) => { table.text('position').nullable(); });
    await expect(runStartupMigrations(migrations)).rejects.toThrow('agent_workspaces.position');
    expect((await Connection.raw('PRAGMA table_info(agent_workspaces)')).some((column: { name: string }) => column.name === 'group_id')).toBe(false);
    expect(await new Schema().hasTable('migrations')).toBe(false);
  });

  it('rejects a conflicting index without deleting it', async () => {
    await new Groups().up();
    await Connection.raw('DROP INDEX idx_agent_workspace_groups_parent_id_position');
    await Connection.raw('CREATE INDEX idx_agent_workspace_groups_parent_id_position ON agent_workspace_groups(name)');
    await expect(runStartupMigrations(migrations)).rejects.toThrow('incompatible group index');
    expect(await Connection.raw('PRAGMA index_info(idx_agent_workspace_groups_parent_id_position)')).toMatchObject([{ name: 'name' }]);
  });

  it('rolls back schema, data writes and migration history when a later migration fails', async () => {
    class Failing extends Migration {
      async up() {
        await this.schema.createTable('half_created', (table) => { table.string('name'); });
        await Connection.raw('UPDATE agent_workspaces SET name = ?', ['Should roll back']);
        throw new Error('Simulated failure after DDL');
      }
      async down() {}
    }
    await expect(runStartupMigrations([...migrations, { name: 'failing', migration: new Failing() }])).rejects.toThrow('Simulated failure');
    expect(await new Schema().hasTable('half_created')).toBe(false);
    expect(await new Schema().hasTable('agent_workspace_groups')).toBe(false);
    expect(await new Schema().hasTable('migrations')).toBe(false);
    expect(await Connection.raw('SELECT name FROM agent_workspaces')).toEqual([{ name: 'Preserve me' }]);
    expect(await runStartupMigrations(migrations)).toHaveLength(3);
  });

  it('backs up committed WAL data before repair and keeps only the newest completed backup', async () => {
    await Connection.disconnect();
    const directory = await mkdtemp(join(tmpdir(), 'orkestrai-migration-backup-'));
    directories.push(directory);
    const databasePath = join(directory, 'database.db');
    Connection.configure({ default: 'sqlite', connections: { sqlite: { driver: 'sqlite', filename: databasePath } } });
    const client = await Connection.rawClient() as Database.Database;
    client.pragma('journal_mode = WAL');
    client.pragma('wal_autocheckpoint = 0');
    await new Schema().createTable('agent_workspaces', (table) => { table.uuid('id').primary(); table.string('name'); });
    await Connection.raw('INSERT INTO agent_workspaces (id, name) VALUES (?, ?)', ['wal-row', 'Committed in WAL']);
    await client.backup(join(directory, 'database.db.bak-2020-01-01T00-00-00'));
    await runStartupMigrations(migrations, { databasePath, existingDatabase: true });
    const backups = (await readdir(directory)).filter((name) => name.startsWith('database.db.bak-'));
    expect(backups).toHaveLength(1);
    const backup = new Database(join(directory, backups[0]), { readonly: true });
    try {
      expect(backup.prepare('SELECT name FROM agent_workspaces').all()).toEqual([{ name: 'Committed in WAL' }]);
      expect(backup.prepare("SELECT name FROM sqlite_master WHERE name = 'agent_workspace_groups'").all()).toEqual([]);
    } finally { backup.close(); }
    expect(await runStartupMigrations(migrations, { databasePath, existingDatabase: true })).toEqual([]);
    expect((await readdir(directory)).filter((name) => name.startsWith('database.db.bak-'))).toEqual(backups);
  });
});
