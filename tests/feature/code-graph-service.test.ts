import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSvelarTest } from '@beeblock/svelar/testing';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { codeGraphIndexService } from '$lib/modules/agent-room/application/services/CodeGraphIndexService.js';
import { codeGraphChangeIntelligenceService } from '$lib/modules/agent-room/application/services/CodeGraphChangeIntelligenceService.js';
import { codeGraphHandoffService } from '$lib/modules/agent-room/application/services/CodeGraphHandoffService.js';
import { codeGraphContractService } from '$lib/modules/agent-room/application/services/CodeGraphContractService.js';
import { codeGraphQualityService } from '$lib/modules/agent-room/application/services/CodeGraphQualityService.js';
import { taskBoardService } from '$lib/modules/agent-room/application/services/TaskBoardService.js';
import { floorService } from '$lib/modules/agent-room/application/services/FloorService.js';
import { codeGraphParser } from '$lib/modules/agent-room/infrastructure/code-graph/CodeGraphParser.js';
import { workspaceRepository } from '$lib/modules/agent-room/infrastructure/repositories/WorkspaceRepository.js';
import { apiClientNativePayloadSchema, apiClientRequestSchema } from '$lib/modules/agent-room/contracts/schemas/apiClient.schema.js';

const directories: string[] = [];

function initializeGit(directory: string): void {
  execFileSync('git', ['init', '-b', 'main'], { cwd: directory });
  execFileSync('git', ['config', 'user.email', 'tests@orkestrai.local'], { cwd: directory });
  execFileSync('git', ['config', 'user.name', 'Orkestrai Tests'], { cwd: directory });
  execFileSync('git', ['add', '.'], { cwd: directory });
  execFileSync('git', ['commit', '-m', 'initial'], { cwd: directory });
}

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
    expect(indexed.projects[0].stats).toMatchObject({
      timings: {
        scanMs: expect.any(Number),
        parseMs: expect.any(Number),
        resolveMs: expect.any(Number),
        persistMs: expect.any(Number),
      },
      indexing: {
        strategy: 'cold',
        cacheHits: 0,
        cacheMisses: 2,
        changedFiles: 2,
      },
    });
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
      expect(updated.projects[0].stats.indexing).toMatchObject({
        strategy: 'incremental',
        cacheHits: 1,
        cacheMisses: 1,
        changedFiles: 1,
      });
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

  it('maps API contracts across repositories, generated clients, OpenAPI, and live API Client requests', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'orkestrai-contract-parent-'));
    directories.push(parent);
    const api = join(parent, 'api');
    const web = join(parent, 'web');
    await mkdir(join(api, 'src', 'routes', 'api', 'users', '[id]'), { recursive: true });
    await mkdir(join(web, 'src', 'generated'), { recursive: true });
    await writeFile(join(api, 'package.json'), '{"name":"contracts-api"}\n');
    await writeFile(join(api, 'src', 'routes', 'api', 'users', '[id]', '+server.ts'), `
      import { userIdSchema } from '$lib/schemas/user';
      export const GET = async ({ params }) => ({ id: userIdSchema.parse(params.id) });
    `);
    await writeFile(join(api, 'openapi.json'), JSON.stringify({
      openapi: '3.1.0',
      info: { title: 'Users', version: '1.0.0' },
      paths: {
        '/api/users/{id}': {
          get: {
            operationId: 'getUser',
            responses: { 200: { content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } } } },
          },
        },
      },
      components: { schemas: { User: { type: 'object' } } },
    }));
    await writeFile(join(web, 'package.json'), '{"name":"contracts-web"}\n');
    await writeFile(join(web, 'src', 'generated', 'users.generated.ts'), `
      export async function getUser(id: string) {
        return fetch(\`/api/users/\${id}\`);
      }
    `);
    const workspace = await workspaceRepository.createWorkspace({
      name: 'Contract map',
      workingDir: parent,
      repositoryRoots: [{ alias: 'api', path: api }, { alias: 'web', path: web }],
    });
    const liveRequest = apiClientRequestSchema.parse({
      id: 'live-user',
      name: 'Get live user',
      method: 'GET',
      protocol: 'http',
      url: 'https://private.example/api/users/42?token=must-not-leak',
      assertions: [],
    });
    await workspaceRepository.createNode({
      workspaceId: workspace.id,
      type: 'apiClient',
      title: 'User API',
      payload: apiClientNativePayloadSchema.parse({ requests: [liveRequest] }),
    });

    await codeGraphIndexService.index(workspace.id);
    const contracts = await codeGraphContractService.analyze(workspace.id, { includeGraph: true });

    expect(contracts.endpoints).toEqual(expect.arrayContaining([
      expect.objectContaining({ metadata: expect.objectContaining({ method: 'GET', path: '/api/users/{param}' }) }),
    ]));
    expect(contracts.schemas).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'User', metadata: expect.objectContaining({ framework: 'openapi' }) }),
    ]));
    expect(contracts.requests).toEqual(expect.arrayContaining([
      expect.objectContaining({ projectName: 'web', modifiers: expect.arrayContaining(['generated']) }),
      expect.objectContaining({ projectName: 'User API', metadata: expect.objectContaining({ path: '/api/users/42' }) }),
    ]));
    expect(contracts.matches).toEqual(expect.arrayContaining([
      expect.objectContaining({ reason: 'exact', crossProject: true }),
    ]));
    expect(contracts.graph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'generatedFrom' }),
    ]));
    expect(JSON.stringify(contracts)).not.toContain('private.example');
    expect(JSON.stringify(contracts)).not.toContain('must-not-leak');
    await codeGraphIndexService.removeWorkspace(workspace.id);
  });

  it('matches frontend requests through an indexed gateway prefix', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'orkestrai-gateway-parent-'));
    directories.push(parent);
    const api = join(parent, 'api');
    const web = join(parent, 'web');
    await mkdir(api);
    await mkdir(web);
    await writeFile(join(api, 'package.json'), '{"name":"gateway-api"}\n');
    await writeFile(join(api, 'routes.ts'), `
      app.use('/api', router);
      router.get('/users/:id', getUser);
    `);
    await writeFile(join(web, 'package.json'), '{"name":"gateway-web"}\n');
    await writeFile(join(web, 'client.ts'), 'export const loadUser = (id: string) => api.get(`/api/users/${id}`);\n');
    const workspace = await workspaceRepository.createWorkspace({
      name: 'Gateway map',
      workingDir: parent,
      repositoryRoots: [{ alias: 'api', path: api }, { alias: 'web', path: web }],
    });

    await codeGraphIndexService.index(workspace.id);
    const contracts = await codeGraphContractService.analyze(workspace.id);

    expect(contracts.gateways).toEqual(expect.arrayContaining([
      expect.objectContaining({ metadata: expect.objectContaining({ pathPrefix: '/api' }) }),
    ]));
    expect(contracts.matches).toEqual(expect.arrayContaining([
      expect.objectContaining({ reason: 'gateway-prefix', crossProject: true, gatewaySymbolId: expect.any(String) }),
    ]));
    const gatewayMatch = contracts.matches.find((match) => match.reason === 'gateway-prefix');
    const graph = await codeGraphContractService.analyze(workspace.id, { includeGraph: true });
    expect(graph.graph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'routesTo',
        sourceSymbolId: gatewayMatch?.gatewaySymbolId,
        targetSymbolId: gatewayMatch?.endpointSymbolId,
      }),
    ]));
    await codeGraphIndexService.removeWorkspace(workspace.id);
  });

  it('reports bounded quality evidence and safe data-flow resources', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'orkestrai-code-quality-'));
    directories.push(directory);
    await mkdir(join(directory, 'src', 'domain'), { recursive: true });
    await mkdir(join(directory, 'src', 'infrastructure'), { recursive: true });
    await writeFile(join(directory, 'package.json'), '{"name":"quality-test"}\n');
    await writeFile(join(directory, 'src', 'a.ts'), `
      import { beta } from './b';
      export function alpha(value: number) {
        const doubled = value * 2;
        const adjusted = doubled + 1;
        if (adjusted > 10) return adjusted;
        return adjusted * 3;
      }
      export const callBeta = () => beta(1);
    `);
    await writeFile(join(directory, 'src', 'b.ts'), `
      import { alpha } from './a';
      export function beta(input: number) {
        const scaled = input * 7;
        const shifted = scaled + 9;
        if (shifted > 40) return shifted;
        return shifted * 5;
      }
      export const callAlpha = () => alpha(1);
    `);
    await writeFile(join(directory, 'src', 'infrastructure', 'db.ts'), 'export const storage = { ready: true };\n');
    await writeFile(join(directory, 'src', 'domain', 'use-case.ts'), `
      import { storage } from '../infrastructure/db';
      export function domainUseCase() { return storage.ready; }
    `);
    await writeFile(join(directory, 'src', 'flows.ts'), `
      export async function synchronize() {
        const key = process.env.API_TOKEN;
        const config = readFileSync('config/app.json');
        const response = await fetch('https://private.example/api/users/supersecrettoken1234567890?token=must-not-leak');
        const users = db.table('users');
        await ipcRenderer.invoke('users:sync');
        return { key, config, response, users };
      }
      function abandonedFeature() {
        const first = 1;
        const second = first + 2;
        return second;
      }
      export function riskyExpression(source: string) { return eval(source); }
    `);
    const workspace = await workspaceRepository.createWorkspace({ name: 'Quality map', workingDir: directory });

    await codeGraphIndexService.index(workspace.id);
    const quality = await codeGraphQualityService.analyze(workspace.id, { includeGraph: true, limit: 500 });
    const rules = new Set(quality.findings.map((item) => item.rule));

    expect(rules).toContain('duplicate-structure');
    expect(rules).toContain('import-cycle');
    expect(rules).toContain('layer-boundary');
    expect(rules).toContain('security-sensitive-execution');
    expect(rules).toContain('unreferenced-symbol');
    expect(quality.dataFlow.byType).toMatchObject({ environment: 1, file: 1, network: 1, database: 1, ipc: 1 });
    expect(quality.graph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'usesEnv' }),
      expect.objectContaining({ kind: 'reads' }),
      expect.objectContaining({ kind: 'queries' }),
      expect.objectContaining({ kind: 'sends' }),
    ]));
    expect(JSON.stringify(quality)).not.toContain('private.example');
    expect(JSON.stringify(quality)).not.toContain('must-not-leak');
    expect(JSON.stringify(quality)).not.toContain('supersecrettoken1234567890');
    expect(quality.dataFlow.resources).toEqual(expect.arrayContaining([
      expect.objectContaining({ qualifiedName: 'resource:network:/api/users/{opaque}' }),
    ]));
    await codeGraphIndexService.removeWorkspace(workspace.id);
  });

  it('does not misrepresent a multi-repository change set as a primary Git review', async () => {
    const primary = await mkdtemp(join(tmpdir(), 'orkestrai-code-graph-primary-'));
    const sibling = await mkdtemp(join(tmpdir(), 'orkestrai-code-graph-sibling-'));
    directories.push(primary, sibling);
    await writeFile(join(primary, 'package.json'), '{"name":"primary"}\n');
    await writeFile(join(primary, 'app.ts'), 'export function primaryApp() { return 1; }\n');
    await writeFile(join(sibling, 'package.json'), '{"name":"sibling"}\n');
    await writeFile(join(sibling, 'api.ts'), 'export function siblingApi() { return 1; }\n');
    initializeGit(primary);
    initializeGit(sibling);
    const workspace = await workspaceRepository.createWorkspace({
      name: 'Mixed changes',
      workingDir: primary,
      repositoryRoots: [{ alias: 'sibling', path: sibling }],
    });
    await codeGraphIndexService.index(workspace.id);
    await writeFile(join(primary, 'app.ts'), 'export function primaryApp() { return 2; }\n');
    await writeFile(join(sibling, 'api.ts'), 'export function siblingApi() { return 2; }\n');

    const intelligence = await codeGraphChangeIntelligenceService.analyze(workspace.id);
    expect(new Set(intelligence.scopes[0].files.map((file) => file.projectName))).toEqual(new Set(['Mixed changes', 'sibling']));
    const task = await codeGraphHandoffService.create(workspace.id, {
      kind: 'task', scopeId: 'workspace', title: 'Review all repository changes', locale: 'en',
    });
    expect(task.kind).toBe('task');
    await expect(codeGraphHandoffService.create(workspace.id, {
      kind: 'review', scopeId: 'workspace', title: 'Unsafe partial review', locale: 'en',
    })).rejects.toThrow('more than one repository');
    await codeGraphIndexService.removeWorkspace(workspace.id);
  });

  it('maps working tree changes to affected symbols and likely tests', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'orkestrai-code-impact-'));
    directories.push(directory);
    await mkdir(join(directory, 'src'));
    await mkdir(join(directory, 'tests'));
    await writeFile(join(directory, 'package.json'), '{"name":"impact-test"}\n');
    await writeFile(join(directory, 'src', 'orders.ts'), 'export function total() { return 1; }\n');
    await writeFile(join(directory, 'tests', 'orders.test.ts'), `
      import { total } from '../src/orders';
      export function verifiesTotal() { return total(); }
    `);
    initializeGit(directory);
    const workspace = await workspaceRepository.createWorkspace({ name: 'Impact test', workingDir: directory });

    await codeGraphIndexService.index(workspace.id);
    await writeFile(join(directory, 'src', 'orders.ts'), 'export function total() { return 2; }\n');
    const intelligence = await codeGraphChangeIntelligenceService.analyze(workspace.id);

    expect(intelligence.scopes).toHaveLength(1);
    expect(intelligence.scopes[0]).toMatchObject({ kind: 'workspace' });
    expect(intelligence.scopes[0].files).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'src/orders.ts', status: 'M' }),
    ]));
    expect(intelligence.impact.nodes.some((symbol) => symbol.name === 'total')).toBe(true);
    expect(intelligence.likelyTests).toContain('tests/orders.test.ts');
    const task = await codeGraphHandoffService.create(workspace.id, {
      kind: 'task', scopeId: 'workspace', title: 'Investigate order impact', locale: 'en',
    });
    expect(task).toMatchObject({ kind: 'task', artifact: { title: 'Investigate order impact', status: 'todo' } });
    expect((await taskBoardService.list(workspace.id))[0].description).toContain('## Likely tests');
    const review = await codeGraphHandoffService.create(workspace.id, {
      kind: 'review', scopeId: 'workspace', title: 'Review order impact', locale: 'en',
    });
    expect(review).toMatchObject({ kind: 'review', artifact: { title: 'Review order impact', status: 'pending' } });
    await codeGraphIndexService.removeWorkspace(workspace.id);
  });

  it('flags overlapping Floor changes as a high-confidence conflict', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'orkestrai-code-floor-impact-'));
    directories.push(directory);
    await mkdir(join(directory, 'src'));
    await writeFile(join(directory, 'package.json'), '{"name":"floor-impact-test"}\n');
    await writeFile(join(directory, 'src', 'orders.ts'), 'export function total() { return 1; }\n');
    initializeGit(directory);
    const workspace = await workspaceRepository.createWorkspace({ name: 'Floor impact', workingDir: directory });
    await codeGraphIndexService.index(workspace.id);
    const left = await floorService.create(workspace.id, { name: 'Pricing A' });
    const right = await floorService.create(workspace.id, { name: 'Pricing B' });
    await writeFile(join(left.path, 'src', 'orders.ts'), 'export function total() { return 2; }\n');
    execFileSync('git', ['add', 'src/orders.ts'], { cwd: left.path });
    execFileSync('git', ['commit', '-m', 'change pricing'], { cwd: left.path });
    await writeFile(join(right.path, 'src', 'orders.ts'), 'export function total() { return 3; }\n');

    const intelligence = await codeGraphChangeIntelligenceService.analyze(workspace.id);

    expect(intelligence.scopes.filter((scope) => scope.kind === 'floor')).toHaveLength(2);
    expect(intelligence.conflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        leftFloorName: 'Pricing A',
        rightFloorName: 'Pricing B',
        severity: 'high',
        sharedPaths: ['Floor impact/src/orders.ts'],
      }),
    ]));
    const floorTask = await codeGraphHandoffService.create(workspace.id, {
      kind: 'task', scopeId: `floor:${left.id}`, title: 'Resolve pricing overlap', locale: 'en',
    });
    expect(floorTask.artifact.title).toBe('Resolve pricing overlap');
    await expect(codeGraphHandoffService.create(workspace.id, {
      kind: 'review', scopeId: `floor:${left.id}`, title: 'Review pricing Floor', locale: 'en',
    })).rejects.toThrow('primary Git working tree');
    await codeGraphIndexService.removeWorkspace(workspace.id);
  });
});
