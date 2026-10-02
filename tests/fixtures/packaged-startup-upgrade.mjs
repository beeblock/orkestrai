// Run with the packaged Electron executable and ELECTRON_RUN_AS_NODE=1.
// All databases, bridge discovery, provider homes and shims stay temporary.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:net';
import assert from 'node:assert/strict';
import { reportedGroupsDDL } from './reported-workspace-schema.mjs';

const appRoot = resolve(process.argv[2]);
const require = createRequire(join(appRoot, 'package.json'));
const { Connection, Schema } = await import(pathToFileURL(require.resolve('@beeblock/svelar/database')).href);
const { runStartupMigrations } = await import(pathToFileURL(join(appRoot, 'scripts/run-startup-migrations.mjs')).href);
const { startupRecoveryCopy } = require(join(appRoot, 'build/desktop-messages/index.cjs'));
for (const locale of ['pt-BR', 'en', 'es']) assert.ok(startupRecoveryCopy(locale).detail.length > 20);

const scratch = await mkdtemp(join(tmpdir(), 'orkestrai-packaged-startup-'));
let child;
let output = '';
const databasePath = join(scratch, 'database.db');
const homeRoot = join(scratch, 'home');
const projectRoot = join(scratch, 'project');
const configure = () => Connection.configure({ default: 'sqlite', connections: { sqlite: { driver: 'sqlite', filename: databasePath } } });
async function stopChild() {
  if (!child?.pid || child.exitCode !== null || child.signalCode) return;
  const stopped = new Promise((done) => child.once('exit', done));
  const timer = setTimeout(() => child.kill('SIGKILL'), 5_000);
  child.kill('SIGTERM');
  await stopped;
  clearTimeout(timer);
}

try {
  await mkdir(homeRoot);
  await mkdir(projectRoot);
  configure();
  const directory = join(appRoot, 'src/lib/database/migrations');
  const entries = [];
  for (const file of (await readdir(directory)).filter((name) => name.endsWith('.ts')).sort()) {
    const module = await import(pathToFileURL(join(directory, file)).href);
    entries.push({ name: file.replace(/\.ts$/, ''), migration: new module.default() });
  }
  const interrupted = entries.findIndex((entry) => entry.name === '20260825140000_create_agent_workspace_groups_table');
  assert.ok(interrupted > 0);
  await runStartupMigrations(entries.slice(0, interrupted));
  await Connection.raw(reportedGroupsDDL);
  await new Schema().table('agent_workspaces', (table) => { table.uuid('group_id').nullable(); });
  await Connection.raw('INSERT INTO agent_workspace_groups (id, name) VALUES (?, ?)', ['01900000-0000-7000-8000-000000000001', 'Preserved group']);
  await Connection.raw('INSERT INTO agent_workspace_groups (id, name, parent_id) VALUES (?, ?, ?)', ['01900000-0000-7000-8000-000000000003', 'Preserved child', '01900000-0000-7000-8000-000000000001']);
  await Connection.raw('INSERT INTO agent_workspaces (id, name, working_dir, group_id) VALUES (?, ?, ?, ?)', ['01900000-0000-7000-8000-000000000002', 'Preserved workspace', projectRoot, '01900000-0000-7000-8000-000000000001']);
  await Connection.disconnect();

  const reservation = createServer();
  await new Promise((done) => reservation.listen(0, '127.0.0.1', done));
  const port = reservation.address().port;
  await new Promise((done) => reservation.close(done));
  const env = {
    PATH: process.env.PATH, SHELL: process.env.SHELL, TMPDIR: process.env.TMPDIR,
    SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR,
    ELECTRON_RUN_AS_NODE: '1', NODE_OPTIONS: '', HOST: '127.0.0.1', PORT: String(port),
    APP_KEY: 'isolated-startup-qa-key', DB_PATH: databasePath, ORKESTRAI_DATA_DIR: scratch,
    ORKESTRAI_CORE_TOKEN: 'isolated-startup-qa-core', ORKESTRAI_CORE_VERSION: require('./package.json').version,
    ORKESTRAI_SHIM_DIR: join(scratch, 'bin'), ORKESTRAI_RUNTIME_FILE: join(homeRoot, '.orkestrai/runtime.json'),
    HOME: homeRoot, USERPROFILE: homeRoot, APPDATA: join(homeRoot, 'AppData/Roaming'),
    LOCALAPPDATA: join(homeRoot, 'AppData/Local'), XDG_CONFIG_HOME: join(homeRoot, '.config'), CODEX_HOME: join(homeRoot, '.codex'),
  };
  child = spawn(process.execPath, [join(appRoot, 'scripts/orkestrai-server.mjs')], { cwd: appRoot, env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.on('error', (error) => { output += String(error); });
  for (const stream of [child.stdout, child.stderr]) stream.on('data', (chunk) => { output = (output + String(chunk)).slice(-16_384); });
  const started = Date.now();
  let health;
  while (Date.now() - started < 45_000) {
    if (typeof child.exitCode === 'number' || child.signalCode) throw new Error(`Packaged server exited: ${output}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/agent-room/core/health`, { headers: { 'x-orkestrai-core-token': env.ORKESTRAI_CORE_TOKEN }, signal: AbortSignal.timeout(1_000) });
      if (response.ok) { health = await response.json(); break; }
    } catch {}
    await new Promise((done) => setTimeout(done, 100));
  }
  assert.equal(health?.data?.status, 'ok', `Packaged startup failed: ${output}`);
  await stopChild();
  configure();
  assert.deepEqual(await Connection.raw('SELECT name, position, collapsed FROM agent_workspace_groups ORDER BY id'), [{ name: 'Preserved group', position: 0, collapsed: 0 }, { name: 'Preserved child', position: 0, collapsed: 0 }]);
  assert.deepEqual(await Connection.raw('SELECT name, position, group_id FROM agent_workspaces'), [{ name: 'Preserved workspace', position: 0, group_id: '01900000-0000-7000-8000-000000000001' }]);
  assert.deepEqual(await Connection.raw('SELECT parent_id FROM agent_workspace_groups WHERE name = ?', ['Preserved child']), [{ parent_id: '01900000-0000-7000-8000-000000000001' }]);
  assert.equal((await Connection.raw('SELECT migration FROM migrations')).length, entries.length);
  assert.equal((await readdir(scratch)).filter((name) => /^database\.db\.bak-.*Z$/.test(name)).length, 1);
  const [backupFile] = (await readdir(scratch)).filter((name) => /^database\.db\.bak-.*Z$/.test(name));
  const Database = require('better-sqlite3');
  const backup = new Database(join(scratch, backupFile), { readonly: true });
  try {
    assert.equal(backup.prepare('SELECT COUNT(*) AS count FROM agent_workspace_groups').get().count, 2);
    assert.equal(backup.prepare('PRAGMA table_xinfo(agent_workspace_groups)').all().some(column => column.name === 'position'), false);
    assert.equal(backup.prepare('PRAGMA table_xinfo(agent_workspaces)').all().some(column => column.name === 'position'), false);
  } finally { backup.close(); }
  console.log(JSON.stringify({ version: require('./package.json').version, packagedStartup: 'passed', reportedLegacySchemaRecovery: 'passed', preservedRows: 3, migrationCount: entries.length, startupMs: Date.now() - started, locales: 3, verifiedBackup: 'passed' }));
} finally {
  await stopChild();
  await Connection.disconnect();
  await rm(scratch, { recursive: true, force: true });
}
