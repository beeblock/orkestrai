import { createHash } from 'node:crypto';
import type { GitChange } from './GitService.js';
import type {
  CodeGraphChangeIntelligence,
  CodeGraphChangeOptions,
  CodeGraphChangeScope,
  CodeGraphChangedFile,
  CodeGraphFloorConflict,
  CodeGraphProject,
  CodeGraphSubgraph,
  CodeGraphSymbol,
} from '../../domain/code-graph.js';
import { codeGraphRepository } from '../../infrastructure/repositories/CodeGraphRepository.js';
import { workspaceRepository } from '../../infrastructure/repositories/WorkspaceRepository.js';
import { floorService } from './FloorService.js';
import { gitService } from './GitService.js';
import { codeGraphIndexService } from './CodeGraphIndexService.js';

const TEST_PATH = /(?:^|\/)(?:test|tests|__tests__|spec)(?:\/|$)|\.(?:test|spec)\.[^/]+$/i;

type ProjectChanges = { project: CodeGraphProject; changes: GitChange[] };

function intersect(left: Iterable<string>, right: Set<string>, limit = 20): string[] {
  const output: string[] = [];
  for (const value of left) {
    if (right.has(value)) output.push(value);
    if (output.length >= limit) break;
  }
  return output;
}

function collapseChanges(changes: GitChange[]): GitChange[] {
  const byPath = new Map<string, GitChange>();
  for (const change of changes) {
    const current = byPath.get(change.path);
    byPath.set(change.path, current ? {
      ...change,
      id: current.id,
      previousPath: change.previousPath ?? current.previousPath,
      staged: current.staged && change.staged,
    } : change);
  }
  return [...byPath.values()].sort((left, right) => left.path.localeCompare(right.path));
}

function mergeGraphs(graphs: CodeGraphSubgraph[], limit: number): CodeGraphSubgraph {
  const nodes = new Map<string, CodeGraphSymbol>();
  const edges = new Map<string, CodeGraphSubgraph['edges'][number]>();
  let truncated = false;
  let depth = 0;
  for (const graph of graphs) {
    depth = Math.max(depth, graph.depth);
    truncated ||= graph.truncated;
    for (const node of graph.nodes) {
      if (nodes.size >= limit && !nodes.has(node.id)) {
        truncated = true;
        continue;
      }
      nodes.set(node.id, node);
    }
    for (const edge of graph.edges) edges.set(edge.id, edge);
  }
  const visible = new Set(nodes.keys());
  return {
    nodes: [...nodes.values()],
    edges: [...edges.values()].filter((edge) => visible.has(edge.sourceSymbolId) && visible.has(edge.targetSymbolId)),
    truncated,
    depth,
    centerSymbolId: null,
  };
}

function likelyTests(graph: CodeGraphSubgraph): string[] {
  return [...new Set(graph.nodes.flatMap((node) => node.path && TEST_PATH.test(node.path) ? [node.path] : []))]
    .sort()
    .slice(0, 100);
}

export class CodeGraphChangeIntelligenceService {
  async analyze(workspaceId: string, options: CodeGraphChangeOptions = {}): Promise<CodeGraphChangeIntelligence> {
    const workspace = await workspaceRepository.getWorkspace(workspaceId);
    if (!workspace) throw new Error('Workspace not found.');
    const snapshot = await codeGraphIndexService.status(workspaceId);
    const projects = snapshot.projects.filter((project) => project.currentRevisionId);
    const depth = Math.min(Math.max(options.depth ?? 2, 1), 3);
    const limit = Math.min(Math.max(options.limit ?? 500, 50), 750);

    const workspaceChanges: ProjectChanges[] = [];
    for (const project of projects) {
      const status = await gitService.statusDirectory(project.rootPath).catch(() => null);
      if (status?.isRepo && status.changes.length) {
        workspaceChanges.push({ project, changes: collapseChanges(status.changes) });
      }
    }

    const scopes: CodeGraphChangeScope[] = [];
    if (workspaceChanges.length) {
      scopes.push(await this.buildScope(workspaceId, {
        id: 'workspace', kind: 'workspace', name: workspace.name, floorId: null,
        branch: null, changes: workspaceChanges, depth, limit,
      }));
    }

    const primary = projects.find((project) => project.rootPath === workspace.workingDir || project.relativePath === '.');
    if (primary) {
      const ground = await gitService.statusDirectory(primary.rootPath).catch(() => null);
      for (const floor of await floorService.list(workspaceId)) {
        const committed = ground?.head
          ? await gitService.changesSinceMergeBase(primary.rootPath, ground.head, floor.branch).catch(() => [])
          : [];
        const dirty = await gitService.statusDirectory(floor.path).catch(() => null);
        const changes = collapseChanges([...committed, ...(dirty?.changes ?? [])]);
        if (!changes.length) continue;
        scopes.push(await this.buildScope(workspaceId, {
          id: `floor:${floor.id}`, kind: 'floor', name: floor.name, floorId: floor.id,
          branch: floor.branch, changes: [{ project: primary, changes }], depth, limit,
        }));
      }
    }

    const impact = mergeGraphs(scopes.map((scope) => scope.impact), limit);
    const floorScopes = scopes.filter((scope) => scope.kind === 'floor');
    const conflicts: CodeGraphFloorConflict[] = [];
    for (let leftIndex = 0; leftIndex < floorScopes.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < floorScopes.length; rightIndex += 1) {
        const conflict = this.conflict(floorScopes[leftIndex], floorScopes[rightIndex]);
        if (conflict) conflicts.push(conflict);
      }
    }

    return {
      generatedAt: new Date().toISOString(),
      scopes,
      impact,
      likelyTests: likelyTests(impact),
      conflicts,
      truncated: impact.truncated || scopes.some((scope) => scope.truncated),
    };
  }

  private async buildScope(
    workspaceId: string,
    input: {
      id: string;
      kind: CodeGraphChangeScope['kind'];
      name: string;
      floorId: string | null;
      branch: string | null;
      changes: ProjectChanges[];
      depth: number;
      limit: number;
    },
  ): Promise<CodeGraphChangeScope> {
    const files: CodeGraphChangedFile[] = [];
    const changedSymbols = new Map<string, CodeGraphSymbol>();
    for (const { project, changes } of input.changes) {
      const symbols = await codeGraphRepository.symbolsForPaths(
        workspaceId,
        project.id,
        changes.map((change) => change.path),
      );
      const symbolsByPath = new Map<string, CodeGraphSymbol[]>();
      for (const symbol of symbols) {
        if (!symbol.path) continue;
        symbolsByPath.set(symbol.path, [...(symbolsByPath.get(symbol.path) ?? []), symbol]);
        changedSymbols.set(symbol.id, symbol);
      }
      files.push(...changes.map((change) => ({
        projectId: project.id,
        projectName: project.name,
        path: change.path,
        previousPath: change.previousPath,
        status: change.status,
        staged: change.staged,
        symbolIds: (symbolsByPath.get(change.path) ?? []).map((symbol) => symbol.id),
      })));
    }

    const impact = changedSymbols.size
      ? await codeGraphRepository.impact(workspaceId, [...changedSymbols.keys()], input.depth, input.limit)
      : { nodes: [], edges: [], truncated: false, depth: input.depth, centerSymbolId: null };
    return {
      id: input.id,
      kind: input.kind,
      name: input.name,
      floorId: input.floorId,
      branch: input.branch,
      files,
      changedSymbolIds: [...changedSymbols.keys()],
      impact,
      likelyTests: likelyTests(impact),
      truncated: impact.truncated || changedSymbols.size >= 2_000,
    };
  }

  private conflict(left: CodeGraphChangeScope, right: CodeGraphChangeScope): CodeGraphFloorConflict | null {
    const rightPaths = new Set(right.files.map((file) => `${file.projectId}:${file.path}`));
    const sharedPaths = left.files
      .filter((file) => rightPaths.has(`${file.projectId}:${file.path}`))
      .map((file) => `${file.projectName}/${file.path}`)
      .slice(0, 20);
    const rightDirect = new Set(right.changedSymbolIds);
    const directCandidates = left.impact.nodes
      .filter((node) => left.changedSymbolIds.includes(node.id) && node.kind !== 'module')
      .map((node) => node.id);
    const sharedSymbolIds = intersect(directCandidates, rightDirect);
    const rightImpact = new Set(right.impact.nodes
      .filter((node) => node.kind !== 'module' && node.kind !== 'external')
      .map((node) => node.id));
    const sharedImpactSymbolIds = intersect(
      left.impact.nodes
        .filter((node) => node.kind !== 'module' && node.kind !== 'external')
        .map((node) => node.id),
      rightImpact,
    ).filter((id) => !sharedSymbolIds.includes(id));
    const sharedTests = intersect(left.likelyTests, new Set(right.likelyTests));
    if (!sharedPaths.length && !sharedSymbolIds.length && !sharedImpactSymbolIds.length && !sharedTests.length) return null;
    const identity = [left.floorId, right.floorId].sort().join(':');
    return {
      id: createHash('sha256').update(identity).digest('hex').slice(0, 24),
      leftFloorId: left.floorId!,
      leftFloorName: left.name,
      rightFloorId: right.floorId!,
      rightFloorName: right.name,
      severity: sharedPaths.length || sharedSymbolIds.length ? 'high' : 'medium',
      sharedPaths,
      sharedSymbolIds,
      sharedImpactSymbolIds,
      sharedTests,
    };
  }
}

export const codeGraphChangeIntelligenceService = new CodeGraphChangeIntelligenceService();
