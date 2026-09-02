import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSvelarTest } from '@beeblock/svelar/testing';
import { Connection } from '@beeblock/svelar/database';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { codeGraphIndexService } from '$lib/modules/agent-room/application/services/CodeGraphIndexService.js';
import { codeGraphRuntimeEvidenceService } from '$lib/modules/agent-room/application/services/CodeGraphRuntimeEvidenceService.js';
import { codeGraphSemanticService } from '$lib/modules/agent-room/application/services/CodeGraphSemanticService.js';
import { workspaceRepository } from '$lib/modules/agent-room/infrastructure/repositories/WorkspaceRepository.js';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('Code graph semantic and runtime intelligence', () => {
  useSvelarTest({ refreshDatabase: true });

  it('builds an offline semantic index and searches code by intent', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'orkestrai-code-semantic-'));
    directories.push(directory);
    await mkdir(join(directory, 'src'));
    await writeFile(join(directory, 'package.json'), '{"name":"semantic-test"}\n');
    await writeFile(join(directory, 'src', 'checkout.ts'), `
      /** Calculates the total price of a shopping cart. */
      export function calculateCheckoutTotal() { return 42; }
      export function authenticateSession() { return true; }
    `);
    const workspace = await workspaceRepository.createWorkspace({
      name: 'Semantic test',
      workingDir: directory,
      codeIntelligenceMode: 'manual',
    });
    await codeGraphIndexService.index(workspace.id);

    expect(await codeGraphSemanticService.status(workspace.id)).toMatchObject({ state: 'empty' });
    const built = await codeGraphSemanticService.build(workspace.id);
    expect(built).toMatchObject({ state: 'ready', indexedSymbols: built.totalSymbols });
    const matches = await codeGraphSemanticService.search(workspace.id, { query: 'compute shopping cart amount' });
    expect(matches[0]).toMatchObject({
      symbol: expect.objectContaining({ name: 'calculateCheckoutTotal' }),
      score: expect.any(Number),
      reasons: expect.arrayContaining(['semantic']),
    });
    await writeFile(join(directory, 'src', 'checkout.ts'), `
      export function calculateCheckoutTotal() { return 84; }
      export function authenticateSession() { return true; }
    `);
    await codeGraphIndexService.index(workspace.id, { force: true });
    expect(await codeGraphSemanticService.status(workspace.id)).toMatchObject({ state: 'stale', indexedSymbols: 0 });
    await expect(codeGraphSemanticService.search(workspace.id, { query: 'shopping cart total' })).rejects.toThrow(/build/i);
    await codeGraphIndexService.removeWorkspace(workspace.id);
  });

  it('automatically refreshes assisted semantic indexes and reuses unchanged vectors', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'orkestrai-code-semantic-assisted-'));
    directories.push(directory);
    await writeFile(join(directory, 'package.json'), '{"name":"semantic-assisted-test"}\n');
    const sourcePath = join(directory, 'service.ts');
    await writeFile(sourcePath, [
      '/** Calculates the original cart total. */',
      'export function calculateCheckoutTotal() { return 42; }',
      'export function authenticateSession() { return true; }',
      '',
    ].join('\n'));
    const workspace = await workspaceRepository.createWorkspace({ name: 'Assisted semantic test', workingDir: directory });

    await codeGraphIndexService.index(workspace.id);
    await vi.waitFor(async () => {
      expect(await codeGraphSemanticService.status(workspace.id)).toMatchObject({ state: 'ready' });
    }, { timeout: 4_000, interval: 100 });
    const initialRevision = (await codeGraphIndexService.status(workspace.id)).projects[0].currentRevisionId;
    const before = await Connection.raw(`
      SELECT e.id, e.symbol_id, e.revision_id, s.fingerprint
      FROM agent_code_graph_embeddings e
      JOIN agent_code_graph_symbols s ON s.id = e.symbol_id
      WHERE e.workspace_id = ? AND s.name = ?
      LIMIT 1
    `, [workspace.id, 'authenticateSession']) as Array<Record<string, unknown>>;
    expect(before).toHaveLength(1);

    await writeFile(sourcePath, [
      '/** Computes the promotional shopping basket amount. */',
      'export function calculateCheckoutTotal() { return 84; }',
      'export function authenticateSession() { return true; }',
      '',
    ].join('\n'));
    await vi.waitFor(async () => {
      const snapshot = await codeGraphIndexService.status(workspace.id);
      expect(snapshot.projects[0].currentRevisionId).not.toBe(initialRevision);
      expect(snapshot.projects[0].stats?.indexing?.strategy).toBe('incremental');
      expect(await codeGraphSemanticService.status(workspace.id)).toMatchObject({ state: 'ready' });
    }, { timeout: 4_000, interval: 100 });

    const after = await Connection.raw(`
      SELECT e.id, e.symbol_id, e.revision_id, s.fingerprint
      FROM agent_code_graph_embeddings e
      JOIN agent_code_graph_symbols s ON s.id = e.symbol_id
      WHERE e.workspace_id = ? AND s.name = ?
      LIMIT 1
    `, [workspace.id, 'authenticateSession']) as Array<Record<string, unknown>>;
    expect(after).toHaveLength(1);
    expect(after[0].fingerprint).toBe(before[0].fingerprint);
    expect(after[0].symbol_id).toBe(before[0].symbol_id);
    expect(after[0].id).toBe(before[0].id);
    expect(after[0].revision_id).not.toBe(before[0].revision_id);
    expect(await codeGraphSemanticService.search(workspace.id, { query: 'promotional shopping basket amount' }))
      .toEqual(expect.arrayContaining([expect.objectContaining({
        symbol: expect.objectContaining({ name: 'calculateCheckoutTotal' }),
      })]));

    await writeFile(sourcePath, [
      '/** Computes the fraud-aware checkout amount. */',
      'export function calculateCheckoutTotal() { return 126; }',
      'export function authenticateSession() { return true; }',
      '',
    ].join('\n'));
    await codeGraphIndexService.ensureFresh(workspace.id);
    expect(await codeGraphSemanticService.search(workspace.id, { query: 'fraud aware checkout amount' }))
      .toEqual(expect.arrayContaining([expect.objectContaining({
        symbol: expect.objectContaining({ name: 'calculateCheckoutTotal' }),
      })]));
    expect(await codeGraphSemanticService.status(workspace.id)).toMatchObject({ state: 'ready' });
    await codeGraphIndexService.removeWorkspace(workspace.id);
  });

  it('keeps semantic indexing empty when a repository has no supported symbols', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'orkestrai-code-semantic-empty-'));
    directories.push(directory);
    await writeFile(join(directory, 'README.md'), '# Empty repository\n');
    const workspace = await workspaceRepository.createWorkspace({ name: 'Empty semantic test', workingDir: directory });
    await codeGraphIndexService.index(workspace.id);

    expect(await codeGraphSemanticService.build(workspace.id)).toMatchObject({
      state: 'empty',
      indexedSymbols: 0,
      totalSymbols: 0,
      builtAt: null,
    });
    await expect(codeGraphSemanticService.search(workspace.id, { query: 'anything' })).rejects.toThrow(/build/i);
    await codeGraphIndexService.removeWorkspace(workspace.id);
  });

  it('imports bounded coverage and runtime call evidence without persisting raw output', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'orkestrai-code-evidence-'));
    directories.push(directory);
    await mkdir(join(directory, 'src'));
    await mkdir(join(directory, 'coverage'));
    await writeFile(join(directory, 'package.json'), '{"name":"evidence-test"}\n');
    await writeFile(join(directory, 'src', 'checkout.ts'), [
      'export function orchestrate() {',
      '  return charge();',
      '}',
      '',
      'export function charge() { return true; }',
      'export function idle() { return false; }',
      '',
    ].join('\n'));
    await writeFile(join(directory, 'coverage', 'lcov.info'), 'TN:\nSF:src/checkout.ts\nDA:2,3\nDA:5,1\nend_of_record\n');
    await writeFile(join(directory, 'runtime.json'), JSON.stringify({
      version: 1,
      failures: [{ path: 'src/checkout.ts', line: 5 }],
      calls: [{ from: { path: 'src/checkout.ts', line: 6 }, to: { path: 'src/checkout.ts', line: 5 }, count: 2 }],
    }));
    const workspace = await workspaceRepository.createWorkspace({ name: 'Evidence test', workingDir: directory });
    const indexed = await codeGraphIndexService.index(workspace.id);
    const projectId = indexed.projects[0].id;

    const coverage = await codeGraphRuntimeEvidenceService.import(workspace.id, {
      projectId,
      path: 'coverage/lcov.info',
      kind: 'coverage',
    });
    expect(coverage.stats.coveredSymbols).toBeGreaterThan(0);
    const trace = await codeGraphRuntimeEvidenceService.import(workspace.id, {
      projectId,
      path: 'runtime.json',
      kind: 'auto',
    });
    expect(trace.stats).toMatchObject({ failures: 1, observedCalls: 1, runtimeOnlyCalls: 1 });

    const snapshot = await codeGraphRuntimeEvidenceService.snapshot(workspace.id);
    expect(snapshot.counts).toMatchObject({ runs: 2, failures: 1, observedCalls: 1, runtimeOnlyCalls: 1 });
    expect(snapshot.graph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'coveredBy' }),
      expect.objectContaining({ kind: 'failsAt' }),
      expect.objectContaining({ kind: 'observedCalls', metadata: expect.objectContaining({ runtimeOnly: true, count: 2 }) }),
    ]));
    expect(JSON.stringify(snapshot)).not.toContain('return charge');
    await expect(codeGraphRuntimeEvidenceService.import(workspace.id, {
      projectId,
      path: 'runtime.json',
      kind: 'coverage',
    })).rejects.toThrow(/coverage evidence/i);
    await codeGraphIndexService.removeWorkspace(workspace.id);
  });

  it('rejects runtime evidence paths outside the approved repository', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'orkestrai-code-evidence-root-'));
    const outside = await mkdtemp(join(tmpdir(), 'orkestrai-code-evidence-outside-'));
    directories.push(directory, outside);
    await writeFile(join(directory, 'package.json'), '{"name":"evidence-root"}\n');
    await writeFile(join(directory, 'source.ts'), 'export function source() {}\n');
    await writeFile(join(outside, 'trace.log'), '/private/source.ts:1:1\n');
    const workspace = await workspaceRepository.createWorkspace({ name: 'Evidence confinement', workingDir: directory });
    const indexed = await codeGraphIndexService.index(workspace.id);

    await expect(codeGraphRuntimeEvidenceService.import(workspace.id, {
      projectId: indexed.projects[0].id,
      path: join('..', outside.split('/').at(-1)!, 'trace.log'),
    })).rejects.toThrow(/escape/i);
    await codeGraphIndexService.removeWorkspace(workspace.id);
  });
});
