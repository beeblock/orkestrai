import { createHash } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import { basename, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { uuidv7 } from '@beeblock/svelar/support';
import { XMLParser } from 'fast-xml-parser';
import type {
  CodeGraphEvidenceEdge,
  CodeGraphEvidenceImportOptions,
  CodeGraphEvidenceKind,
  CodeGraphEvidenceRun,
  CodeGraphRuntimeEvidenceSnapshot,
  CodeGraphSymbol,
} from '../../domain/code-graph.js';
import { codeGraphRuntimeDocumentSchema } from '../../contracts/schemas/codeGraphSchemas.js';
import { codeGraphIntelligenceRepository } from '../../infrastructure/repositories/CodeGraphIntelligenceRepository.js';
import { codeGraphRepository } from '../../infrastructure/repositories/CodeGraphRepository.js';
import { workspaceRepository } from '../../infrastructure/repositories/WorkspaceRepository.js';

const MAX_EVIDENCE_BYTES = 5 * 1024 * 1024;
const MAX_LOCATIONS = 50_000;
const MAX_EDGES = 5_000;

type Location = { path: string; line: number; count: number };
type ParsedEvidence = {
  kind: CodeGraphEvidenceKind;
  covered: Location[];
  failures: Location[];
  calls: Array<{ from: Location; to: Location; count: number }>;
};

function isInside(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..');
}

function portable(value: string): string {
  return value.replaceAll('\\', '/').replace(/^\.\//, '');
}

function safeLabel(value: string | undefined, fallback: string): string {
  return (value?.trim() || fallback).slice(0, 120);
}

function stackLocations(value: string): Location[] {
  const output: Location[] = [];
  const pattern = /(?:file:\/\/)?((?:[A-Za-z]:[\\/]|\/|\.\.?[\\/])[^\n():]+?\.(?:ts|tsx|js|jsx|mjs|cjs|svelte|php)|[\w@./\\-]+\.(?:ts|tsx|js|jsx|mjs|cjs|svelte|php)):(\d+)(?::\d+)?/g;
  for (const match of value.matchAll(pattern)) {
    output.push({ path: match[1], line: Number(match[2]), count: 1 });
    if (output.length >= 2_000) break;
  }
  return output;
}

function parseLcov(content: string): ParsedEvidence {
  const covered: Location[] = [];
  let currentPath = '';
  for (const line of content.split(/\r?\n/)) {
    if (line.startsWith('SF:')) currentPath = line.slice(3).trim();
    else if (currentPath && line.startsWith('DA:')) {
      const [lineNumber, count] = line.slice(3).split(',', 2).map(Number);
      if (Number.isInteger(lineNumber) && lineNumber > 0 && Number.isFinite(count) && count > 0) {
        covered.push({ path: currentPath, line: lineNumber, count: Math.min(count, 1_000_000) });
        if (covered.length >= MAX_LOCATIONS) break;
      }
    }
  }
  return { kind: 'coverage', covered, failures: [], calls: [] };
}

function recursivelyCollectTestCases(
  value: unknown,
  output: Record<string, unknown>[],
  state: { visited: number },
  depth = 0,
): void {
  if (depth > 64 || state.visited >= 50_000 || output.length >= 10_000) return;
  state.visited += 1;
  if (Array.isArray(value)) {
    for (const item of value) recursivelyCollectTestCases(item, output, state, depth + 1);
    return;
  }
  if (!value || typeof value !== 'object') return;
  const object = value as Record<string, unknown>;
  const cases = object.testcase;
  if (cases) {
    for (const item of Array.isArray(cases) ? cases : [cases]) {
      if (item && typeof item === 'object') output.push(item as Record<string, unknown>);
    }
  }
  for (const [key, child] of Object.entries(object)) {
    if (key !== 'testcase') recursivelyCollectTestCases(child, output, state, depth + 1);
  }
}

function textValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return '';
  const object = value as Record<string, unknown>;
  return String(object['#text'] ?? object.message ?? '');
}

function parseJunit(content: string): ParsedEvidence {
  const document = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
    processEntities: false,
    allowBooleanAttributes: false,
    parseAttributeValue: false,
  }).parse(content) as unknown;
  const cases: Record<string, unknown>[] = [];
  recursivelyCollectTestCases(document, cases, { visited: 0 });
  const failures: Location[] = [];
  const calls: ParsedEvidence['calls'] = [];
  for (const testCase of cases.slice(0, 10_000)) {
    const failure = testCase.failure ?? testCase.error;
    if (!failure) continue;
    const directPath = typeof testCase.file === 'string' ? testCase.file : '';
    const directLine = Number(testCase.line ?? 0);
    const frames = stackLocations(textValue(failure));
    if (directPath && Number.isInteger(directLine) && directLine > 0) {
      failures.push({ path: directPath, line: directLine, count: 1 });
    } else if (frames[0]) {
      failures.push(frames[0]);
    }
    for (let index = 0; index < frames.length - 1 && calls.length < MAX_EDGES; index += 1) {
      calls.push({ from: frames[index + 1], to: frames[index], count: 1 });
    }
  }
  return { kind: 'test', covered: [], failures, calls };
}

function parseTrace(content: string): ParsedEvidence {
  const frames = stackLocations(content);
  const calls: ParsedEvidence['calls'] = [];
  for (let index = 0; index < frames.length - 1 && calls.length < MAX_EDGES; index += 1) {
    calls.push({ from: frames[index + 1], to: frames[index], count: 1 });
  }
  return { kind: 'trace', covered: [], failures: frames[0] ? [frames[0]] : [], calls };
}

function parseJsonEvidence(content: string): ParsedEvidence {
  const input = codeGraphRuntimeDocumentSchema.parse(JSON.parse(content));
  return {
    kind: input.calls.length ? 'trace' : input.failures.length ? 'test' : 'coverage',
    covered: input.coverage.map((item) => ({ ...item, count: item.count ?? 1 })),
    failures: input.failures.map((item) => ({ ...item, count: item.count ?? 1 })),
    calls: input.calls.map((item) => ({
      from: { ...item.from, count: item.count ?? 1 },
      to: { ...item.to, count: item.count ?? 1 },
      count: item.count ?? 1,
    })),
  };
}

function symbolForLocation(symbolsByPath: Map<string, CodeGraphSymbol[]>, location: Location): CodeGraphSymbol | null {
  const requested = portable(location.path);
  let candidates = symbolsByPath.get(requested);
  if (!candidates) {
    const suffixes = [...symbolsByPath.entries()].filter(([path]) => requested.endsWith(`/${path}`) || path.endsWith(`/${requested}`));
    if (suffixes.length === 1) candidates = suffixes[0][1];
  }
  return (candidates ?? [])
    .filter((symbol) => symbol.startLine == null || (
      symbol.startLine <= location.line && (symbol.endLine == null || symbol.endLine >= location.line)
    ))
    .sort((left, right) => {
      const leftSpan = (left.endLine ?? Number.MAX_SAFE_INTEGER) - (left.startLine ?? 0);
      const rightSpan = (right.endLine ?? Number.MAX_SAFE_INTEGER) - (right.startLine ?? 0);
      return leftSpan - rightSpan || Number(left.kind === 'module') - Number(right.kind === 'module');
    })[0] ?? null;
}

export class CodeGraphRuntimeEvidenceService {
  async import(workspaceId: string, options: CodeGraphEvidenceImportOptions): Promise<CodeGraphEvidenceRun> {
    if (isAbsolute(options.path)) throw new Error('Runtime evidence paths must be relative to the selected repository.');
    const workspace = await workspaceRepository.getWorkspace(workspaceId);
    if (!workspace) throw new Error('Workspace not found.');
    const projects = await codeGraphRepository.listProjects(workspaceId);
    const project = projects.find((item) => item.id === options.projectId);
    if (!project) throw new Error('The selected code graph repository does not belong to this workspace.');
    if (!project.currentRevisionId) throw new Error('Index the selected repository before importing runtime evidence.');
    const root = await realpath(project.rootPath);
    const requested = resolve(root, options.path);
    const sourcePath = await realpath(requested).catch(() => { throw new Error('Runtime evidence file not found.'); });
    if (!isInside(root, sourcePath)) throw new Error('Runtime evidence cannot escape the selected repository.');
    const sourceStat = await stat(sourcePath);
    if (!sourceStat.isFile()) throw new Error('Runtime evidence must point to a file.');
    if (sourceStat.size > MAX_EVIDENCE_BYTES) throw new Error('Runtime evidence exceeds the 5 MB safety limit.');
    const content = await readFile(sourcePath, 'utf8');
    const relativePath = portable(relative(root, sourcePath));
    const requestedKind = options.kind ?? 'auto';
    const extension = extname(relativePath).toLowerCase();
    const parsed = extension === '.json'
      ? parseJsonEvidence(content)
      : requestedKind === 'coverage' || relativePath.toLowerCase().endsWith('.info')
        ? parseLcov(content)
        : requestedKind === 'test' || extension === '.xml'
          ? parseJunit(content)
          : parseTrace(content);
    if (requestedKind !== 'auto' && parsed.kind !== requestedKind) {
      throw new Error(`The selected file does not contain ${requestedKind} evidence.`);
    }

    const graph = await codeGraphRepository.analysisGraph(workspaceId, 40_000, 180_000);
    const projectSymbols = graph.nodes.filter((symbol) => symbol.projectId === project.id && symbol.path);
    const symbolsByPath = new Map<string, CodeGraphSymbol[]>();
    for (const symbol of projectSymbols) {
      const path = portable(symbol.path!);
      const siblings = symbolsByPath.get(path) ?? [];
      siblings.push(symbol);
      symbolsByPath.set(path, siblings);
    }
    const staticCalls = new Set(graph.edges
      .filter((edge) => edge.kind === 'calls')
      .map((edge) => `${edge.sourceSymbolId}:${edge.targetSymbolId}`));
    const runId = uuidv7();
    const aggregated = new Map<string, CodeGraphEvidenceEdge>();
    let unmatchedLocations = 0;
    const add = (
      kind: CodeGraphEvidenceEdge['kind'],
      source: CodeGraphSymbol | null,
      target: CodeGraphSymbol,
      location: Location,
      count: number,
    ) => {
      const key = `${kind}:${source?.id ?? ''}:${target.id}`;
      const runtimeOnly = kind === 'observedCalls' && !staticCalls.has(`${source?.id}:${target.id}`);
      const previous = aggregated.get(key);
      if (previous) {
        previous.count = Math.min(1_000_000, previous.count + count);
        return;
      }
      aggregated.set(key, {
        id: uuidv7(),
        runId,
        sourceSymbolId: source?.id ?? null,
        targetSymbolId: target.id,
        kind,
        count: Math.min(Math.max(count, 1), 1_000_000),
        confidence: kind === 'observedCalls' ? 95 : 100,
        metadata: { runtimeOnly, path: portable(target.path ?? location.path), line: location.line },
      });
    };
    for (const location of parsed.covered.slice(0, MAX_LOCATIONS)) {
      const symbol = symbolForLocation(symbolsByPath, location);
      if (symbol) add('coveredBy', null, symbol, location, location.count);
      else unmatchedLocations += 1;
    }
    for (const location of parsed.failures.slice(0, MAX_EDGES)) {
      const symbol = symbolForLocation(symbolsByPath, location);
      if (symbol) add('failsAt', null, symbol, location, location.count);
      else unmatchedLocations += 1;
    }
    for (const call of parsed.calls.slice(0, MAX_EDGES)) {
      const source = symbolForLocation(symbolsByPath, call.from);
      const target = symbolForLocation(symbolsByPath, call.to);
      if (source && target) add('observedCalls', source, target, call.to, call.count);
      else unmatchedLocations += Number(!source) + Number(!target);
    }
    const edges = [...aggregated.values()].slice(0, MAX_EDGES);
    const stats = {
      coveredSymbols: edges.filter((edge) => edge.kind === 'coveredBy').length,
      failures: edges.filter((edge) => edge.kind === 'failsAt').length,
      observedCalls: edges.filter((edge) => edge.kind === 'observedCalls').length,
      runtimeOnlyCalls: edges.filter((edge) => edge.kind === 'observedCalls' && edge.metadata.runtimeOnly).length,
      unmatchedLocations,
    };
    return codeGraphIntelligenceRepository.replaceEvidenceRun({
      id: runId,
      workspaceId,
      projectId: project.id,
      revisionId: project.currentRevisionId,
      kind: parsed.kind,
      label: safeLabel(options.label, basename(relativePath)),
      sourcePath: relativePath,
      contentHash: createHash('sha256').update(content).digest('hex'),
      stats,
      importedAt: new Date().toISOString(),
    }, edges);
  }

  async snapshot(workspaceId: string, requestedLimit = 2_000): Promise<CodeGraphRuntimeEvidenceSnapshot> {
    if (!await workspaceRepository.getWorkspace(workspaceId)) throw new Error('Workspace not found.');
    const limit = Math.min(Math.max(requestedLimit, 50), 5_000);
    const runs = await codeGraphIntelligenceRepository.evidenceRuns(workspaceId, 100);
    const evidenceEdges = await codeGraphIntelligenceRepository.evidenceEdges(workspaceId, runs.map((run) => run.id), limit + 1);
    const truncated = evidenceEdges.length > limit;
    const visibleEdges = evidenceEdges.slice(0, limit);
    const symbolIds = [...new Set(visibleEdges.flatMap((edge) => [edge.sourceSymbolId, edge.targetSymbolId]).filter((id): id is string => Boolean(id)))];
    const symbols = await codeGraphRepository.symbols(workspaceId, symbolIds);
    const projects = new Map((await codeGraphRepository.listProjects(workspaceId)).map((project) => [project.id, project]));
    const runNodes: CodeGraphSymbol[] = runs.map((run) => ({
      id: run.id,
      workspaceId,
      projectId: run.projectId,
      projectName: run.projectName,
      projectRelativePath: projects.get(run.projectId)?.relativePath ?? null,
      revisionId: run.revisionId,
      fileId: null,
      path: run.sourcePath,
      language: null,
      parentSymbolId: null,
      kind: 'evidence',
      name: run.label,
      qualifiedName: `${run.projectName}:${run.sourcePath}`,
      signature: null,
      documentation: null,
      modifiers: [run.kind],
      metadata: { evidenceKind: run.kind, ...run.stats },
      exported: false,
      startLine: null,
      startColumn: null,
      endLine: null,
      endColumn: null,
    }));
    const visible = new Set([...symbols.map((symbol) => symbol.id), ...runNodes.map((node) => node.id)]);
    const graphEdges = visibleEdges.map((edge) => ({
      id: edge.id,
      workspaceId,
      projectId: runs.find((run) => run.id === edge.runId)?.projectId ?? '',
      revisionId: runs.find((run) => run.id === edge.runId)?.revisionId ?? '',
      sourceSymbolId: edge.sourceSymbolId ?? edge.runId,
      targetSymbolId: edge.targetSymbolId,
      kind: edge.kind,
      confidence: edge.confidence,
      sitePath: edge.metadata.path ?? null,
      siteLine: edge.metadata.line ?? null,
      siteColumn: null,
      metadata: { count: edge.count, runtimeOnly: edge.metadata.runtimeOnly ?? false, runId: edge.runId },
    })).filter((edge) => visible.has(edge.sourceSymbolId) && visible.has(edge.targetSymbolId));
    return {
      generatedAt: new Date().toISOString(),
      runs,
      counts: {
        runs: runs.length,
        coveredSymbols: runs.reduce((sum, run) => sum + run.stats.coveredSymbols, 0),
        failures: runs.reduce((sum, run) => sum + run.stats.failures, 0),
        observedCalls: runs.reduce((sum, run) => sum + run.stats.observedCalls, 0),
        runtimeOnlyCalls: runs.reduce((sum, run) => sum + run.stats.runtimeOnlyCalls, 0),
      },
      graph: { nodes: [...runNodes, ...symbols], edges: graphEdges, truncated, depth: 1, centerSymbolId: null },
      truncated,
    };
  }
}

export const codeGraphRuntimeEvidenceService = new CodeGraphRuntimeEvidenceService();
