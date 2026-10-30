import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { useSvelarTest } from '@beeblock/svelar/testing';
import { Connection } from '@beeblock/svelar/database';
import Database from 'better-sqlite3';
import { mkdtemp, mkdir, rm, writeFile, copyFile, realpath } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, sep } from 'node:path';
import { performance } from 'node:perf_hooks';
import { CODE_GRAPH_CONNECTION, CODE_GRAPH_READER_CONNECTION, CodeGraphConnection, buildGraphInWorker, stopCodeGraphStorage } from '$lib/database/code-graph-storage.js';
import { workspaceRepository } from '$lib/modules/agent-room/infrastructure/repositories/WorkspaceRepository.js';
import { codeGraphRepository } from '$lib/modules/agent-room/infrastructure/repositories/CodeGraphRepository.js';
import { channelService } from '$lib/modules/agent-room/application/services/ChannelService.js';
import { codeGraphSemanticService } from '$lib/modules/agent-room/application/services/CodeGraphSemanticService.js';
import { agentInboxService } from '$lib/modules/agent-room/application/services/AgentInboxService.js';

const percentile = (values: number[], percent: number) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * percent) - 1] ?? 0;

describe.skipIf(!process.env.ORKESTRAI_GRAPH_BENCH_SOURCE || !process.env.ORKESTRAI_GRAPH_BENCH_WORKSPACE)('real graph with concurrent owner delivery (explicit read-only source)', () => {
  useSvelarTest({ refreshDatabase: true });
  let directory: string | null = null;
  beforeAll(() => execFileSync(process.execPath, ['scripts/build-code-graph.mjs'], { stdio: 'pipe' }));
  afterEach(async () => {
    agentInboxService.reset();
    await stopCodeGraphStorage();
    await Connection.disconnect();
    Connection.configure({ default: 'sqlite', connections: { sqlite: { driver: 'sqlite', filename: ':memory:' } } });
    vi.restoreAllMocks();
    if (directory) await rm(directory, { recursive: true, force: true });
  });
  it('measures search and message persistence while the complete production indexing engine runs', async () => {
    directory = await mkdtemp(join(tmpdir(), 'orkestrai-real-graph-bench-'));
    const workspace = await workspaceRepository.createWorkspace({ name: 'Isolated benchmark', workingDir: directory, codeIntelligenceMode: 'manual' });
    const leader = await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'terminal', title: 'Benchmark leader', x: 0, y: 0, width: 500, height: 300, payload: { provider: 'claude', maestro: true } });
    const primary = join(directory, 'messages.sqlite'), graph = primary + '.code-graph.sqlite';
    const initial = await Connection.rawClient();
    initial.prepare('VACUUM INTO ?').run(primary);
    await Connection.disconnect();
    Connection.configure({ default: 'sqlite', connections: { sqlite: { driver: 'sqlite', filename: primary },
      [CODE_GRAPH_CONNECTION]: { driver: 'sqlite', filename: graph }, [CODE_GRAPH_READER_CONNECTION]: { driver: 'sqlite', filename: graph } } });
    const client = await Connection.rawClient();
    client.pragma('cache_size = -65536');
    const source = new Database(process.env.ORKESTRAI_GRAPH_BENCH_SOURCE!, { readonly: true, fileMustExist: true });
    const oldWorkspace = process.env.ORKESTRAI_GRAPH_BENCH_WORKSPACE!;
    const tables = ['agent_code_graph_projects', 'agent_code_graph_revisions', 'agent_code_graph_files', 'agent_code_graph_symbols', 'agent_code_graph_edges'];
    const counts: Record<string, number> = {};
    const indexes = client.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL").all().filter((row: any) => tables.some(table => row.sql.includes(`ON \"${table}\"`)));
    client.pragma('foreign_keys = OFF');
    for (const row of indexes) client.exec(`DROP INDEX \"${row.name}\"`);
    source.exec('BEGIN');
    client.exec('BEGIN');
    try {
      for (const table of tables) {
        const columns = source.prepare(`PRAGMA table_info(${table})`).all().map((row: any) => row.name);
        let batch: unknown[][] = [];
        let count = 0;
        const flush = () => {
          if (!batch.length) return;
          const values = batch.map(() => `(${columns.map(() => '?').join(',')})`).join(',');
          client.prepare(`INSERT INTO ${table} (${columns.join(',')}) VALUES ${values}`).run(...batch.flat());
          count += batch.length;
          batch = [];
        };
        for (const row of source.prepare(`SELECT * FROM ${table} WHERE workspace_id = ?`).iterate(oldWorkspace) as Iterable<Record<string, unknown>>) {
          batch.push(columns.map((column: string) => column === 'workspace_id' ? workspace.id : row[column]));
          if (batch.length >= 800) flush();
        }
        flush();
        counts[table] = count;
        console.log('Copied graph table', table, count);
      }
      client.exec('UPDATE agent_code_graph_projects SET indexed_config_hash = config_hash WHERE current_revision_id IS NOT NULL');
      client.exec('COMMIT');
    } catch (error) { client.exec('ROLLBACK'); throw error; }
    finally { source.exec('ROLLBACK'); source.close(); }
    for (const row of indexes) client.exec(row.sql);
    expect(client.pragma('foreign_key_check')).toEqual([]);
    client.pragma('foreign_keys = ON');
    console.log('Isolated fixture copied', counts);
    const projects = await codeGraphRepository.listProjects(workspace.id);
    const project = projects.sort((a, b) => b.stats.symbols - a.stats.symbols)[0];
    expect(project.stats.symbols).toBeGreaterThan(40_000);
    vi.spyOn(agentInboxService, 'enqueue').mockImplementation(async input => (await agentInboxService.enqueueDeferred(input)).envelope);
    const terms = ['Order', 'Payment', 'Session', 'Message', 'Workspace'];
    const searchMs: number[] = [], messageMs: number[] = [];
    const search = async (index: number) => { const started = performance.now(); await codeGraphRepository.search(workspace.id, { query: terms[index % terms.length] }); searchMs.push(performance.now() - started); };
    for (let index = 0; index < 10; index++) await search(index);
    // Mirror only approved, indexed source files. The owner's files are never edited.
    const mirror = join(directory, 'source');
    await mkdir(mirror);
    const sourceRoot = await realpath(project.rootPath);
    const files = await client.prepare('SELECT path FROM agent_code_graph_files WHERE project_id = ?').all(project.id);
    let cursor = 0;
    await Promise.all(Array.from({ length: 8 }, async () => {
      while (cursor < files.length) {
        const row = files[cursor++];
        const original = await realpath(resolve(sourceRoot, row.path));
        if (!original.startsWith(sourceRoot + sep)) throw new Error('Benchmark source path escaped its approved root.');
        const destination = resolve(mirror, row.path);
        if (!destination.startsWith(mirror + sep)) throw new Error('Benchmark destination path escaped its private directory.');
        await mkdir(dirname(destination), { recursive: true });
        await copyFile(original, destination);
      }
    }));
    await writeFile(join(mirror, '__orkestrai_benchmark_probe.ts'), 'export function graphIndexBenchmarkProbe() { return 1; }\n');
    await CodeGraphConnection.raw('UPDATE agent_code_graph_projects SET root_path = ? WHERE id = ?', [mirror, project.id]);
    project.rootPath = mirror;

    console.log('Starting worker indexing and concurrent messages');
    const started = performance.now();
    let running = true;
    const index = buildGraphInWorker(project, false).finally(() => { running = false; });
    const traffic = (async () => {
      for (let sample = 0; sample < 500 && (running || sample < 20); sample++) {
        const time = performance.now();
        await channelService.postOwner(workspace.id, `dm:${leader.id}`, { body: `Isolated delivery sample ${sample}.` });
        messageMs.push(performance.now() - time);
        if (sample % 20 === 0) console.log('Concurrent messages measured', sample + 1, 'latest ms', messageMs.at(-1));
        await Promise.all(Array.from({ length: 4 }, (_, offset) => search(sample + offset)));
        await new Promise(done => setTimeout(done, 100));
      }
    })();
    const result = await index;
    const indexElapsedMs = performance.now() - started;
    await traffic;
    expect(result.currentRevisionId).not.toBe(project.currentRevisionId);
    expect(result.stats.indexing?.strategy).toBe('incremental');
    expect(await codeGraphRepository.search(workspace.id, { query: 'graphIndexBenchmarkProbe' })).toHaveLength(1);
    // A second real edit proves disk/memory cache reuse instead of a no-op scan.
    await writeFile(join(mirror, '__orkestrai_benchmark_probe.ts'), 'export function graphIndexBenchmarkProbe() { return 2; }\n');
    const warmStart = performance.now();
    const warmed = await buildGraphInWorker(result, false);
    expect(warmed.currentRevisionId).not.toBe(result.currentRevisionId);
    expect(warmed.stats.indexing?.cacheMisses).toBe(1);
    const cacheBytes = await CodeGraphConnection.raw('SELECT SUM(length(data)) AS bytes FROM agent_code_graph_parse_cache');
    expect(Number(cacheBytes[0]?.bytes ?? 0)).toBeLessThanOrEqual(128 * 1024 ** 2);
    const warmElapsedMs = performance.now() - warmStart;
    const semanticStarted = performance.now();
    const semanticStatus = await codeGraphSemanticService.build(workspace.id);
    const semanticBuildMs = performance.now() - semanticStarted;
    expect(semanticStatus.indexedSymbols).toBeGreaterThan(40_000);
    const semanticSearchStarted = performance.now();
    const semanticMatches = await codeGraphSemanticService.search(workspace.id, { query: 'graph index benchmark probe' });
    const semanticSearchMs = performance.now() - semanticSearchStarted;
    expect(semanticMatches[0].symbol.name).toBe('graphIndexBenchmarkProbe');
    const semanticWarmStarted = performance.now();
    await codeGraphSemanticService.search(workspace.id, { query: 'calculate order total' });
    const semanticWarmSearchMs = performance.now() - semanticWarmStarted;
    const report = { semantic: { buildMs: semanticBuildMs, searchMs: semanticSearchMs, warmSearchMs: semanticWarmSearchMs, indexedSymbols: semanticStatus.indexedSymbols }, warmedIndex: { elapsedMs: warmElapsedMs, stats: warmed.stats, parserCacheBytes: Number(cacheBytes[0]?.bytes ?? 0) }, source: 'explicit read-only graph metadata; isolated messages, no live provider', counts,
      indexing: { elapsedMs: indexElapsedMs, stats: result.stats },
      search: { samples: searchMs.length, p50Ms: percentile(searchMs, 0.5), p95Ms: percentile(searchMs, 0.95), maxMs: Math.max(...searchMs) },
      ownerMessagePersistence: { samples: messageMs.length, p50Ms: percentile(messageMs, 0.5), p95Ms: percentile(messageMs, 0.95), maxMs: Math.max(...messageMs) },
      processMemory: process.memoryUsage() };
    await writeFile(process.env.ORKESTRAI_GRAPH_BENCH_RESULT ?? join(directory, 'results.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
    console.log(JSON.stringify(report));
    expect(report.search.p95Ms).toBeLessThan(100);
    expect(report.ownerMessagePersistence.p95Ms).toBeLessThan(200);
  });
});
