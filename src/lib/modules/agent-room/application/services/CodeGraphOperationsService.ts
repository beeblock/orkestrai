import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import type {
  CodeGraphAgentConflict,
  CodeGraphAgentOverlay,
  CodeGraphContextOptions,
  CodeGraphContextPackage,
  CodeGraphEdge,
  CodeGraphFinding,
  CodeGraphOperationsSnapshot,
  CodeGraphRelationshipExplanation,
  CodeGraphRevisionComparison,
  CodeGraphRevisionRelationship,
  CodeGraphRevisionSymbol,
  CodeGraphSourceExcerpt,
  CodeGraphSubgraph,
  CodeGraphSymbol,
} from '../../domain/code-graph.js';
import { codeGraphRepository } from '../../infrastructure/repositories/CodeGraphRepository.js';
import { codeGraphChangeIntelligenceService } from './CodeGraphChangeIntelligenceService.js';
import { codeGraphContractService } from './CodeGraphContractService.js';
import { codeGraphQualityService } from './CodeGraphQualityService.js';
import { codeGraphRuntimeEvidenceService } from './CodeGraphRuntimeEvidenceService.js';
import { controlCenterService } from './ControlCenterService.js';
import { taskBoardService } from './TaskBoardService.js';

const RUNTIME_EDGE_KINDS = new Set(['coveredBy', 'failsAt', 'observedCalls']);
const SECRET_NAME = /(?:password|passwd|secret|client[_-]?secret|secret[_-]?access[_-]?key|token|access[_-]?token|refresh[_-]?token|session[_-]?token|api[_-]?key|app[_-]?key|private[_-]?key|credential|authorization|bearer|database[_-]?url|dsn)/i;
const SECRET_LINE = new RegExp(`["']?${SECRET_NAME.source}["']?\\s*[:=]`, 'i');
const SECRET_VALUE = /\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{16,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})\b|:\/\/[^/\s:@]+:[^@\s]+@/i;
const PRIVATE_KEY = /-----BEGIN [A-Z ]*PRIVATE KEY-----/;

function estimatedTokens(value: string): number {
  return Math.ceil(value.length / 4);
}

function stableId(parts: string[]): string {
  return createHash('sha256').update(parts.join('\0')).digest('hex').slice(0, 24);
}

function redact(content: string): { content: string; redacted: boolean } {
  let privateKey = false;
  let redacted = false;
  const lines = content.split('\n').map((line) => {
    if (PRIVATE_KEY.test(line)) privateKey = true;
    if (privateKey || SECRET_LINE.test(line) || SECRET_VALUE.test(line)) {
      redacted = true;
      if (/-----END [A-Z ]*PRIVATE KEY-----/.test(line)) privateKey = false;
      return '[REDACTED]';
    }
    return line;
  });
  return { content: lines.join('\n'), redacted };
}

function sanitizedMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata).slice(0, 40)) {
    if (SECRET_NAME.test(key)) continue;
    if (typeof value === 'string') {
      safe[key] = SECRET_VALUE.test(value) ? '[REDACTED]' : value.slice(0, 500);
    } else if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
      safe[key] = value;
    } else if (Array.isArray(value)) {
      safe[key] = value.slice(0, 20).flatMap((item) => {
        if (typeof item === 'string') return [SECRET_VALUE.test(item) ? '[REDACTED]' : item.slice(0, 200)];
        if (typeof item === 'number' || typeof item === 'boolean' || item === null) return [item];
        return [];
      });
    }
  }
  return safe;
}

function sanitizedContextSymbol(symbol: CodeGraphSymbol): CodeGraphSymbol {
  return {
    ...symbol,
    signature: symbol.signature ? redact(symbol.signature).content.slice(0, 1_000) : null,
    documentation: null,
    metadata: sanitizedMetadata(symbol.metadata),
  };
}

function mergeGraphs(graphs: CodeGraphSubgraph[], limit: number): CodeGraphSubgraph {
  const nodeMap = new Map<string, CodeGraphSymbol>();
  const edgeMap = new Map<string, CodeGraphEdge>();
  let truncated = false;
  for (const graph of graphs) {
    truncated ||= graph.truncated;
    for (const node of graph.nodes) {
      if (nodeMap.size >= limit && !nodeMap.has(node.id)) {
        truncated = true;
        continue;
      }
      nodeMap.set(node.id, node);
    }
    for (const edge of graph.edges) edgeMap.set(edge.id, edge);
  }
  const visible = new Set(nodeMap.keys());
  return {
    nodes: [...nodeMap.values()],
    edges: [...edgeMap.values()].filter((edge) => visible.has(edge.sourceSymbolId) && visible.has(edge.targetSymbolId)),
    truncated,
    depth: Math.max(0, ...graphs.map((graph) => graph.depth)),
    centerSymbolId: graphs.length === 1 ? graphs[0]?.centerSymbolId ?? null : null,
  };
}

function pathCandidates(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim().slice(0, 1_024))
    .filter(Boolean)
    .slice(0, 100);
}

function symbolCandidates(value: unknown): string[] {
  return pathCandidates(value).filter((item) => /^[0-9a-f-]{36}$/i.test(item));
}

function markdownPackage(input: {
  purpose: string;
  symbols: CodeGraphSymbol[];
  relationships: CodeGraphRelationshipExplanation[];
  excerpts: CodeGraphSourceExcerpt[];
  likelyTests: string[];
  findings: CodeGraphFinding[];
}): string {
  const lines = [
    '# Orkestrai code context',
    '',
    `Purpose: ${input.purpose}`,
    '',
    '## Selected symbols',
    ...input.symbols.map((symbol) => `- ${symbol.kind} \`${symbol.qualifiedName}\` (${symbol.projectName ?? 'project'}:${symbol.path ?? 'unknown'}:${symbol.startLine ?? 1}) [${symbol.id}]`),
    '',
    '## Relationships',
    ...input.relationships.map((item) => `- ${item.summary} (${item.classification}, confidence ${Math.round(item.provenance.confidence)}%)`),
  ];
  if (input.findings.length) {
    lines.push('', '## Quality evidence', ...input.findings.map((finding) => `- ${finding.severity}: ${finding.rule} (${Math.round(finding.confidence)}% confidence)`));
  }
  if (input.likelyTests.length) lines.push('', '## Likely tests', ...input.likelyTests.map((path) => `- ${path}`));
  if (input.excerpts.length) {
    lines.push('', '## Bounded source excerpts');
    for (const excerpt of input.excerpts) {
      lines.push('', `### ${excerpt.path}:${excerpt.startLine}-${excerpt.endLine}`, '```', excerpt.content, '```');
    }
  }
  return lines.join('\n');
}

export class CodeGraphOperationsService {
  async explain(workspaceId: string, edgeId: string): Promise<CodeGraphRelationshipExplanation | null> {
    let edge = await codeGraphRepository.edge(workspaceId, edgeId);
    let derivedSymbols: CodeGraphSymbol[] = [];
    if (!edge) {
      const [contracts, quality, runtime] = await Promise.all([
        codeGraphContractService.analyze(workspaceId, { limit: 1_000, includeGraph: true }).catch(() => null),
        codeGraphQualityService.analyze(workspaceId, { limit: 1_000, includeGraph: true }).catch(() => null),
        codeGraphRuntimeEvidenceService.snapshot(workspaceId, 5_000).catch(() => null),
      ]);
      const graph = [contracts?.graph, quality?.graph, runtime?.graph].find((candidate) => candidate?.edges.some((candidateEdge) => candidateEdge.id === edgeId));
      edge = graph?.edges.find((candidate) => candidate.id === edgeId) ?? null;
      derivedSymbols = graph?.nodes ?? [];
    }
    if (!edge) return null;
    const symbols = derivedSymbols.length
      ? derivedSymbols.filter((symbol) => symbol.id === edge!.sourceSymbolId || symbol.id === edge!.targetSymbolId)
      : await codeGraphRepository.symbols(workspaceId, [edge.sourceSymbolId, edge.targetSymbolId]);
    const source = symbols.find((symbol) => symbol.id === edge.sourceSymbolId);
    const target = symbols.find((symbol) => symbol.id === edge.targetSymbolId);
    if (!source || !target) return null;
    const runtimeOnly = edge.kind === 'observedCalls' && Boolean(edge.metadata.runtimeOnly);
    const classification = RUNTIME_EDGE_KINDS.has(edge.kind) ? 'runtime' : edge.confidence < 100 ? 'inferred' : 'static';
    return {
      edge,
      source,
      target,
      classification,
      provenance: {
        path: edge.sitePath,
        line: edge.siteLine,
        column: edge.siteColumn,
        confidence: edge.confidence,
        runtimeOnly,
      },
      summary: `${source.qualifiedName} ${edge.kind} ${target.qualifiedName}${edge.sitePath ? ` at ${edge.sitePath}:${edge.siteLine ?? 1}` : ''}`,
    };
  }

  async locate(workspaceId: string, path: string, line: number): Promise<CodeGraphSymbol | null> {
    const projects = await codeGraphRepository.listProjects(workspaceId);
    const normalized = path.replaceAll('\\', '/').replace(/^\.\//, '');
    for (const project of projects) {
      const projectPrefix = project.relativePath?.replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/$/, '');
      const candidate = projectPrefix && normalized.startsWith(`${projectPrefix}/`)
        ? normalized.slice(projectPrefix.length + 1)
        : normalized;
      const found = await codeGraphRepository.symbolAt(workspaceId, project.id, candidate, line);
      if (found) return found;
    }
    return null;
  }

  async context(workspaceId: string, options: CodeGraphContextOptions): Promise<CodeGraphContextPackage> {
    const maxTokens = Math.min(Math.max(options.maxTokens ?? 4_000, 500), 16_000);
    const depth = Math.min(Math.max(options.depth ?? 2, 1), 3);
    const selected = new Set(options.selection.symbolIds ?? []);
    let likelyTests: string[] = [];
    let selectedFinding: CodeGraphFinding | null = null;
    if (options.selection.scopeId) {
      const changes = await codeGraphChangeIntelligenceService.analyze(workspaceId, { depth, limit: 500 });
      const scope = changes.scopes.find((item) => item.id === options.selection.scopeId);
      if (!scope) throw new Error('The selected change scope no longer exists.');
      scope.changedSymbolIds.forEach((id) => selected.add(id));
      likelyTests = scope.likelyTests.slice(0, 40);
    }
    if (options.selection.findingId) {
      const quality = await codeGraphQualityService.analyze(workspaceId, { limit: 1_000, includeGraph: false });
      selectedFinding = quality.findings.find((item) => item.id === options.selection.findingId) ?? null;
      if (!selectedFinding) throw new Error('The selected quality finding no longer exists.');
      selectedFinding.symbolIds.forEach((id) => selected.add(id));
    }
    const selectedIds = [...selected].slice(0, 24);
    if (!selectedIds.length) throw new Error('Select at least one symbol, change scope, or quality finding.');

    const graphs = await Promise.all(selectedIds.map((symbolId) => codeGraphRepository.subgraph(workspaceId, {
      symbolId,
      direction: 'both',
      depth,
      limit: 180,
    })));
    const graph = mergeGraphs(graphs, 300);
    const selectedSymbols = graph.nodes.filter((symbol) => selected.has(symbol.id));
    const orderedSymbols = [...selectedSymbols, ...graph.nodes.filter((symbol) => !selected.has(symbol.id))];
    const relationships = (await Promise.all(graph.edges.slice(0, 400).map((edge) => this.explain(workspaceId, edge.id))))
      .filter((item): item is CodeGraphRelationshipExplanation => Boolean(item));
    const findings = selectedFinding ? [selectedFinding] : [];

    const excerpts: CodeGraphSourceExcerpt[] = [];
    if (options.includeSource !== false) {
      for (const symbol of orderedSymbols.slice(0, 8)) {
        const excerpt = await this.sourceExcerpt(workspaceId, symbol).catch(() => null);
        if (excerpt) excerpts.push(excerpt);
      }
    }

    let keptSymbols = orderedSymbols.slice(0, 120);
    let keptRelationships = relationships.slice(0, 180);
    let keptExcerpts = excerpts;
    let markdown = markdownPackage({ purpose: options.purpose, symbols: keptSymbols, relationships: keptRelationships, excerpts: keptExcerpts, likelyTests, findings });
    while (estimatedTokens(markdown) > maxTokens && keptExcerpts.length) {
      keptExcerpts = keptExcerpts.slice(0, -1);
      markdown = markdownPackage({ purpose: options.purpose, symbols: keptSymbols, relationships: keptRelationships, excerpts: keptExcerpts, likelyTests, findings });
    }
    while (estimatedTokens(markdown) > maxTokens && keptRelationships.length > 10) {
      keptRelationships = keptRelationships.slice(0, Math.max(10, Math.floor(keptRelationships.length * 0.75)));
      markdown = markdownPackage({ purpose: options.purpose, symbols: keptSymbols, relationships: keptRelationships, excerpts: keptExcerpts, likelyTests, findings });
    }
    while (estimatedTokens(markdown) > maxTokens && keptSymbols.length > selectedSymbols.length) {
      keptSymbols = keptSymbols.slice(0, Math.max(selectedSymbols.length, Math.floor(keptSymbols.length * 0.75)));
      const visible = new Set(keptSymbols.map((symbol) => symbol.id));
      keptRelationships = keptRelationships.filter((item) => visible.has(item.source.id) && visible.has(item.target.id));
      markdown = markdownPackage({ purpose: options.purpose, symbols: keptSymbols, relationships: keptRelationships, excerpts: keptExcerpts, likelyTests, findings });
    }
    if (estimatedTokens(markdown) > maxTokens) markdown = `${markdown.slice(0, maxTokens * 4 - 80)}\n\n[Context truncated to token budget]`;
    const revisionIds = [...new Set(keptSymbols.map((symbol) => symbol.revisionId))];
    const safeSymbols = keptSymbols.map(sanitizedContextSymbol);
    const safeRelationships = keptRelationships.map((relationship) => ({
      ...relationship,
      source: sanitizedContextSymbol(relationship.source),
      target: sanitizedContextSymbol(relationship.target),
      edge: { ...relationship.edge, metadata: sanitizedMetadata(relationship.edge.metadata) },
    }));
    return {
      id: stableId([workspaceId, options.purpose, ...selectedIds, ...revisionIds]),
      workspaceId,
      purpose: options.purpose,
      generatedAt: new Date().toISOString(),
      revisionIds,
      selectedSymbolIds: selectedIds,
      symbols: safeSymbols,
      relationships: safeRelationships,
      excerpts: keptExcerpts,
      likelyTests,
      findings,
      estimatedTokens: estimatedTokens(markdown),
      maxTokens,
      truncated: graph.truncated || keptSymbols.length < orderedSymbols.length || keptRelationships.length < relationships.length || keptExcerpts.length < excerpts.length,
      omitted: {
        symbols: Math.max(0, orderedSymbols.length - keptSymbols.length),
        relationships: Math.max(0, relationships.length - keptRelationships.length),
        excerpts: Math.max(0, excerpts.length - keptExcerpts.length),
      },
      markdown,
    };
  }

  async compare(workspaceId: string, projectId: string, fromId?: string, toId?: string): Promise<CodeGraphRevisionComparison> {
    const summaries = await codeGraphRepository.revisionSummaries(workspaceId, projectId, 30);
    if (summaries.length < 2) throw new Error('Index this project at least twice before comparing revisions.');
    const to = toId ? summaries.find((item) => item.id === toId) : summaries[0];
    const from = fromId ? summaries.find((item) => item.id === fromId) : summaries.find((item) => item.id !== to?.id);
    if (!from || !to) throw new Error('The selected revisions were not found for this project.');
    if (from.id === to.id) throw new Error('Select two different revisions to compare.');
    const [fromManifest, toManifest] = await Promise.all([
      codeGraphRepository.revisionManifest(workspaceId, from.id),
      codeGraphRepository.revisionManifest(workspaceId, to.id),
    ]);
    if (!fromManifest || !toManifest) throw new Error('A selected revision no longer has a comparison manifest.');
    const before = new Map(fromManifest.symbols.map((symbol) => [symbol.fingerprint, symbol]));
    const after = new Map(toManifest.symbols.map((symbol) => [symbol.fingerprint, symbol]));
    const added: CodeGraphRevisionSymbol[] = [];
    const removed: CodeGraphRevisionSymbol[] = [];
    const modified: Array<{ before: CodeGraphRevisionSymbol; after: CodeGraphRevisionSymbol }> = [];
    let unchanged = 0;
    for (const [fingerprint, symbol] of after) {
      const previous = before.get(fingerprint);
      if (!previous) added.push(symbol);
      else if (previous.contentHash !== symbol.contentHash) modified.push({ before: previous, after: symbol });
      else unchanged += 1;
    }
    for (const [fingerprint, symbol] of before) if (!after.has(fingerprint)) removed.push(symbol);
    const beforeRelationships = new Map(fromManifest.relationships.map((relationship) => [relationship.fingerprint, relationship]));
    const afterRelationships = new Map(toManifest.relationships.map((relationship) => [relationship.fingerprint, relationship]));
    const relationshipAdded: CodeGraphRevisionRelationship[] = [];
    const relationshipRemoved: CodeGraphRevisionRelationship[] = [];
    const relationshipModified: Array<{ before: CodeGraphRevisionRelationship; after: CodeGraphRevisionRelationship }> = [];
    let relationshipUnchanged = 0;
    for (const [fingerprint, relationship] of afterRelationships) {
      const previous = beforeRelationships.get(fingerprint);
      if (!previous) relationshipAdded.push(relationship);
      else if (previous.contentHash !== relationship.contentHash) relationshipModified.push({ before: previous, after: relationship });
      else relationshipUnchanged += 1;
    }
    for (const [fingerprint, relationship] of beforeRelationships) {
      if (!afterRelationships.has(fingerprint)) relationshipRemoved.push(relationship);
    }
    const limit = 2_000;
    return {
      projectId,
      projectName: to.projectName,
      from,
      to,
      added: added.slice(0, limit),
      removed: removed.slice(0, limit),
      modified: modified.slice(0, limit),
      unchanged,
      relationships: {
        added: relationshipAdded.slice(0, limit),
        removed: relationshipRemoved.slice(0, limit),
        modified: relationshipModified.slice(0, limit),
        unchanged: relationshipUnchanged,
      },
      truncated: added.length > limit || removed.length > limit || modified.length > limit
        || relationshipAdded.length > limit || relationshipRemoved.length > limit || relationshipModified.length > limit,
    };
  }

  async operations(workspaceId: string): Promise<CodeGraphOperationsSnapshot> {
    const [control, graph, tasks] = await Promise.all([
      controlCenterService.snapshot(workspaceId, false),
      codeGraphRepository.analysisGraph(workspaceId, 8_000, 30_000),
      taskBoardService.list(workspaceId),
    ]);
    const byPath = new Map<string, string[]>();
    for (const symbol of graph.nodes) {
      if (!symbol.path) continue;
      const paths = [
        symbol.path,
        symbol.projectRelativePath && symbol.projectRelativePath !== '.' ? `${symbol.projectRelativePath}/${symbol.path}` : null,
        symbol.projectName ? `${symbol.projectName}/${symbol.path}` : null,
      ].filter((path): path is string => Boolean(path));
      for (const path of paths) {
        const normalized = path.replaceAll('\\', '/').replace(/^\.\//, '');
        const values = byPath.get(normalized) ?? [];
        values.push(symbol.id);
        byPath.set(normalized, values);
      }
    }
    const agents: CodeGraphAgentOverlay[] = control.agents.map((agent) => {
      const symbols = symbolCandidates(agent.lastActionData.symbolIds);
      const paths = pathCandidates(agent.lastActionData.paths);
      const task = agent.currentTask ? tasks.find((item) => item.id === agent.currentTask?.id) : null;
      const description = task?.description ?? '';
      const marker = description.match(/<!--\s*orkestrai:code-graph-symbols=([0-9a-f,\s-]+)\s*-->/i)?.[1];
      if (marker) symbols.push(...marker.split(',').map((id) => id.trim()).filter((id) => /^[0-9a-f-]{36}$/i.test(id)));
      for (const match of description.matchAll(/(?:^|[\s`(])([\w@./-]+\.(?:[cm]?[jt]sx?|svelte|php|json|ya?ml))(?::\d+)?/gmi)) {
        if (match[1]) paths.push(match[1].replace(/^\.\//, ''));
      }
      for (const path of paths) {
        const normalized = path.replaceAll('\\', '/').replace(/^\.\//, '');
        (byPath.get(normalized) ?? []).forEach((id) => symbols.push(id));
      }
      return {
        nodeId: agent.nodeId,
        title: agent.title,
        provider: agent.provider,
        state: agent.state,
        floorId: agent.floorId,
        floorName: agent.floorName,
        task: agent.currentTask,
        symbolIds: [...new Set(symbols)].slice(0, 200),
        paths: [...new Set(paths)].slice(0, 100),
      };
    });
    const conflicts: CodeGraphAgentConflict[] = [];
    for (let leftIndex = 0; leftIndex < agents.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < agents.length; rightIndex += 1) {
        const left = agents[leftIndex];
        const right = agents[rightIndex];
        if (!left || !right || !['starting', 'working', 'waiting_input', 'waiting_permission'].includes(left.state) || !['starting', 'working', 'waiting_input', 'waiting_permission'].includes(right.state)) continue;
        const sharedSymbolIds = left.symbolIds.filter((id) => right.symbolIds.includes(id));
        const sharedPaths = left.paths.filter((path) => right.paths.includes(path));
        if (!sharedSymbolIds.length && !sharedPaths.length) continue;
        conflicts.push({
          id: stableId([left.nodeId, right.nodeId, ...sharedSymbolIds, ...sharedPaths]),
          severity: sharedSymbolIds.length ? 'error' : 'warning',
          leftNodeId: left.nodeId,
          rightNodeId: right.nodeId,
          sharedSymbolIds,
          sharedPaths,
        });
      }
    }
    const visible = new Set(agents.filter((agent) => agent.state !== 'disconnected').flatMap((agent) => agent.symbolIds));
    return {
      generatedAt: new Date().toISOString(),
      agents,
      conflicts,
      graph: {
        nodes: graph.nodes.filter((symbol) => visible.has(symbol.id)),
        edges: graph.edges.filter((edge) => visible.has(edge.sourceSymbolId) && visible.has(edge.targetSymbolId)),
        truncated: graph.truncated,
        depth: 0,
        centerSymbolId: null,
      },
    };
  }

  private async sourceExcerpt(workspaceId: string, symbol: CodeGraphSymbol): Promise<CodeGraphSourceExcerpt | null> {
    if (!symbol.path || symbol.startLine === null) return null;
    const project = (await codeGraphRepository.listProjects(workspaceId)).find((item) => item.id === symbol.projectId);
    if (!project) return null;
    const root = await realpath(project.rootPath);
    const candidate = resolve(root, symbol.path);
    const resolved = await realpath(candidate);
    const rel = relative(root, resolved);
    if (!rel || rel.startsWith(`..${sep}`) || rel === '..' || isAbsolute(rel)) return null;
    const source = await readFile(resolved, 'utf8');
    if (source.length > 2_000_000) return null;
    const lines = source.split(/\r?\n/);
    const startLine = Math.max(1, symbol.startLine - 8);
    const requestedEnd = symbol.endLine ?? symbol.startLine + 40;
    const endLine = Math.min(lines.length, Math.max(symbol.startLine, requestedEnd) + 8, startLine + 79);
    const sanitized = redact(lines.slice(startLine - 1, endLine).join('\n'));
    return {
      symbolId: symbol.id,
      projectId: symbol.projectId,
      path: symbol.path,
      startLine,
      endLine,
      language: symbol.language,
      content: sanitized.content,
      redacted: sanitized.redacted,
    };
  }
}

export const codeGraphOperationsService = new CodeGraphOperationsService();
