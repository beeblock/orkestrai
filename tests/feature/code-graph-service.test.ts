import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSvelarTest } from '@beeblock/svelar/testing';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { codeGraphIndexService } from '$lib/modules/agent-room/application/services/CodeGraphIndexService.js';
import { codeGraphParser } from '$lib/modules/agent-room/infrastructure/code-graph/CodeGraphParser.js';
import { workspaceRepository } from '$lib/modules/agent-room/infrastructure/repositories/WorkspaceRepository.js';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('CodeGraphIndexService', () => {
  useSvelarTest({ refreshDatabase: true });

  it('indexes a workspace atomically and exposes search and bounded traversal', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'orkestrai-code-graph-'));
    directories.push(directory);
    await mkdir(join(directory, 'src'));
    await writeFile(join(directory, 'package.json'), '{"name":"graph-test"}\n');
    await writeFile(join(directory, 'src', 'money.ts'), 'export class Money {}\n');
    await writeFile(join(directory, 'src', 'orders.ts'), `
      import { Money } from './money';
      export class OrderService {
        total() { return calculateTotal(new Money()); }
      }
    `);
    const workspace = await workspaceRepository.createWorkspace({ name: 'Graph test', workingDir: directory });

    const indexed = await codeGraphIndexService.index(workspace.id);
    expect(indexed.stats).toMatchObject({ files: 2 });
    expect(indexed.stats.symbols).toBeGreaterThanOrEqual(6);
    expect(indexed.stats.edges).toBeGreaterThanOrEqual(5);
    const repeated = await codeGraphIndexService.index(workspace.id);
    expect(repeated.projects[0].currentRevisionId).toBe(indexed.projects[0].currentRevisionId);

    const matches = await codeGraphIndexService.search(workspace.id, { query: 'OrderService' });
    expect(matches[0]).toMatchObject({ name: 'OrderService', kind: 'class', path: 'src/orders.ts' });

    const graph = await codeGraphIndexService.subgraph(workspace.id, {
      symbolId: matches[0].id,
      direction: 'both',
      depth: 2,
      limit: 100,
    });
    expect(graph.nodes.some((symbol) => symbol.name === 'total')).toBe(true);
    expect(graph.nodes.length).toBeLessThanOrEqual(100);
    expect(graph.edges.length).toBeGreaterThan(0);

    const overview = await codeGraphIndexService.overview(workspace.id);
    expect(overview.nodes.filter((symbol) => symbol.kind === 'module')).toHaveLength(2);
    expect(overview.edges.some((edge) => edge.kind === 'imports')).toBe(true);
  });

  it('marks an indexed project stale after a supported source file changes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'orkestrai-code-graph-watch-'));
    directories.push(directory);
    await writeFile(join(directory, 'package.json'), '{"name":"watch-test"}\n');
    const sourcePath = join(directory, 'service.ts');
    await writeFile(sourcePath, 'export function firstVersion() {}\n');
    const workspace = await workspaceRepository.createWorkspace({ name: 'Watch test', workingDir: directory });

    await codeGraphIndexService.index(workspace.id);
    await codeGraphIndexService.status(workspace.id);
    await writeFile(sourcePath, 'export function secondVersion() {}\n');

    let status = await codeGraphIndexService.status(workspace.id);
    for (let attempt = 0; attempt < 20 && status.projects[0].status !== 'stale'; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      status = await codeGraphIndexService.status(workspace.id);
    }
    expect(status.projects[0].status).toBe('stale');
    await codeGraphIndexService.removeWorkspace(workspace.id);
  });

  it('reuses parsed files and reparses only changed sources within the running app', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'orkestrai-code-graph-incremental-'));
    directories.push(directory);
    await writeFile(join(directory, 'package.json'), '{"name":"incremental-test"}\n');
    const firstPath = join(directory, 'first.ts');
    await writeFile(firstPath, 'export function obsoleteName() {}\n');
    await writeFile(join(directory, 'second.ts'), 'export function second() {}\n');
    const workspace = await workspaceRepository.createWorkspace({ name: 'Incremental test', workingDir: directory });
    const parse = vi.spyOn(codeGraphParser, 'parse');

    try {
      const initial = await codeGraphIndexService.index(workspace.id);
      expect(parse).toHaveBeenCalledTimes(2);
      const unchangedBefore = (await codeGraphIndexService.search(workspace.id, { query: 'second' }))[0];
      parse.mockClear();

      await writeFile(firstPath, 'export function firstChanged() {}\n');
      const updated = await codeGraphIndexService.index(workspace.id);
      expect(parse).toHaveBeenCalledTimes(1);
      expect(parse.mock.calls[0][0].relativePath).toBe('first.ts');
      expect(updated.projects[0].currentRevisionId).not.toBe(initial.projects[0].currentRevisionId);
      const unchangedAfter = (await codeGraphIndexService.search(workspace.id, { query: 'second' }))[0];
      expect(unchangedAfter.id).toBe(unchangedBefore.id);
      expect((await codeGraphIndexService.search(workspace.id, { query: 'firstChanged' }))[0]?.name).toBe('firstChanged');
      expect(await codeGraphIndexService.search(workspace.id, { query: 'obsoleteName' })).toEqual([]);

      await codeGraphIndexService.index(workspace.id, { force: true });
      const afterReplacement = await codeGraphIndexService.search(workspace.id, { query: 'second' });
      expect(afterReplacement.filter((symbol) => symbol.name === 'second')).toHaveLength(1);
    } finally {
      parse.mockRestore();
      await codeGraphIndexService.removeWorkspace(workspace.id);
    }
  });

  it('indexes explicitly registered sibling repositories without escaping their roots', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'orkestrai-code-graph-parent-'));
    directories.push(parent);
    const api = join(parent, 'api');
    const web = join(parent, 'web');
    await mkdir(api);
    await mkdir(web);
    await writeFile(join(api, 'composer.json'), '{}\n');
    await writeFile(join(api, 'User.php'), '<?php class User {}\n');
    await writeFile(join(web, 'package.json'), '{}\n');
    await writeFile(join(web, 'App.ts'), 'export function App() {}\n');
    const workspace = await workspaceRepository.createWorkspace({
      name: 'Multi repo',
      workingDir: parent,
      repositoryRoots: [{ alias: 'api', path: api }, { alias: 'web', path: web }],
    });

    const result = await codeGraphIndexService.index(workspace.id);
    expect(result.projects.map((project) => project.name).sort()).toEqual(['api', 'web']);
    expect(result.stats.files).toBe(2);
    const symbol = (await codeGraphIndexService.search(workspace.id, { query: 'User' }))[0];
    expect(symbol).toMatchObject({ name: 'User', projectRelativePath: 'api', path: 'User.php' });
    await codeGraphIndexService.removeWorkspace(workspace.id);
  });
});
