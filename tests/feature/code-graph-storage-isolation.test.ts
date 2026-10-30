import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { useSvelarTest } from '@beeblock/svelar/testing';
import { Connection, type DatabaseConfig } from '@beeblock/svelar/database';
import { mkdtemp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import ts from 'typescript';
import { createRequire, isBuiltin } from 'node:module';
import { uuidv7 } from '@beeblock/svelar/support';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { CODE_GRAPH_CONNECTION, CODE_GRAPH_READER_CONNECTION, CodeGraphConnection, buildGraphInWorker, stopCodeGraphStorage } from '$lib/database/code-graph-storage.js';
import { workspaceRepository } from '$lib/modules/agent-room/infrastructure/repositories/WorkspaceRepository.js';
import { codeGraphIndexService } from '$lib/modules/agent-room/application/services/CodeGraphIndexService.js';
import { codeGraphRepository } from '$lib/modules/agent-room/infrastructure/repositories/CodeGraphRepository.js';
import { channelService } from '$lib/modules/agent-room/application/services/ChannelService.js';
import { channelRepository } from '$lib/modules/agent-room/infrastructure/repositories/ChannelRepository.js';
import { agentInboxService } from '$lib/modules/agent-room/application/services/AgentInboxService.js';
import { controlCenterRepository } from '$lib/modules/agent-room/infrastructure/repositories/ControlCenterRepository.js';
import { AgentCodeGraphInvestigation } from '$lib/modules/agent-room/domain/models/AgentCodeGraphInvestigation.js';
import { AgentCodeGraphProject } from '$lib/modules/agent-room/domain/models/AgentCodeGraphProject.js';
const Database = createRequire(import.meta.url)('better-sqlite3');

function latch() {
  let resolve!: () => void;
  return { promise: new Promise<void>(done => { resolve = done; }), resolve: () => resolve() };
}

describe('isolated graph storage with real SQLite and worker threads', () => {
  useSvelarTest({ refreshDatabase: true });
  beforeAll(() => execFileSync(process.execPath, ['scripts/build-code-graph.mjs'], { stdio: 'pipe' }), 30_000);
  const directories: string[] = [];
  let original: DatabaseConfig | null = null;
  afterEach(async () => {
    agentInboxService.reset();
    await stopCodeGraphStorage();
    await Connection.disconnect();
    if (original) Connection.configure({ default: 'sqlite', connections: { sqlite: original } });
    original = null;
    vi.restoreAllMocks();
    for (const directory of directories.splice(0)) await rm(directory, { force: true, recursive: true });
  });

  async function fixture() {
    const directory = await mkdtemp(join(tmpdir(), 'graph messaging & snapshot '));
    directories.push(directory);
    await writeFile(join(directory, 'service.ts'), 'export function acceptOrder() { return 1; }\n');
    const workspace = await workspaceRepository.createWorkspace({ name: 'Concurrent graph', workingDir: directory, codeIntelligenceMode: 'manual' });
    const leader = await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'terminal', title: 'Leader', x: 0, y: 0, width: 500, height: 300, payload: { provider: 'claude', maestro: true } });
    const indexed = await codeGraphIndexService.index(workspace.id);
    await codeGraphIndexService.pauseWorkspace(workspace.id);
    original = { ...Connection.getConfig() };
    const source = join(directory, 'messages.sqlite');
    const filename = source + '.code-graph.sqlite';
    const client = await Connection.rawClient();
    client.prepare('VACUUM INTO ?').run(source);
    await Connection.disconnect();
    Connection.configure({ default: 'sqlite', connections: {
      sqlite: { driver: 'sqlite', filename: source },
      [CODE_GRAPH_CONNECTION]: { driver: 'sqlite', filename },
      [CODE_GRAPH_READER_CONNECTION]: { driver: 'sqlite', filename },
    } });
    const matches = await codeGraphRepository.search(workspace.id, { query: 'acceptOrder' });
    expect(matches).toHaveLength(1);
    return { workspace, leader, project: indexed.projects[0], matches };
  }

  it('persists owner messages and serves the last committed graph while an index transaction remains open', async () => {
    const { workspace, leader, project, matches } = await fixture();
    // Keep actual persistence/validation. Only live terminal dispatch is withheld in this isolated test.
    vi.spyOn(agentInboxService, 'enqueue').mockImplementation(async input => (await agentInboxService.enqueueDeferred(input)).envelope);
    const entered = latch();
    const finish = latch();
    const update = CodeGraphConnection.transaction(async () => {
      await AgentCodeGraphProject.query().where('id', project.id).update({ name: 'new indexed name' });
      entered.resolve();
      await finish.promise;
    });
    await entered.promise;
    try {
      const results = await Promise.race([
        Promise.all([
          channelService.postOwner(workspace.id, `dm:${leader.id}`, { body: 'Continue delivery while indexing.' }),
          codeGraphRepository.search(workspace.id, { query: 'acceptOrder' }),
        ]),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Messages or graph reads were blocked behind indexing.')), 1_000)),
      ]);
      expect(results[1][0].projectName).toBe(matches[0].projectName);
      expect((await channelRepository.list(workspace.id, `dm:${leader.id}`))).toHaveLength(1);
      expect(await controlCenterRepository.inboxEnvelopes(leader.id, ['queued'])).toHaveLength(1);
    } finally {
      finish.resolve();
      await update;
    }
    expect((await codeGraphRepository.search(workspace.id, { query: 'acceptOrder' }))[0].projectName).toBe('new indexed name');
  }, 20_000);

  it('rolls back a failed graph publication without changing the committed graph or losing an owner message', async () => {
    const { workspace, leader, project, matches } = await fixture();
    vi.spyOn(agentInboxService, 'enqueue').mockImplementation(async input => (await agentInboxService.enqueueDeferred(input)).envelope);
    const entered = latch();
    const finish = latch();
    const update = CodeGraphConnection.transaction(async () => {
      await AgentCodeGraphProject.query().where('id', project.id).update({ name: 'must roll back' });
      entered.resolve();
      await finish.promise;
      throw new Error('failed index');
    }).catch(error => error.message);
    await entered.promise;
    try {
      await channelService.postOwner(workspace.id, `dm:${leader.id}`, { body: 'A durable owner message.' });
    } finally { finish.resolve(); }
    expect(await update).toBe('failed index');
    expect((await codeGraphRepository.search(workspace.id, { query: 'acceptOrder' }))[0].projectName).toBe(matches[0].projectName);
    expect((await channelRepository.list(workspace.id, `dm:${leader.id}`))).toHaveLength(1);
  }, 20_000);
  it('bundles development-only parser dependencies instead of requiring them from an installed app', async () => {
    const pkg = JSON.parse(await readFile('package.json', 'utf8'));
    const source = ts.createSourceFile('worker.mjs', await readFile('build/code-graph-build/index.mjs', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const unresolved: string[] = [];
    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
      const name = statement.moduleSpecifier.text;
      if (name.startsWith('.') || isBuiltin(name)) continue;
      const root = name.startsWith('@') ? name.split('/').slice(0, 2).join('/') : name.split('/')[0];
      if (!pkg.dependencies[root]) unresolved.push(name);
    }
    expect(unresolved).toEqual([]);
  });

  it('keeps annotations on primary deletion failure and retires them only after a durable deletion request', async () => {
    const { workspace } = await fixture();
    const now = new Date().toISOString();
    await AgentCodeGraphInvestigation.create({ id: uuidv7(), workspace_id: workspace.id, name: 'Preserve my investigation', state_json: '{}', created_by: 'user', created_at: now, updated_at: now });
    await Connection.raw(`CREATE TRIGGER reject_workspace_delete BEFORE DELETE ON agent_workspaces BEGIN SELECT RAISE(ABORT, 'rejected deletion'); END`);
    await expect(workspaceRepository.deleteWorkspace(workspace.id)).rejects.toThrow(/rejected deletion/);
    expect(await AgentCodeGraphInvestigation.query().where('workspace_id', workspace.id).count()).toBe(1);
    expect(await Connection.raw('SELECT id FROM agent_code_graph_cleanup_requests')).toEqual([]);
    await Connection.raw('DROP TRIGGER reject_workspace_delete');
    expect(await workspaceRepository.deleteWorkspace(workspace.id)).toBe(true);
    expect(await Connection.raw('SELECT workspace_id FROM agent_code_graph_cleanup_requests')).toEqual([{ workspace_id: workspace.id }]);
    await vi.waitFor(async () => {
      expect(await codeGraphRepository.listProjects(workspace.id)).toEqual([]);
      expect(await AgentCodeGraphInvestigation.query().where('workspace_id', workspace.id).count()).toBe(0);
    }, { timeout: 10_000, interval: 100 });
  }, 20_000);

  it('publishes a real index in the worker without retagging unchanged symbols, and skips a stale no-op', async () => {
    const { workspace, project } = await fixture();
    await writeFile(join(workspace.workingDir, 'stable.ts'), 'export function keepStable() { return 3; }\n');
    const first = await buildGraphInWorker(project, false);
    const before = await CodeGraphConnection.raw('SELECT id, revision_id, updated_at FROM agent_code_graph_symbols WHERE name = ?', ['keepStable']);
    await writeFile(join(workspace.workingDir, 'service.ts'), 'export function acceptOrder() { return 2; }\n');
    const second = await buildGraphInWorker(first, false);
    const after = await CodeGraphConnection.raw('SELECT id, revision_id, updated_at FROM agent_code_graph_symbols WHERE name = ?', ['keepStable']);
    expect(second.currentRevisionId).not.toBe(first.currentRevisionId);
    expect(after).toEqual(before);
    expect((await codeGraphRepository.search(workspace.id, { query: 'keepStable' }))[0].revisionId).toBe(second.currentRevisionId);
    const noOp = await buildGraphInWorker({ ...second, status: 'stale' }, false);
    expect(noOp.currentRevisionId).toBe(second.currentRevisionId);
    expect(await CodeGraphConnection.raw('SELECT id, revision_id, updated_at FROM agent_code_graph_symbols WHERE name = ?', ['keepStable'])).toEqual(before);
  }, 30_000);

  it('retires the verified legacy copy at startup and keeps owner messages available if the isolated file disappears', async () => {
    const { workspace, leader, project } = await fixture();
    vi.spyOn(agentInboxService, 'enqueue').mockImplementation(async input => (await agentInboxService.enqueueDeferred(input)).envelope);
    await channelService.postOwner(workspace.id, `dm:${leader.id}`, { body: 'Preserve this conversation.' });
    const source = Connection.getConfig().filename!;
    await stopCodeGraphStorage();
    const { prepareCodeGraphStorage } = await import('../../scripts/prepare-code-graph-storage.mjs');
    await expect(prepareCodeGraphStorage(source, { workerPath: join(process.cwd(), 'electron/code-graph-storage-worker.cjs') })).resolves.toEqual({ retired: true });
    expect(await Connection.raw('SELECT id FROM agent_code_graph_projects')).toEqual([]);
    expect((await codeGraphRepository.listProjects(workspace.id))[0].id).toBe(project.id);
    await stopCodeGraphStorage();
    // Delete only the migrated destination to exercise missing-file recovery with its primary marker.
    await rm(source + '.code-graph.sqlite', { force: true });
    await expect(prepareCodeGraphStorage(source, { workerPath: join(process.cwd(), 'electron/code-graph-storage-worker.cjs') })).rejects.toThrow(/missing/i);
    expect(await channelRepository.list(workspace.id, `dm:${leader.id}`)).toHaveLength(1);
  }, 30_000);

  it('rebinds an unchanged caller when a newly added file supplies its definition', async () => {
    const { workspace, project } = await fixture();
    await writeFile(join(workspace.workingDir, 'service.ts'), 'export function acceptOrder() { return executeOrder(); }\n');
    const unresolved = await buildGraphInWorker(project, false);
    const caller = (await codeGraphRepository.search(workspace.id, { query: 'acceptOrder' }))[0];
    const before = await codeGraphRepository.subgraph(workspace.id, { symbolId: caller.id, direction: 'outgoing' });
    expect(before.nodes.some(symbol => symbol.name === 'executeOrder' && symbol.kind === 'external')).toBe(true);
    await writeFile(join(workspace.workingDir, 'executor.ts'), 'export function executeOrder() { return true; }\n');
    const resolved = await buildGraphInWorker(unresolved, false);
    const after = await codeGraphRepository.subgraph(workspace.id, { symbolId: caller.id, direction: 'outgoing' });
    expect(after.nodes.some(symbol => symbol.name === 'executeOrder' && symbol.kind === 'function')).toBe(true);
    expect(after.edges.every(edge => edge.revisionId === resolved.currentRevisionId)).toBe(true);
  }, 30_000);

  it('reuses the persistent parse cache after worker exit and reparses a corrupted entry', async () => {
    const { workspace, project } = await fixture();
    await writeFile(join(workspace.workingDir, 'stable.ts'), 'export function keepStable() { return 3; }\n');
    const first = await buildGraphInWorker(project, false);
    await stopCodeGraphStorage();
    await writeFile(join(workspace.workingDir, 'service.ts'), 'export function acceptOrder() { return 2; }\n');
    const warm = await buildGraphInWorker(first, false);
    expect(warm.stats.indexing).toMatchObject({ cacheHits: 1, cacheMisses: 1 });
    await CodeGraphConnection.raw('UPDATE agent_code_graph_parse_cache SET data = ? WHERE path = ?', [Buffer.from('corrupted'), 'stable.ts']);
    await stopCodeGraphStorage();
    await writeFile(join(workspace.workingDir, 'service.ts'), 'export function acceptOrder() { return 4; }\n');
    const repaired = await buildGraphInWorker(warm, false);
    expect(repaired.stats.indexing?.cacheMisses).toBe(2);
    expect(await codeGraphRepository.search(workspace.id, { query: 'keepStable' })).toHaveLength(1);
  }, 30_000);

  it('rejects a mismatched graph backup while leaving the conversation database available', async () => {
    const { workspace, leader } = await fixture();
    vi.spyOn(agentInboxService, 'enqueue').mockImplementation(async input => (await agentInboxService.enqueueDeferred(input)).envelope);
    await channelService.postOwner(workspace.id, `dm:${leader.id}`, { body: 'Keep the owner conversation.' });
    await stopCodeGraphStorage();
    await Connection.raw('UPDATE __orkestrai_graph_storage_origin SET source_key = ?', [uuidv7()]);
    await expect(codeGraphRepository.search(workspace.id, { query: 'acceptOrder' })).rejects.toThrow(/does not match/);
    expect(await channelRepository.list(workspace.id, `dm:${leader.id}`)).toHaveLength(1);
  }, 20_000);

  it('repairs the derived search mapping after a compact backup renumbers symbol rowids', async () => {
    const { workspace } = await fixture();
    const filename = Connection.getConfig(CODE_GRAPH_CONNECTION).filename!;
    await stopCodeGraphStorage();
    const compacted = new Database(filename);
    try {
      compacted.exec('UPDATE agent_code_graph_symbols SET rowid = rowid + 10000');
      compacted.exec('UPDATE agent_code_graph_symbol_search SET rowid = rowid + 10000');
      compacted.exec('VACUUM');
      // This SQLite build may preserve TEXT-PK rowids. Exercise the renumbering
      // that VACUUM is allowed to perform, independently of that implementation detail.
      compacted.exec('UPDATE agent_code_graph_symbols SET rowid = rowid - 10000');
      expect(compacted.prepare(`SELECT COUNT(*) AS n FROM agent_code_graph_symbols s
        JOIN agent_code_graph_symbol_search fts ON fts.symbol_id = s.id WHERE s.rowid <> fts.rowid`).get().n).toBeGreaterThan(0);
    } finally { compacted.close(); }
    expect(await codeGraphRepository.search(workspace.id, { query: 'acceptOrder' })).toHaveLength(1);
  }, 20_000);

  it('keeps both copies when another process changes the legacy graph after staging', async () => {
    const { workspace } = await fixture();
    const source = Connection.getConfig().filename!;
    const now = new Date().toISOString();
    await Connection.raw(`INSERT INTO agent_code_graph_investigations
      (id, workspace_id, name, state_json, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [uuidv7(), workspace.id, 'New legacy investigation', '{}', 'user', now, now]);
    await stopCodeGraphStorage();
    const { prepareCodeGraphStorage } = await import('../../scripts/prepare-code-graph-storage.mjs');
    await expect(prepareCodeGraphStorage(source, { workerPath: join(process.cwd(), 'electron/code-graph-storage-worker.cjs') })).rejects.toThrow(/changed after staging/);
    expect(await Connection.raw('SELECT name FROM agent_code_graph_investigations')).toEqual([{ name: 'New legacy investigation' }]);
    expect(await codeGraphRepository.search(workspace.id, { query: 'acceptOrder' })).toHaveLength(1);
  }, 20_000);

  it.runIf(Boolean(process.env.ORKESTRAI_GRAPH_NATIVE_SMOKE_DIR))('exports a synthetic fixture for the packaged Electron runtime smoke', async () => {
    const { project } = await fixture();
    const stage = process.env.ORKESTRAI_GRAPH_NATIVE_SMOKE_DIR!;
    await mkdir(join(stage, 'project'), { recursive: true, mode: 0o700 });
    await writeFile(join(stage, 'project', 'service.ts'), 'export function acceptOrder() { return 1; }\n');
    await writeFile(join(stage, 'project', 'native-probe.ts'), 'export function nativeGraphWorkerProbe() { return 1; }\n');
    await Connection.raw('UPDATE agent_code_graph_projects SET root_path = ? WHERE id = ?', [join(stage, 'project'), project.id]);
    const client = await Connection.rawClient();
    client.prepare('VACUUM INTO ?').run(join(stage, 'source.sqlite'));
    await writeFile(join(stage, 'project.json'), JSON.stringify({ ...project, rootPath: join(stage, 'project') }), { mode: 0o600 });
  });

});
