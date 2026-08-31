import { createHash } from 'node:crypto';
import type {
  CodeGraphEdge,
  CodeGraphFinding,
  CodeGraphFindingRule,
  CodeGraphQualityOptions,
  CodeGraphQualitySnapshot,
  CodeGraphSubgraph,
  CodeGraphSymbol,
} from '../../domain/code-graph.js';
import { codeGraphRepository } from '../../infrastructure/repositories/CodeGraphRepository.js';
import { codeGraphIndexService } from './CodeGraphIndexService.js';

const DATA_FLOW_KINDS = new Set<CodeGraphEdge['kind']>(['reads', 'writes', 'queries', 'usesEnv', 'sends', 'receives']);
const SEVERITY_ORDER = { error: 0, warning: 1, info: 2 } as const;

type QualityCache = Map<string, CodeGraphQualitySnapshot>;

function qualityCache(): QualityCache {
  const global = globalThis as typeof globalThis & { __orkestraiCodeGraphQualityCache?: QualityCache };
  global.__orkestraiCodeGraphQualityCache ??= new Map();
  return global.__orkestraiCodeGraphQualityCache;
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 32);
}

function unique(values: Array<string | null>, limit = 50): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))].slice(0, limit);
}

function finding(
  rule: CodeGraphFindingRule,
  input: Omit<CodeGraphFinding, 'id' | 'rule'>,
): CodeGraphFinding {
  const identity = [...input.symbolIds].sort().join(':');
  return { id: `quality:${hash(`${rule}:${identity}`)}`, rule, ...input };
}

function numberMetadata(symbol: CodeGraphSymbol, key: string): number {
  const value = Number(symbol.metadata[key]);
  return Number.isFinite(value) ? value : 0;
}

function stronglyConnectedComponents(adjacency: Map<string, Set<string>>): string[][] {
  const reverse = new Map<string, Set<string>>();
  for (const [source, targets] of adjacency) {
    reverse.set(source, reverse.get(source) ?? new Set());
    for (const target of targets) reverse.set(target, (reverse.get(target) ?? new Set()).add(source));
  }
  const visited = new Set<string>();
  const order: string[] = [];
  for (const start of adjacency.keys()) {
    if (visited.has(start)) continue;
    visited.add(start);
    const stack: Array<{ id: string; targets: string[]; cursor: number }> = [{ id: start, targets: [...(adjacency.get(start) ?? [])], cursor: 0 }];
    while (stack.length) {
      const frame = stack.at(-1)!;
      const next = frame.targets[frame.cursor++];
      if (next && !visited.has(next)) {
        visited.add(next);
        stack.push({ id: next, targets: [...(adjacency.get(next) ?? [])], cursor: 0 });
      } else if (!next) {
        order.push(frame.id);
        stack.pop();
      }
    }
  }
  const assigned = new Set<string>();
  const output: string[][] = [];
  for (const start of order.reverse()) {
    if (assigned.has(start)) continue;
    const component: string[] = [];
    const stack = [start];
    assigned.add(start);
    while (stack.length) {
      const current = stack.pop()!;
      component.push(current);
      for (const next of reverse.get(current) ?? []) {
        if (!assigned.has(next)) {
          assigned.add(next);
          stack.push(next);
        }
      }
    }
    if (component.length > 1) output.push(component);
  }
  return output;
}

function architectureLayer(path: string | null): string | null {
  const segments = String(path ?? '').toLowerCase().split('/');
  if (segments.includes('domain')) return 'domain';
  if (segments.includes('application')) return 'application';
  if (segments.includes('infrastructure')) return 'infrastructure';
  if (segments.includes('interface') || segments.includes('routes')) return 'interface';
  return null;
}

function entryPointPath(path: string | null): boolean {
  return /(^|\/)(?:routes?|controllers?|hooks?|middleware|migrations?|commands?|jobs?|events?|listeners?|policies|config|bootstrap|tests?|__tests__)(\/|\.|$)/i.test(path ?? '')
    || /(?:^|\/)(?:index|main|app|server|worker|hooks?)(?:\.[^.]+)?$/i.test(path ?? '');
}

function entryPointName(name: string): boolean {
  return /^(?:constructor|__construct|main|default|render|mount|setup|boot|register|handle|run|execute|GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/i.test(name);
}

export class CodeGraphQualityService {
  async analyze(workspaceId: string, options: CodeGraphQualityOptions = {}): Promise<CodeGraphQualitySnapshot> {
    const status = await codeGraphIndexService.status(workspaceId);
    const limit = Math.min(Math.max(options.limit ?? 500, 50), 1_000);
    const includeGraph = options.includeGraph ?? false;
    const revisionKey = status.projects.map((project) => `${project.id}:${project.currentRevisionId ?? 'none'}`).sort().join('|');
    const cacheKey = `${workspaceId}:${hash(revisionKey)}:${limit}:${includeGraph ? 1 : 0}`;
    const cached = qualityCache().get(cacheKey);
    if (cached) return cached;

    const source = await codeGraphRepository.analysisGraph(
      workspaceId,
      Math.min(40_000, Math.max(10_000, limit * 60)),
      Math.min(180_000, Math.max(40_000, limit * 300)),
    );
    const nodeById = new Map(source.nodes.map((node) => [node.id, node]));
    const findings: CodeGraphFinding[] = [];
    findings.push(...this.duplicates(source.nodes));
    findings.push(...this.cycles(source.nodes, source.edges));
    findings.push(...this.coupling(source.nodes, source.edges));
    findings.push(...this.boundaries(nodeById, source.edges));
    findings.push(...this.smells(source.nodes, source.edges));
    findings.push(...this.security(nodeById, source.edges));
    findings.push(...this.deadCode(source.nodes, source.edges));
    const deduplicated = [...new Map(findings.map((item) => [item.id, item])).values()]
      .sort((left, right) => SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity] || right.confidence - left.confidence);
    const visibleFindings = deduplicated.slice(0, limit);

    const resources = source.nodes.filter((node) => node.kind === 'resource');
    const resourceIds = new Set(resources.map((resource) => resource.id));
    const allDataEdges = source.edges.filter((edge) => DATA_FLOW_KINDS.has(edge.kind) && resourceIds.has(edge.targetSymbolId));
    const dataEdges = allDataEdges.slice(0, limit * 4);
    const visibleResourceIds = new Set(dataEdges.map((edge) => edge.targetSymbolId));
    const visibleResources = resources.filter((resource) => visibleResourceIds.has(resource.id)).slice(0, limit);
    const byType = resources.reduce<Record<string, number>>((counts, resource) => {
      const type = String(resource.metadata.resourceType ?? 'unknown').slice(0, 40);
      counts[type] = (counts[type] ?? 0) + 1;
      return counts;
    }, {});

    const graph = includeGraph
      ? this.visibleGraph(source, visibleFindings, dataEdges)
      : { nodes: [], edges: [], truncated: false, depth: 0, centerSymbolId: null };
    const snapshot: CodeGraphQualitySnapshot = {
      generatedAt: new Date().toISOString(),
      findings: visibleFindings,
      counts: {
        findings: deduplicated.length,
        errors: deduplicated.filter((item) => item.severity === 'error').length,
        warnings: deduplicated.filter((item) => item.severity === 'warning').length,
        duplicates: deduplicated.filter((item) => item.kind === 'duplicate').length,
        cycles: deduplicated.filter((item) => item.kind === 'cycle').length,
        deadCode: deduplicated.filter((item) => item.kind === 'dead-code').length,
      },
      dataFlow: { resources: visibleResources, edges: dataEdges, byType },
      graph,
      truncated: source.truncated || deduplicated.length > limit || allDataEdges.length > dataEdges.length || resources.length > visibleResources.length,
    };
    qualityCache().set(cacheKey, snapshot);
    if (qualityCache().size > 20) qualityCache().delete(qualityCache().keys().next().value!);
    return snapshot;
  }

  private duplicates(nodes: CodeGraphSymbol[]): CodeGraphFinding[] {
    const groups = new Map<string, CodeGraphSymbol[]>();
    for (const node of nodes) {
      const fingerprint = typeof node.metadata.structureFingerprint === 'string' ? node.metadata.structureFingerprint : '';
      const nodeCount = numberMetadata(node, 'structureNodeCount');
      const lineSpan = numberMetadata(node, 'lineSpan');
      if (!fingerprint || nodeCount < 12 || lineSpan < 5 || node.modifiers.includes('generated') || !['function', 'method', 'class'].includes(node.kind)) continue;
      const key = `${node.kind}:${fingerprint}`;
      groups.set(key, [...(groups.get(key) ?? []), node]);
    }
    return [...groups.values()].flatMap((candidates) => {
      const paths = unique(candidates.map((candidate) => candidate.path));
      if (candidates.length < 2 || paths.length < 2) return [];
      return [finding('duplicate-structure', {
        kind: 'duplicate',
        severity: candidates.length >= 3 ? 'warning' : 'info',
        confidence: 88,
        symbolIds: candidates.map((candidate) => candidate.id).slice(0, 20),
        projectNames: unique(candidates.map((candidate) => candidate.projectName)),
        paths,
        metrics: { candidates: candidates.length, structureNodes: numberMetadata(candidates[0], 'structureNodeCount') },
      })];
    });
  }

  private cycles(nodes: CodeGraphSymbol[], edges: CodeGraphEdge[]): CodeGraphFinding[] {
    const modules = new Map(nodes.filter((node) => node.kind === 'module').map((node) => [node.id, node]));
    const adjacency = new Map<string, Set<string>>();
    for (const edge of edges) {
      if (edge.kind !== 'imports' || !modules.has(edge.sourceSymbolId) || !modules.has(edge.targetSymbolId)) continue;
      adjacency.set(edge.sourceSymbolId, (adjacency.get(edge.sourceSymbolId) ?? new Set()).add(edge.targetSymbolId));
      adjacency.set(edge.targetSymbolId, adjacency.get(edge.targetSymbolId) ?? new Set());
    }
    return stronglyConnectedComponents(adjacency).map((component) => {
      const members = component.map((id) => modules.get(id)!).filter(Boolean);
      return finding('import-cycle', {
        kind: 'cycle',
        severity: members.length >= 5 ? 'error' : 'warning',
        confidence: 100,
        symbolIds: component.slice(0, 50),
        projectNames: unique(members.map((member) => member.projectName)),
        paths: unique(members.map((member) => member.path)),
        metrics: { modules: members.length },
      });
    });
  }

  private coupling(nodes: CodeGraphSymbol[], edges: CodeGraphEdge[]): CodeGraphFinding[] {
    const modules = new Map(nodes.filter((node) => node.kind === 'module').map((node) => [node.id, node]));
    const incoming = new Map<string, Set<string>>();
    const outgoing = new Map<string, Set<string>>();
    for (const edge of edges) {
      if (edge.kind !== 'imports' || !modules.has(edge.sourceSymbolId) || !modules.has(edge.targetSymbolId)) continue;
      outgoing.set(edge.sourceSymbolId, (outgoing.get(edge.sourceSymbolId) ?? new Set()).add(edge.targetSymbolId));
      incoming.set(edge.targetSymbolId, (incoming.get(edge.targetSymbolId) ?? new Set()).add(edge.sourceSymbolId));
    }
    return [...modules.values()].flatMap((module) => {
      const fanIn = incoming.get(module.id)?.size ?? 0;
      const fanOut = outgoing.get(module.id)?.size ?? 0;
      const total = fanIn + fanOut;
      if (total < 12 || Math.max(fanIn, fanOut) < 8) return [];
      return [finding('high-coupling', {
        kind: 'coupling',
        severity: total >= 24 ? 'warning' : 'info',
        confidence: 100,
        symbolIds: [module.id],
        projectNames: unique([module.projectName]),
        paths: unique([module.path]),
        metrics: { fanIn, fanOut, total },
      })];
    });
  }

  private boundaries(nodeById: Map<string, CodeGraphSymbol>, edges: CodeGraphEdge[]): CodeGraphFinding[] {
    const forbidden: Record<string, Set<string>> = {
      domain: new Set(['application', 'infrastructure', 'interface']),
      application: new Set(['interface']),
    };
    return edges.flatMap((edge) => {
      if (edge.kind !== 'imports') return [];
      const source = nodeById.get(edge.sourceSymbolId);
      const target = nodeById.get(edge.targetSymbolId);
      if (source?.kind !== 'module' || target?.kind !== 'module') return [];
      const sourceLayer = architectureLayer(source.path);
      const targetLayer = architectureLayer(target.path);
      if (!sourceLayer || !targetLayer || !forbidden[sourceLayer]?.has(targetLayer)) return [];
      return [finding('layer-boundary', {
        kind: 'boundary',
        severity: sourceLayer === 'domain' ? 'error' : 'warning',
        confidence: 95,
        symbolIds: [source.id, target.id],
        projectNames: unique([source.projectName, target.projectName]),
        paths: unique([source.path, target.path]),
        metrics: { sourceLayer, targetLayer },
      })];
    });
  }

  private smells(nodes: CodeGraphSymbol[], edges: CodeGraphEdge[]): CodeGraphFinding[] {
    const findings: CodeGraphFinding[] = [];
    for (const symbol of nodes) {
      const span = symbol.endLine && symbol.startLine ? symbol.endLine - symbol.startLine + 1 : numberMetadata(symbol, 'lineSpan');
      const threshold = symbol.kind === 'class' ? 300 : ['function', 'method'].includes(symbol.kind) ? 100 : 0;
      if (threshold && span > threshold) findings.push(finding('long-symbol', {
        kind: 'smell', severity: span > threshold * 2 ? 'error' : 'warning', confidence: 100,
        symbolIds: [symbol.id], projectNames: unique([symbol.projectName]), paths: unique([symbol.path]),
        metrics: { lines: span, threshold },
      }));
    }
    const defines = new Map<string, number>();
    for (const edge of edges) if (edge.kind === 'defines') defines.set(edge.sourceSymbolId, (defines.get(edge.sourceSymbolId) ?? 0) + 1);
    for (const module of nodes.filter((node) => node.kind === 'module')) {
      const symbols = defines.get(module.id) ?? 0;
      if (symbols > 75) findings.push(finding('oversized-module', {
        kind: 'smell', severity: symbols > 150 ? 'error' : 'warning', confidence: 100,
        symbolIds: [module.id], projectNames: unique([module.projectName]), paths: unique([module.path]),
        metrics: { symbols, threshold: 75 },
      }));
    }
    return findings;
  }

  private security(nodeById: Map<string, CodeGraphSymbol>, edges: CodeGraphEdge[]): CodeGraphFinding[] {
    const sensitive = new Map<string, { severity: CodeGraphFinding['severity']; confidence: number }>([
      ['eval', { severity: 'error', confidence: 90 }],
      ['unserialize', { severity: 'warning', confidence: 75 }],
      ['shell_exec', { severity: 'warning', confidence: 75 }],
      ['passthru', { severity: 'warning', confidence: 75 }],
      ['system', { severity: 'warning', confidence: 65 }],
      ['exec', { severity: 'warning', confidence: 55 }],
      ['execsync', { severity: 'warning', confidence: 60 }],
      ['spawn', { severity: 'info', confidence: 50 }],
    ]);
    return edges.flatMap((edge) => {
      if (!['calls', 'instantiates'].includes(edge.kind)) return [];
      const source = nodeById.get(edge.sourceSymbolId);
      const target = nodeById.get(edge.targetSymbolId);
      const rule = target ? sensitive.get(target.name.toLowerCase()) : null;
      if (!source || !target || !rule) return [];
      return [finding('security-sensitive-execution', {
        kind: 'security', severity: rule.severity, confidence: rule.confidence,
        symbolIds: [source.id, target.id], projectNames: unique([source.projectName]), paths: unique([source.path]),
        metrics: { operation: target.name.slice(0, 80) },
      })];
    });
  }

  private deadCode(nodes: CodeGraphSymbol[], edges: CodeGraphEdge[]): CodeGraphFinding[] {
    const incoming = new Map<string, number>();
    const ignored = new Set<CodeGraphEdge['kind']>(['contains', 'defines', 'exports']);
    for (const edge of edges) if (!ignored.has(edge.kind)) incoming.set(edge.targetSymbolId, (incoming.get(edge.targetSymbolId) ?? 0) + 1);
    return nodes.flatMap((symbol) => {
      const eligible = ['function', 'class', 'interface', 'type', 'enum'].includes(symbol.kind)
        || (symbol.kind === 'method' && symbol.modifiers.includes('private'));
      if (!eligible || incoming.has(symbol.id) || symbol.modifiers.includes('generated') || entryPointPath(symbol.path) || entryPointName(symbol.name)) return [];
      const confidence = symbol.exported ? 45 : symbol.kind === 'method' ? 55 : 78;
      return [finding('unreferenced-symbol', {
        kind: 'dead-code', severity: confidence >= 70 ? 'warning' : 'info', confidence,
        symbolIds: [symbol.id], projectNames: unique([symbol.projectName]), paths: unique([symbol.path]),
        metrics: { exported: symbol.exported ? 'yes' : 'no', rule: symbol.exported ? 'no-indexed-consumer' : 'non-exported-unreferenced' },
      })];
    });
  }

  private visibleGraph(source: CodeGraphSubgraph, findings: CodeGraphFinding[], dataEdges: CodeGraphEdge[]): CodeGraphSubgraph {
    const selected = new Set(findings.flatMap((item) => item.symbolIds));
    for (const edge of dataEdges) {
      if (selected.size >= 700) break;
      selected.add(edge.sourceSymbolId);
      selected.add(edge.targetSymbolId);
    }
    const nodes = source.nodes.filter((node) => selected.has(node.id)).slice(0, 700);
    const visible = new Set(nodes.map((node) => node.id));
    const edges = source.edges
      .filter((edge) => visible.has(edge.sourceSymbolId) && visible.has(edge.targetSymbolId))
      .slice(0, 2_800);
    return {
      nodes,
      edges,
      truncated: source.truncated || selected.size > nodes.length,
      depth: 0,
      centerSymbolId: null,
    };
  }
}

export const codeGraphQualityService = new CodeGraphQualityService();
