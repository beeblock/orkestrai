'use strict';

// Private ORM transport. This worker has no HTTP/CLI endpoint and accepts only parent-generated SQL.
const { parentPort, workerData } = require('node:worker_threads');
const { dirname, resolve } = require('node:path');
const { mkdirSync, existsSync, statfsSync, statSync, renameSync, unlinkSync, chmodSync, lstatSync } = require('node:fs');
const { randomUUID, createHash } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const Database = require('better-sqlite3');
const { resolutionHash } = require('./code-graph-resolution-hash.cjs');

const TABLES = [
  'agent_code_graph_projects', 'agent_code_graph_revisions', 'agent_code_graph_files',
  'agent_code_graph_symbols', 'agent_code_graph_edges', 'agent_code_graph_embeddings',
  'agent_code_graph_evidence_runs', 'agent_code_graph_evidence_edges',
  'agent_code_graph_semantic_indexes', 'agent_code_graph_investigations',
  'agent_code_graph_revision_manifests', 'agent_code_graph_manifest_chunks', 'agent_code_graph_parse_cache', 'agent_code_graph_symbol_search',
];
const identifier = value => {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value)) throw new Error('Invalid graph schema identifier.');
  return `"${value}"`;
};
const source = resolve(workerData.source);
const filename = resolve(workerData.filename);
if (filename === source) throw new Error('Graph storage cannot replace the primary database.');
mkdirSync(dirname(filename), { recursive: true });
if (existsSync(filename)) {
  if (lstatSync(filename).isSymbolicLink()) throw new Error('Code graph storage cannot follow a symbolic link.');
  const existingIdentity = statSync(filename), primaryIdentity = statSync(source);
  if (existingIdentity.dev === primaryIdentity.dev && existingIdentity.ino === primaryIdentity.ino) throw new Error('Code graph storage cannot share the primary database file.');
}
const readonly = workerData.readonly === true;
const primary = readonly ? null : new Database(source, { readonly: true, fileMustExist: true });
const tableSchemas = primary ? TABLES.map(name => primary.prepare('SELECT name, sql FROM sqlite_master WHERE type = ? AND name = ?').get('table', name)).filter(Boolean) : [];
if (!readonly && tableSchemas.length !== TABLES.length) throw new Error('Code graph schema preparation has not completed.');
const indexes = primary ? primary.prepare("SELECT name, sql, tbl_name FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL").all()
  .filter(row => TABLES.includes(row.tbl_name)).sort((a, b) => a.name.localeCompare(b.name)) : [];
const schemaHash = createHash('sha256').update(JSON.stringify([3, ...tableSchemas, ...indexes])).digest('hex');

function graphSourceSignature(connection, schema = 'main') {
  const hash = createHash('sha256');
  for (const table of TABLES) hash.update(`${table}:${connection.prepare(`SELECT COUNT(*) AS n FROM ${identifier(schema)}.${identifier(table)}`).get().n};`);
  // These small metadata tables cover published revisions and owner-authored
  // investigations/evidence. Never erase a legacy copy that changed after staging.
  for (const table of ['agent_code_graph_projects', 'agent_code_graph_revisions', 'agent_code_graph_investigations', 'agent_code_graph_evidence_runs']) {
    for (const row of connection.prepare(`SELECT * FROM ${identifier(schema)}.${identifier(table)} ORDER BY id`).iterate()) hash.update(JSON.stringify(row));
  }
  for (const row of connection.prepare(`SELECT id, built_at, updated_at FROM ${identifier(schema)}.agent_code_graph_semantic_indexes ORDER BY id`).iterate()) hash.update(JSON.stringify(row));
  return hash.digest('hex');
}

function storageSourceKey() {
  const identity = new Database(source, { fileMustExist: true });
  try {
    identity.exec('CREATE TABLE IF NOT EXISTS __orkestrai_graph_storage_origin (slot INTEGER PRIMARY KEY CHECK(slot = 1), source_key TEXT NOT NULL)');
    identity.prepare('INSERT OR IGNORE INTO __orkestrai_graph_storage_origin (slot, source_key) VALUES (1, ?)').run(randomUUID());
    return identity.prepare('SELECT source_key FROM __orkestrai_graph_storage_origin WHERE slot = 1').get().source_key;
  } finally { identity.close(); }
}
const sourceKey = readonly ? null : storageSourceKey();

function initialize() {
  let existing;
  let stagedSourceSignature = null;
  if (existsSync(filename)) {
    existing = new Database(filename, { fileMustExist: true });
    const marker = existing.prepare("SELECT name FROM sqlite_master WHERE name = '__orkestrai_graph_storage'").get();
    const columns = marker ? existing.prepare('PRAGMA table_info(__orkestrai_graph_storage)').all().map(row => row.name) : [];
    if (columns.includes('source_signature')) stagedSourceSignature = existing.prepare('SELECT source_signature FROM __orkestrai_graph_storage LIMIT 1').get()?.source_signature;
    const savedIdentity = columns.includes('source_key') ? existing.prepare('SELECT source_key FROM __orkestrai_graph_storage LIMIT 1').get()?.source_key : null;
    if (savedIdentity !== sourceKey) {
      existing.close();
      throw new Error('The graph database does not match this primary database. Both files were preserved; restore the matching backup pair.');
    }
    if (existing.prepare('SELECT schema_hash FROM __orkestrai_graph_storage LIMIT 1').get()?.schema_hash === schemaHash) return existing;
    // Recover a previous worker's WAL before copying/replacing a schema snapshot.
    existing.pragma('wal_checkpoint(TRUNCATE)');
    existing.close();
  }
  const dataSource = existsSync(filename) ? filename : source;
  if (dataSource === source && primary.prepare("SELECT 1 FROM sqlite_master WHERE name = '__orkestrai_graph_external_storage'").get()) {
    throw new Error('The isolated code graph database is missing. Restore its paired backup; the conversation database was preserved.');
  }
  const free = statfsSync(dirname(filename));
  if (Number(free.bavail) * Number(free.bsize) < statSync(dataSource).size + 512 * 1024 * 1024) {
    throw new Error('Not enough free disk space to prepare isolated code graph storage. Existing data was preserved.');
  }
  const temporary = `${filename}.preparing-${randomUUID()}`;
  let target;
  try {
    target = new Database(temporary);
    chmodSync(temporary, 0o600);
    target.pragma('auto_vacuum = INCREMENTAL');
    target.pragma('journal_mode = DELETE');
    target.pragma('foreign_keys = OFF');
    target.pragma('cache_size = -8192');
    target.prepare('ATTACH DATABASE ? AS legacy').run(dataSource);
    target.exec('BEGIN');
    target.exec('CREATE TABLE agent_workspaces (id TEXT PRIMARY KEY)');
    const ids = primary.prepare('SELECT id FROM agent_workspaces').all();
    const insertId = target.prepare('INSERT INTO agent_workspaces (id) VALUES (?)');
    for (const { id } of ids) insertId.run(id);
    for (const { name, sql } of tableSchemas) {
      target.exec(sql);
      const present = target.prepare('SELECT 1 FROM legacy.sqlite_master WHERE type = ? AND name = ?').get('table', name);
      if (!present || name === 'agent_code_graph_symbol_search') continue;
      const columns = target.prepare(`PRAGMA table_info(${identifier(name)})`).all().map(row => row.name);
      const oldColumns = new Set(target.prepare(`PRAGMA legacy.table_info(${identifier(name)})`).all().map(row => row.name));
      const common = columns.filter(column => oldColumns.has(column)).map(identifier).join(', ');
      if (!common) throw new Error(`Cannot preserve existing graph data in ${name}.`);
      target.exec(`INSERT INTO ${identifier(name)} (${common}) SELECT ${common} FROM legacy.${identifier(name)}`);
      const before = target.prepare(`SELECT COUNT(*) AS n FROM legacy.${identifier(name)}`).get().n;
      const after = target.prepare(`SELECT COUNT(*) AS n FROM ${identifier(name)}`).get().n;
      if (before !== after) throw new Error(`Code graph migration row count mismatch in ${name}.`);
    }
    for (const { sql } of indexes) target.exec(sql);
    // FTS row ids follow the corresponding symbol row ids. Targeted refreshes
    // and retirement can then delete by indexed rowid instead of scanning FTS.
    target.exec(`INSERT INTO agent_code_graph_symbol_search
      (rowid, symbol_id, revision_id, workspace_id, project_id, name, qualified_name, path, documentation, signature)
      SELECT s.rowid, s.id, s.revision_id, s.workspace_id, s.project_id, s.name, s.qualified_name,
        COALESCE(f.path, ''), COALESCE(s.documentation, ''), COALESCE(s.signature, '')
      FROM agent_code_graph_symbols s LEFT JOIN agent_code_graph_files f ON f.id = s.file_id`);
    const broken = target.pragma('foreign_key_check');
    if (broken.length) throw new Error('Code graph migration failed its reference checks.');
    target.exec('CREATE TABLE __orkestrai_graph_storage (schema_hash TEXT NOT NULL, source_key TEXT NOT NULL, source_signature TEXT, migrated_at TEXT NOT NULL)');
    const sourceSignature = dataSource === source ? graphSourceSignature(target, 'legacy') : stagedSourceSignature;
    target.prepare('INSERT INTO __orkestrai_graph_storage VALUES (?, ?, ?, ?)').run(schemaHash, sourceKey, sourceSignature ?? null, new Date().toISOString());
    target.exec('COMMIT');
    target.exec('DETACH DATABASE legacy');
    target.close();
    target = null;
    renameSync(temporary, filename);
    return new Database(filename, { fileMustExist: true });
  } catch (error) {
    try { target?.close(); } catch {}
    for (const suffix of ['', '-journal', '-wal', '-shm']) {
      try { unlinkSync(temporary + suffix); } catch {}
    }
    throw error;
  }
}

const database = readonly ? new Database(filename, { readonly: true, fileMustExist: true }) : initialize();
if (!readonly) database.pragma('journal_mode = WAL');
database.pragma('foreign_keys = ON');
database.pragma(`cache_size = ${readonly ? -8192 : -65536}`);
if (!readonly) database.pragma('journal_size_limit = 67108864');
database.pragma('busy_timeout = 5000');
if (!readonly) {
  // VACUUM INTO backups may renumber a TEXT-primary-key table's implicit
  // rowids. Repair only the derived FTS mapping after such a restore.
  const symbols = database.prepare('SELECT COUNT(*) AS n FROM agent_code_graph_symbols').get().n;
  const search = database.prepare('SELECT COUNT(*) AS n FROM agent_code_graph_symbol_search').get().n;
  const mismatched = symbols !== search || database.prepare(`SELECT 1 FROM agent_code_graph_symbols s
    LEFT JOIN agent_code_graph_symbol_search fts ON fts.rowid = s.rowid
    WHERE fts.symbol_id IS NULL OR fts.symbol_id <> s.id LIMIT 1`).get();
  if (mismatched) database.transaction(() => {
    database.exec('DELETE FROM agent_code_graph_symbol_search');
    database.exec(`INSERT INTO agent_code_graph_symbol_search
      (rowid, symbol_id, revision_id, workspace_id, project_id, name, qualified_name, path, documentation, signature)
      SELECT s.rowid, s.id, s.revision_id, s.workspace_id, s.project_id, s.name, s.qualified_name,
        COALESCE(f.path, ''), COALESCE(s.documentation, ''), COALESCE(s.signature, '')
      FROM agent_code_graph_symbols s LEFT JOIN agent_code_graph_files f ON f.id = s.file_id`);
  })();
}
// Backfill only derived fingerprints in the isolated cache, never in the owner's primary DB.
if (!readonly) {
  const missing = database.prepare('SELECT id FROM agent_code_graph_files WHERE resolution_hash IS NULL').all();
  if (missing.length) {
    const edgesForFile = database.prepare('SELECT fingerprint, confidence, metadata_json FROM agent_code_graph_edges WHERE site_file_id = ? ORDER BY fingerprint');
    const saveHash = database.prepare('UPDATE agent_code_graph_files SET resolution_hash = ? WHERE id = ?');
    database.transaction(() => { for (const file of missing) saveHash.run(resolutionHash(edgesForFile.iterate(file.id)), file.id); })();
  }
}
if (!readonly) {
  database.prepare("UPDATE agent_code_graph_revisions SET state = 'failed', completed_at = ?, diagnostics_json = ? WHERE state = 'building'")
    .run(new Date().toISOString(), JSON.stringify([{ path: null, severity: 'warning', code: 'index_interrupted', message: 'An interrupted background index was rolled back; the committed graph is preserved.' }]));
  database.prepare("UPDATE agent_code_graph_projects SET status = CASE WHEN current_revision_id IS NULL THEN 'error' ELSE 'stale' END WHERE status = 'indexing'").run();
}
let inTransaction = false;

function synchronizeWorkspaceIds() {
  const insert = database.prepare('INSERT OR IGNORE INTO agent_workspaces (id) VALUES (?)');
  for (const { id } of primary.prepare('SELECT id FROM agent_workspaces').all()) {
    insert.run(id);
  }
}

function execute(sql, bindings) {
  const statement = database.prepare(sql);
  if (!readonly && !statement.reader && /^\s*INSERT(?: OR \w+)? INTO agent_code_graph_(?:files|symbols|edges|embeddings|revision_manifests|manifest_chunks|parse_cache)\b/i.test(sql)) {
    const disk = statfsSync(dirname(filename));
    if (Number(disk.bavail) * Number(disk.bsize) < 512 * 1024 * 1024) {
      throw Object.assign(new Error('Background indexing paused to preserve disk space for conversations. Free space and retry the index.'), { code: 'GRAPH_DISK_PRESSURE' });
    }
  }
  if (readonly && !statement.reader) throw Object.assign(new Error('Writes must use the graph writer.'), { code: 'GRAPH_WRITE_ON_READER' });
  try {
    return statement.reader ? statement.all(...bindings) : statement.run(...bindings);
  } catch (error) {
    // A workspace created after this worker started needs its FK anchor. A failed statement is atomic.
    if (readonly || error.code !== 'SQLITE_CONSTRAINT_FOREIGNKEY') throw error;
    synchronizeWorkspaceIds();
    return statement.reader ? statement.all(...bindings) : statement.run(...bindings);
  }
}

let engine;
async function runEngine(operation, bindings) {
  if (!engine) {
    engine = await import(pathToFileURL(resolve(__dirname, '../build/code-graph-build/index.mjs')).href);
    engine.configureGraphBuildConnection(filename, execute, async callback => {
      if (database.inTransaction) return callback();
      database.exec('BEGIN');
      try {
        const result = await callback();
        database.exec('COMMIT');
        return result;
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    });
  }
  if (operation === 'index') return engine.buildCodeGraphProject(...bindings);
  if (operation === 'semantic-build') return engine.buildSemanticGraph(...bindings);
  if (operation === 'semantic-search') return engine.searchSemanticGraph(...bindings);
  if (operation === 'semantic-status') return engine.readSemanticGraphStatus(...bindings);
  if (operation === 'analysis-graph') return engine.readGraphAnalysis(...bindings);
  if (operation === 'compare') return engine.compareGraphRevisions(...bindings);
  throw new Error('Unknown graph engine operation.');
}

function retireLegacyGraph() {
  // Called only by the startup coordinator, before HTTP/background work starts.
  // The destination was copied, count-checked and foreign-key-checked already.
  const legacy = new Database(source, { fileMustExist: true });
  try {
    const marker = legacy.prepare("SELECT 1 FROM sqlite_master WHERE name = '__orkestrai_graph_external_storage'").get();
    const hasLegacy = legacy.prepare('SELECT 1 FROM agent_code_graph_projects LIMIT 1').get()
      || legacy.prepare('SELECT 1 FROM agent_code_graph_investigations LIMIT 1').get();
    if (marker && hasLegacy) throw new Error('Legacy graph data changed after migration. Both copies were preserved for reconciliation.');
    if (marker) return { retired: false };
    if (database.pragma('quick_check', { simple: true }) !== 'ok') throw new Error('Isolated graph failed integrity verification.');
    // All graph tables are an explicitly allowlisted migration unit. No owner messages,
    // learning entries, credentials, workspaces or provider data are deleted.
    const disk = statfsSync(dirname(source));
    if (Number(disk.bavail) * Number(disk.bsize) < statSync(source).size + 512 * 1024 * 1024) {
      throw new Error('Legacy graph cleanup deferred until enough disk is free for its atomic journal. Both copies were preserved.');
    }
    legacy.pragma('foreign_keys = OFF');
    legacy.exec('BEGIN IMMEDIATE');
    const signature = database.prepare('SELECT source_signature FROM __orkestrai_graph_storage LIMIT 1').get()?.source_signature;
    if (!signature || graphSourceSignature(legacy) !== signature) throw new Error('Legacy graph data changed after staging. Both copies were preserved for reconciliation.');
    for (const name of [...TABLES].reverse()) legacy.exec(`DELETE FROM ${identifier(name)}`);
    legacy.exec('CREATE TABLE __orkestrai_graph_external_storage (migrated_at TEXT NOT NULL)');
    legacy.prepare('INSERT INTO __orkestrai_graph_external_storage VALUES (?)').run(new Date().toISOString());
    legacy.exec('COMMIT');
    return { retired: true };
  } catch (error) {
    if (legacy.inTransaction) legacy.exec('ROLLBACK');
    throw error;
  } finally { legacy.close(); }
}

// Retire superseded physical snapshots in bounded transactions after publication.
// No giant DELETE can monopolize SQLite's native call or prevent worker shutdown.
let retirementTimer;
function scheduleRetirement() {
  if (readonly || retirementTimer) return;
  retirementTimer = setTimeout(() => {
    retirementTimer = null;
    queue = queue.then(() => {
      try { if (retireOneBatch()) scheduleRetirement(); }
      catch (error) { console.warn(`[code-graph] Deferred snapshot cleanup: ${error.code ?? 'error'}`); }
    });
  }, 250);
  retirementTimer.unref();
}
let lastOrphanScan = 0;
const orphanWorkspaces = new Set();
function discoverOrphanWorkspaces() {
  if (Date.now() - lastOrphanScan < 60_000) return;
  lastOrphanScan = Date.now();
  const live = new Set(primary.prepare('SELECT id FROM agent_workspaces').all().map(row => row.id));
  const hasRequests = primary.prepare("SELECT 1 FROM sqlite_master WHERE name = 'agent_code_graph_cleanup_requests'").get();
  if (!hasRequests) return;
  const retained = new Set(database.prepare('SELECT id FROM agent_workspaces').all().map(row => row.id));
  for (const { workspace_id: id } of primary.prepare('SELECT workspace_id FROM agent_code_graph_cleanup_requests').all()) {
    // Absence alone is never permission to delete annotations (e.g. a restored backup).
    if (live.has(id) || !retained.has(id)) continue;
    orphanWorkspaces.add(id);
    // The primary workspace is already committed as deleted. Null anchors make
    // its physical rows eligible for the same bounded retirement as snapshots.
    database.prepare("UPDATE agent_code_graph_projects SET current_revision_id = NULL, storage_revision_id = NULL, status = 'error' WHERE workspace_id = ?").run(id);
  }
}
function retireOrphanMetadata() {
  const workspaceId = orphanWorkspaces.values().next().value;
  if (!workspaceId) return false;
  for (const [table, limit] of [
    ['agent_code_graph_revision_manifests', 1], ['agent_code_graph_manifest_chunks', 100],
    ['agent_code_graph_parse_cache', 100], ['agent_code_graph_investigations', 10],
    ['agent_code_graph_evidence_runs', 100],
  ]) {
    const rows = database.prepare(`SELECT rowid FROM ${identifier(table)} WHERE workspace_id = ? LIMIT ?`).all(workspaceId, limit);
    if (!rows.length) continue;
    database.transaction(() => { const remove = database.prepare(`DELETE FROM ${identifier(table)} WHERE rowid = ?`); for (const row of rows) remove.run(row.rowid); })();
    return true;
  }
  database.prepare('DELETE FROM agent_workspaces WHERE id = ?').run(workspaceId);
  orphanWorkspaces.delete(workspaceId);
  return orphanWorkspaces.size > 0;
}
function retireOneBatch() {
  if (database.inTransaction) return true;
  discoverOrphanWorkspaces();
  const retired = database.prepare(`SELECT f.revision_id FROM agent_code_graph_files f
    JOIN agent_code_graph_projects p ON p.id = f.project_id
    WHERE p.current_revision_id IS NULL OR f.revision_id <> COALESCE(p.storage_revision_id, p.current_revision_id) LIMIT 1`).get();
  if (!retired) {
    if (retireOrphanMetadata()) return true;
    const free = Number(database.pragma('freelist_count', { simple: true }));
    if (free > 0 && Number(database.pragma('auto_vacuum', { simple: true })) === 2) {
      database.pragma('incremental_vacuum(1024)');
      return Number(database.pragma('freelist_count', { simple: true })) < free;
    }
    return false;
  }
  const revision = retired.revision_id;
  const edges = database.prepare('SELECT id FROM agent_code_graph_edges WHERE revision_id = ? LIMIT 2000').all(revision);
  database.transaction(() => {
    if (edges.length) {
      const remove = database.prepare('DELETE FROM agent_code_graph_edges WHERE id = ?');
      for (const edge of edges) remove.run(edge.id);
      return;
    }
    const symbols = database.prepare('SELECT rowid FROM agent_code_graph_symbols WHERE revision_id = ? LIMIT 500').all(revision);
    if (symbols.length) {
      const removeSearch = database.prepare('DELETE FROM agent_code_graph_symbol_search WHERE rowid = ?');
      const removeSymbol = database.prepare('DELETE FROM agent_code_graph_symbols WHERE rowid = ?');
      for (const symbol of symbols) { removeSearch.run(symbol.rowid); removeSymbol.run(symbol.rowid); }
      return;
    }
    database.prepare('DELETE FROM agent_code_graph_files WHERE rowid IN (SELECT rowid FROM agent_code_graph_files WHERE revision_id = ? LIMIT 500)').run(revision);
  })();
  return true;
}

async function handle({ id, operation, sql, bindings = [] }) {
  try {
    let result;
    if (operation === 'begin') { database.exec('BEGIN'); inTransaction = true; }
    else if (operation === 'commit') { database.exec('COMMIT'); inTransaction = false; }
    else if (operation === 'rollback') {
      if (inTransaction) database.exec('ROLLBACK');
      inTransaction = false;
    } else if ((operation === 'index' || operation === 'semantic-build') && !readonly) result = await runEngine(operation, bindings);
    else if (operation === 'semantic-search' || operation === 'compare' || operation === 'analysis-graph' || operation === 'semantic-status') {
      database.exec('BEGIN');
      try { result = await runEngine(operation, bindings); database.exec('COMMIT'); }
      catch (error) { database.exec('ROLLBACK'); throw error; }
    }
    else if (operation === 'cleanup' && !readonly) { lastOrphanScan = 0; scheduleRetirement(); result = { scheduled: true }; }
    else if (operation === 'retire-legacy' && !readonly) result = retireLegacyGraph();
    else if (operation === 'query' && typeof sql === 'string') result = execute(sql, bindings);
    else throw new Error('Unknown code graph storage operation.');
    parentPort.postMessage({ id, result });
    if (operation === 'index') scheduleRetirement();
  } catch (error) {
    parentPort.postMessage({ id, error: { message: error.message, code: error.code } });
  }
}
// An asynchronous file scan must not let another transaction enter its database connection.
let queue = Promise.resolve();
parentPort.on('message', request => { queue = queue.then(() => handle(request)); });
parentPort.postMessage({ ready: true });
scheduleRetirement();
