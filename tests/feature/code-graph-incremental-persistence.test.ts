import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSvelarTest } from '@beeblock/svelar/testing';
import { Connection } from '@beeblock/svelar/database';
import { CodeGraphConnection } from '$lib/database/code-graph-storage.js';
import { codeGraphRepository } from '$lib/modules/agent-room/infrastructure/repositories/CodeGraphRepository.js';
import { workspaceRepository } from '$lib/modules/agent-room/infrastructure/repositories/WorkspaceRepository.js';
import type { CodeGraphCommit } from '$lib/modules/agent-room/application/ports/CodeGraphStore.js';

type Graph = Pick<CodeGraphCommit, 'files' | 'symbols' | 'edges'>;

function graph(fileCount: number, rebound = 0): Graph {
  const files: Graph['files'] = [];
  const symbols: Graph['symbols'] = [];
  const edges: Graph['edges'] = [];
  for (let index = 0; index < fileCount; index++) {
    const key = `file:${index}`;
    files.push({ key, path: `src/service-${index}.ts`, language: 'typescript',
      contentHash: `source:${index}`, resolutionHash: `resolution:${index}:${index < rebound ? 1 : 0}`,
      byteSize: 100, generated: false, symbolCount: 1, edgeCount: 1, modifiedAt: '2026-11-03T00:00:00.000Z' });
    symbols.push({ key: `symbol:${index}`, fileKey: key, parentKey: null, kind: 'function',
      name: `service${index}`, qualifiedName: `service${index}`, signature: '(): number', documentation: null,
      modifiers: [], metadata: {}, exported: true, startLine: 1, startColumn: 1, endLine: 3, endColumn: 1,
      fingerprint: `symbol:${index}` });
    edges.push({ sourceKey: `symbol:${index}`, targetKey: `symbol:${(index + 1) % fileCount}`,
      siteFileKey: key, kind: 'calls', confidence: index < rebound ? 75 : 100, siteLine: 2, siteColumn: 1,
      metadata: {}, fingerprint: `edge:${index}` });
  }
  edges.push({ sourceKey: 'symbol:0', targetKey: 'symbol:1', siteFileKey: null,
    kind: 'references', confidence: rebound ? 80 : 100, siteLine: null, siteColumn: null,
    metadata: {}, fingerprint: 'without-file' });
  return { files, symbols, edges };
}

async function project(name: string) {
  const workspace = await workspaceRepository.createWorkspace({ name, workingDir: process.cwd(), codeIntelligenceMode: 'manual' });
  const [project] = await codeGraphRepository.syncProjects(workspace.id, [{ name, rootPath: process.cwd(), relativePath: '.', configHash: 'test' }]);
  return { workspaceId: workspace.id, projectId: project.id };
}

async function publish(scope: { workspaceId: string; projectId: string }, value: Graph, sourceHash: string) {
  const revision = await codeGraphRepository.beginRevision(scope.workspaceId, scope.projectId, null);
  return codeGraphRepository.commitRevision({ ...scope, ...value, revisionId: revision.id, sourceHash,
    fullReplace: false, gitHead: null, diagnostics: [], stats: {
      files: value.files.length, symbols: value.symbols.length, edges: value.edges.length,
      skipped: 0, durationMs: 0, languages: { typescript: value.files.length },
      timings: { scanMs: 0, parseMs: 0, resolveMs: 0, persistMs: 0 },
      indexing: { strategy: 'incremental', cacheHits: value.files.length, cacheMisses: 0, changedFiles: 0 },
    } });
}

async function inspectEdgePlans() {
  const raw = CodeGraphConnection.raw.bind(CodeGraphConnection);
  const client = await Connection.rawClient();
  const plans: string[][] = [];
  vi.spyOn(CodeGraphConnection, 'raw').mockImplementation(async (sql, bindings = []) => {
    if (/SELECT e\.id, e\.fingerprint FROM agent_code_graph_edges e/.test(sql)) {
      const plan = client.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...bindings);
      plans.push(plan.map((row: { detail: string }) => row.detail));
    }
    return raw(sql, bindings);
  });
  return plans;
}

function expectFileLookups(plans: string[][]) {
  expect(plans.length).toBeGreaterThan(0);
  for (const plan of plans) {
    // Guard actual SQLite access paths, rather than a machine-specific timing.
    // A revision-leading lookup walks every relationship even for one changed file.
    expect(plan.some(detail => /SEARCH e .*\(site_file_id=\?\)/.test(detail))).toBe(true);
    expect(plan.some(detail => /SCAN e\b|SEARCH e .*\(revision_id=\?\)/.test(detail))).toBe(false);
  }
}

describe('file-bounded incremental graph persistence', () => {
  useSvelarTest({ refreshDatabase: true });
  afterEach(() => vi.restoreAllMocks());

  it('looks up only changed-file relationships and preserves another workspace including fileless edges', async () => {
    const target = await project('Target');
    await publish(target, graph(60), 'before');
    const other = await project('Other');
    await publish(other, graph(3), 'other');
    const otherBefore = await CodeGraphConnection.raw('SELECT * FROM agent_code_graph_edges WHERE workspace_id = ? ORDER BY id', [other.workspaceId]);
    const stableBefore = await CodeGraphConnection.raw('SELECT id, updated_at FROM agent_code_graph_symbols WHERE project_id = ? ORDER BY id', [target.projectId]);
    const plans = await inspectEdgePlans();

    const result = await publish(target, graph(60, 1), 'after');

    expect(result.stats.indexing?.strategy).toBe('incremental');
    expect(await CodeGraphConnection.raw('SELECT * FROM agent_code_graph_edges WHERE workspace_id = ? ORDER BY id', [other.workspaceId])).toEqual(otherBefore);
    expect(await CodeGraphConnection.raw('SELECT id, updated_at FROM agent_code_graph_symbols WHERE project_id = ? ORDER BY id', [target.projectId])).toEqual(stableBefore);
    expect(await CodeGraphConnection.raw('SELECT fingerprint, confidence FROM agent_code_graph_edges WHERE project_id = ? AND confidence < 100 ORDER BY fingerprint', [target.projectId]))
      .toEqual([{ fingerprint: 'edge:0', confidence: 75 }, { fingerprint: 'without-file', confidence: 80 }]);
    expectFileLookups(plans);
  });

  it('keeps every batch file-bounded when an unchanged source rebinds more than 400 callers', async () => {
    const target = await project('Rebound callers');
    await publish(target, graph(501), 'before');
    const plans = await inspectEdgePlans();

    const result = await publish(target, graph(501, 450), 'after');

    expect(result.stats.indexing).toMatchObject({ strategy: 'incremental', changedFiles: 0 });
    expect(await CodeGraphConnection.raw('SELECT COUNT(*) AS n FROM agent_code_graph_edges WHERE project_id = ? AND confidence = 75', [target.projectId])).toEqual([{ n: 450 }]);
    expect(await CodeGraphConnection.raw('SELECT COUNT(*) AS n FROM agent_code_graph_edges WHERE project_id = ? AND confidence = 100', [target.projectId])).toEqual([{ n: 51 }]);
    expect(plans).toHaveLength(2);
    expectFileLookups(plans);
  });
});
