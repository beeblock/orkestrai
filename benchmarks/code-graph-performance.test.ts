import { performance } from 'node:perf_hooks';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { useSvelarTest } from '@beeblock/svelar/testing';
import { codeGraphIndexService } from '$lib/modules/agent-room/application/services/CodeGraphIndexService.js';
import { codeGraphFileScanner } from '$lib/modules/agent-room/infrastructure/code-graph/CodeGraphFileScanner.js';
import { workspaceRepository } from '$lib/modules/agent-room/infrastructure/repositories/WorkspaceRepository.js';

type BenchmarkRoot = { name: string; path: string };
type Sample = { p50Ms: number; p95Ms: number; maxMs: number };

const temporaryDirectories: string[] = [];
const workspaceIds: string[] = [];

function percentile(values: number[], ratio: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1))] ?? 0;
}

async function sample(work: () => Promise<unknown>, iterations = 12): Promise<Sample> {
  await work();
  const values: number[] = [];
  for (let index = 0; index < iterations; index += 1) {
    const startedAt = performance.now();
    await work();
    values.push(performance.now() - startedAt);
  }
  return {
    p50Ms: Number(percentile(values, 0.5).toFixed(2)),
    p95Ms: Number(percentile(values, 0.95).toFixed(2)),
    maxMs: Number(Math.max(...values).toFixed(2)),
  };
}

function configuredRoots(): BenchmarkRoot[] {
  const input = process.env.ORKESTRAI_CODE_GRAPH_BENCH_ROOTS;
  if (!input) return [];
  const parsed = JSON.parse(input) as unknown;
  if (!Array.isArray(parsed)) throw new Error('ORKESTRAI_CODE_GRAPH_BENCH_ROOTS must be a JSON array.');
  return parsed.slice(0, 4).map((entry, index) => {
    if (!entry || typeof entry !== 'object') throw new Error(`Benchmark root ${index + 1} is invalid.`);
    const candidate = entry as Record<string, unknown>;
    if (typeof candidate.name !== 'string' || typeof candidate.path !== 'string') {
      throw new Error(`Benchmark root ${index + 1} requires string name and path values.`);
    }
    return { name: candidate.name.slice(0, 80), path: candidate.path };
  });
}

async function createSyntheticRepository(fileCount = 600): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'orkestrai-code-graph-benchmark-'));
  temporaryDirectories.push(directory);
  await mkdir(join(directory, 'src'));
  await writeFile(join(directory, 'package.json'), '{"name":"code-graph-benchmark"}\n');
  await Promise.all(Array.from({ length: fileCount }, (_, index) => {
    const previous = index > 0 ? `import { service${index - 1} } from './service-${index - 1}';\n` : '';
    const call = index > 0 ? `service${index - 1}()` : '0';
    return writeFile(join(directory, 'src', `service-${index}.ts`), [
      previous,
      `export function service${index}() { return ${call}; }`,
      `export class Service${index} { run() { return service${index}(); } }`,
      '',
    ].join('\n'));
  }));
  return directory;
}

async function createRepositoryMirror(sourceRoot: string): Promise<{ directory: string; changedPath: string; fileCount: number }> {
  const scan = await codeGraphFileScanner.scan(sourceRoot);
  const directory = await mkdtemp(join(tmpdir(), 'orkestrai-code-graph-mirror-'));
  temporaryDirectories.push(directory);
  await writeFile(join(directory, 'package.json'), '{"name":"code-graph-mirror"}\n');
  await Promise.all(scan.files.map(async (file) => {
    const target = join(directory, file.relativePath);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.content);
  }));
  const changed = scan.files.find((file) => file.relativePath.endsWith('.ts') && !file.generated && file.byteSize < 100_000);
  if (!changed) throw new Error('The repository mirror requires one regular TypeScript source file.');
  return { directory, changedPath: changed.relativePath, fileCount: scan.files.length };
}

async function registerWorkspace(name: string, workingDir: string): Promise<string> {
  const workspace = await workspaceRepository.createWorkspace({ name, workingDir });
  workspaceIds.push(workspace.id);
  return workspace.id;
}

afterAll(async () => {
  for (const workspaceId of workspaceIds) await codeGraphIndexService.removeWorkspace(workspaceId).catch(() => undefined);
  await Promise.all(temporaryDirectories.map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('Code Intelligence benchmark gate', () => {
  useSvelarTest({ refreshDatabase: true });

  it('measures real and synthetic repositories against the local SQLite targets', async () => {
    const roots = [{ name: 'Orkestrai', path: process.cwd() }, ...configuredRoots()];
    const reports: Array<Record<string, unknown>> = [];

    for (const root of roots) {
      const workspaceId = await registerWorkspace(`Benchmark ${root.name}`, root.path);
      const wallStartedAt = performance.now();
      const indexed = await codeGraphIndexService.index(workspaceId);
      const coldWallMs = Number((performance.now() - wallStartedAt).toFixed(2));
      const matches = await codeGraphIndexService.search(workspaceId, { query: 'CodeGraph', limit: 50 });
      const center = matches[0] ?? (await codeGraphIndexService.overview(workspaceId, undefined, 50)).nodes[0];
      expect(center, `${root.name} must expose at least one indexed symbol`).toBeTruthy();

      const exact = await sample(() => codeGraphIndexService.search(workspaceId, { query: center.name, limit: 50 }));
      const direct = await sample(() => codeGraphIndexService.subgraph(workspaceId, {
        symbolId: center.id,
        direction: 'both',
        depth: 1,
        limit: 500,
      }));
      const threeHop = await sample(() => codeGraphIndexService.subgraph(workspaceId, {
        symbolId: center.id,
        direction: 'both',
        depth: 3,
        limit: 750,
      }), 6);

      expect(exact.p95Ms).toBeLessThan(100);
      expect(direct.p95Ms).toBeLessThan(200);
      expect(threeHop.p95Ms).toBeLessThan(1_000);
      reports.push({
        root: root.name,
        coldWallMs,
        serviceMs: indexed.projects.reduce((sum, project) => sum + project.stats.durationMs, 0),
        files: indexed.stats.files,
        symbols: indexed.stats.symbols,
        edges: indexed.stats.edges,
        exact,
        direct,
        threeHop,
        projects: indexed.projects.map((project) => ({
          name: project.name,
          timings: project.stats.timings,
          indexing: project.stats.indexing,
        })),
      });
    }

    const mirror = await createRepositoryMirror(process.cwd());
    const mirrorWorkspaceId = await registerWorkspace('Benchmark Orkestrai mirror', mirror.directory);
    await codeGraphIndexService.index(mirrorWorkspaceId);
    const mirrorFile = join(mirror.directory, mirror.changedPath);
    const mirrorScan = await codeGraphFileScanner.scan(mirror.directory);
    const original = mirrorScan.files.find((file) => file.relativePath === mirror.changedPath)?.content;
    if (original == null) throw new Error('The mirrored benchmark file disappeared.');
    await writeFile(mirrorFile, `${original}\n// Orkestrai incremental benchmark marker.\n`);
    const mirrorIncrementalStartedAt = performance.now();
    const mirrorIncremental = await codeGraphIndexService.index(mirrorWorkspaceId);
    const mirrorIncrementalWallMs = Number((performance.now() - mirrorIncrementalStartedAt).toFixed(2));
    const mirrorProject = mirrorIncremental.projects[0];
    expect(mirrorProject.stats.indexing).toMatchObject({
      strategy: 'incremental',
      cacheHits: mirror.fileCount - 1,
      cacheMisses: 1,
      changedFiles: 1,
    });
    expect(mirrorIncrementalWallMs).toBeLessThan(2_000);
    reports.push({
      root: `Orkestrai ${mirror.fileCount}-file mirror incremental`,
      incrementalWallMs: mirrorIncrementalWallMs,
      serviceMs: mirrorProject.stats.durationMs,
      timings: mirrorProject.stats.timings,
      indexing: mirrorProject.stats.indexing,
    });

    const syntheticRoot = await createSyntheticRepository();
    const syntheticWorkspaceId = await registerWorkspace('Benchmark synthetic', syntheticRoot);
    await codeGraphIndexService.index(syntheticWorkspaceId);
    await writeFile(join(syntheticRoot, 'src', 'service-300.ts'), [
      "import { service299 } from './service-299';",
      'export function service300() { return service299() + 1; }',
      'export class Service300 { run() { return service300(); } }',
      '',
    ].join('\n'));
    const incrementalStartedAt = performance.now();
    const incremental = await codeGraphIndexService.index(syntheticWorkspaceId);
    const incrementalWallMs = Number((performance.now() - incrementalStartedAt).toFixed(2));
    const incrementalProject = incremental.projects[0];

    expect(incrementalProject.stats.indexing).toMatchObject({
      strategy: 'incremental',
      cacheHits: 599,
      cacheMisses: 1,
      changedFiles: 1,
    });
    expect(incrementalWallMs).toBeLessThan(2_000);
    reports.push({
      root: 'Synthetic 600-file incremental',
      incrementalWallMs,
      serviceMs: incrementalProject.stats.durationMs,
      timings: incrementalProject.stats.timings,
      indexing: incrementalProject.stats.indexing,
    });

    console.info(`CODE_GRAPH_BENCHMARK ${JSON.stringify({ generatedAt: new Date().toISOString(), reports })}`);
  });
});
