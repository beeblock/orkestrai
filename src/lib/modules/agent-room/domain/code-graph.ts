export const CODE_GRAPH_LANGUAGES = ['typescript', 'javascript', 'svelte', 'php', 'json', 'yaml'] as const;
export type CodeGraphLanguage = (typeof CODE_GRAPH_LANGUAGES)[number];

export const CODE_GRAPH_SYMBOL_KINDS = [
  'module', 'namespace', 'class', 'interface', 'type', 'enum', 'function',
  'method', 'variable', 'endpoint', 'apiRequest', 'schema', 'gateway', 'resource', 'external', 'evidence',
] as const;
export type CodeGraphSymbolKind = (typeof CODE_GRAPH_SYMBOL_KINDS)[number];

export const CODE_GRAPH_EDGE_KINDS = [
  'contains', 'defines', 'imports', 'exports', 'calls', 'references',
  'instantiates', 'inherits', 'implements', 'handles', 'requests', 'matches',
  'validates', 'generatedFrom', 'routesTo', 'reads', 'writes', 'queries',
  'usesEnv', 'sends', 'receives', 'coveredBy', 'failsAt', 'observedCalls',
] as const;
export type CodeGraphEdgeKind = (typeof CODE_GRAPH_EDGE_KINDS)[number];

export type CodeGraphProjectStatus = 'idle' | 'indexing' | 'ready' | 'stale' | 'error';

export type CodeGraphDiagnostic = {
  path: string | null;
  severity: 'info' | 'warning' | 'error';
  code: string;
  message: string;
};

export type CodeGraphStats = {
  files: number;
  symbols: number;
  edges: number;
  skipped: number;
  durationMs: number;
  languages: Partial<Record<CodeGraphLanguage, number>>;
  timings?: {
    scanMs: number;
    parseMs: number;
    resolveMs: number;
    persistMs: number;
  };
  indexing?: {
    strategy: 'cold' | 'incremental' | 'full' | 'mixed';
    cacheHits: number;
    cacheMisses: number;
    changedFiles: number;
  };
};

export type CodeGraphProject = {
  id: string;
  workspaceId: string;
  name: string;
  rootPath: string;
  relativePath: string | null;
  status: CodeGraphProjectStatus;
  currentRevisionId: string | null;
  gitHead: string | null;
  stats: CodeGraphStats;
  diagnostics: CodeGraphDiagnostic[];
  lastIndexedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CodeGraphSymbol = {
  id: string;
  workspaceId: string;
  projectId: string;
  projectName: string | null;
  projectRelativePath: string | null;
  revisionId: string;
  fileId: string | null;
  path: string | null;
  language: CodeGraphLanguage | null;
  parentSymbolId: string | null;
  kind: CodeGraphSymbolKind;
  name: string;
  qualifiedName: string;
  signature: string | null;
  documentation: string | null;
  modifiers: string[];
  metadata: Record<string, unknown>;
  exported: boolean;
  startLine: number | null;
  startColumn: number | null;
  endLine: number | null;
  endColumn: number | null;
};

export type CodeGraphEdge = {
  id: string;
  workspaceId: string;
  projectId: string;
  revisionId: string;
  sourceSymbolId: string;
  targetSymbolId: string;
  kind: CodeGraphEdgeKind;
  confidence: number;
  sitePath: string | null;
  siteLine: number | null;
  siteColumn: number | null;
  metadata: Record<string, unknown>;
};

export type CodeGraphSnapshot = {
  projects: CodeGraphProject[];
  totals: CodeGraphStats;
  indexing: boolean;
};

export type CodeGraphSubgraph = {
  nodes: CodeGraphSymbol[];
  edges: CodeGraphEdge[];
  truncated: boolean;
  depth: number;
  centerSymbolId: string | null;
};

export type CodeGraphIndexResult = {
  projects: CodeGraphProject[];
  stats: CodeGraphStats;
};

export type CodeGraphChangedFile = {
  projectId: string;
  projectName: string;
  path: string;
  previousPath: string | null;
  status: string;
  staged: boolean;
  symbolIds: string[];
};

export type CodeGraphChangeScope = {
  id: string;
  kind: 'workspace' | 'floor';
  name: string;
  floorId: string | null;
  branch: string | null;
  files: CodeGraphChangedFile[];
  changedSymbolIds: string[];
  impact: CodeGraphSubgraph;
  likelyTests: string[];
  truncated: boolean;
};

export type CodeGraphFloorConflict = {
  id: string;
  leftFloorId: string;
  leftFloorName: string;
  rightFloorId: string;
  rightFloorName: string;
  severity: 'high' | 'medium';
  sharedPaths: string[];
  sharedSymbolIds: string[];
  sharedImpactSymbolIds: string[];
  sharedTests: string[];
};

export type CodeGraphChangeIntelligence = {
  generatedAt: string;
  scopes: CodeGraphChangeScope[];
  impact: CodeGraphSubgraph;
  likelyTests: string[];
  conflicts: CodeGraphFloorConflict[];
  truncated: boolean;
};

export type CodeGraphIndexOptions = {
  projectIds?: string[];
  force?: boolean;
};

export type CodeGraphSearchOptions = {
  query: string;
  projectId?: string;
  kinds?: CodeGraphSymbolKind[];
  limit?: number;
};

export type CodeGraphTraversalOptions = {
  symbolId: string;
  direction?: 'incoming' | 'outgoing' | 'both';
  kinds?: CodeGraphEdgeKind[];
  depth?: number;
  limit?: number;
};

export type CodeGraphChangeOptions = {
  depth?: number;
  limit?: number;
};

export type CodeGraphHandoffOptions = {
  kind: 'review' | 'task' | 'leader' | 'agent' | 'council';
  scopeId?: string;
  title: string;
  locale: 'pt-BR' | 'en' | 'es';
  context?: CodeGraphContextOptions;
  targetNodeId?: string;
  targetNodeIds?: string[];
};

export type CodeGraphHandoffResult = {
  kind: CodeGraphHandoffOptions['kind'];
  scopeId: string | null;
  artifact: {
    id: string;
    title: string;
    status: string;
    type?: 'review' | 'task' | 'council';
  };
};

export type CodeGraphContractOptions = {
  limit?: number;
  includeGraph?: boolean;
};

export type CodeGraphContractMatch = {
  id: string;
  requestSymbolId: string;
  endpointSymbolId: string;
  gatewaySymbolId: string | null;
  confidence: number;
  reason: 'exact' | 'gateway-prefix';
  crossProject: boolean;
};

export type CodeGraphContractConflict = {
  id: string;
  method: string;
  path: string;
  endpointSymbolIds: string[];
  projectNames: string[];
};

export type CodeGraphContractSnapshot = {
  generatedAt: string;
  endpoints: CodeGraphSymbol[];
  requests: CodeGraphSymbol[];
  schemas: CodeGraphSymbol[];
  gateways: CodeGraphSymbol[];
  matches: CodeGraphContractMatch[];
  conflicts: CodeGraphContractConflict[];
  unmatchedRequestIds: string[];
  unmatchedEndpointIds: string[];
  graph: CodeGraphSubgraph;
  truncated: boolean;
};

export const CODE_GRAPH_FINDING_KINDS = [
  'duplicate', 'cycle', 'coupling', 'boundary', 'smell', 'security', 'dead-code',
] as const;
export type CodeGraphFindingKind = (typeof CODE_GRAPH_FINDING_KINDS)[number];

export const CODE_GRAPH_FINDING_RULES = [
  'duplicate-structure', 'import-cycle', 'high-coupling', 'layer-boundary',
  'long-symbol', 'oversized-module', 'security-sensitive-execution', 'unreferenced-symbol',
] as const;
export type CodeGraphFindingRule = (typeof CODE_GRAPH_FINDING_RULES)[number];

export type CodeGraphFinding = {
  id: string;
  kind: CodeGraphFindingKind;
  rule: CodeGraphFindingRule;
  severity: 'info' | 'warning' | 'error';
  confidence: number;
  symbolIds: string[];
  projectNames: string[];
  paths: string[];
  metrics: Record<string, string | number | string[]>;
};

export type CodeGraphQualityOptions = {
  limit?: number;
  includeGraph?: boolean;
};

export type CodeGraphQualitySnapshot = {
  generatedAt: string;
  findings: CodeGraphFinding[];
  counts: {
    findings: number;
    errors: number;
    warnings: number;
    duplicates: number;
    cycles: number;
    deadCode: number;
  };
  dataFlow: {
    resources: CodeGraphSymbol[];
    edges: CodeGraphEdge[];
    byType: Record<string, number>;
  };
  graph: CodeGraphSubgraph;
  truncated: boolean;
};

export const CODE_GRAPH_SEMANTIC_MODEL = 'orkestrai-code-subword-v1';
export const CODE_GRAPH_SEMANTIC_DIMENSIONS = 384;

export type CodeGraphSemanticState = 'empty' | 'ready' | 'stale';

export type CodeGraphSemanticStatus = {
  state: CodeGraphSemanticState;
  model: string;
  dimensions: number;
  indexedSymbols: number;
  totalSymbols: number;
  builtAt: string | null;
};

export type CodeGraphSemanticMatch = {
  symbol: CodeGraphSymbol;
  score: number;
  reasons: Array<'semantic' | 'name' | 'path' | 'documentation'>;
};

export type CodeGraphSemanticSearchOptions = {
  query: string;
  projectId?: string;
  kinds?: CodeGraphSymbolKind[];
  limit?: number;
};

export const CODE_GRAPH_EVIDENCE_KINDS = ['coverage', 'test', 'trace'] as const;
export type CodeGraphEvidenceKind = (typeof CODE_GRAPH_EVIDENCE_KINDS)[number];

export const CODE_GRAPH_EVIDENCE_EDGE_KINDS = ['coveredBy', 'failsAt', 'observedCalls'] as const;
export type CodeGraphEvidenceEdgeKind = (typeof CODE_GRAPH_EVIDENCE_EDGE_KINDS)[number];

export type CodeGraphEvidenceRun = {
  id: string;
  workspaceId: string;
  projectId: string;
  projectName: string;
  revisionId: string;
  kind: CodeGraphEvidenceKind;
  label: string;
  sourcePath: string;
  stats: {
    coveredSymbols: number;
    failures: number;
    observedCalls: number;
    runtimeOnlyCalls: number;
    unmatchedLocations: number;
  };
  importedAt: string;
};

export type CodeGraphEvidenceEdge = {
  id: string;
  runId: string;
  sourceSymbolId: string | null;
  targetSymbolId: string;
  kind: CodeGraphEvidenceEdgeKind;
  count: number;
  confidence: number;
  metadata: {
    runtimeOnly?: boolean;
    path?: string;
    line?: number;
  };
};

export type CodeGraphRuntimeEvidenceSnapshot = {
  generatedAt: string;
  runs: CodeGraphEvidenceRun[];
  counts: {
    runs: number;
    coveredSymbols: number;
    failures: number;
    observedCalls: number;
    runtimeOnlyCalls: number;
  };
  graph: CodeGraphSubgraph;
  truncated: boolean;
};

export type CodeGraphEvidenceImportOptions = {
  projectId: string;
  path: string;
  kind?: 'auto' | CodeGraphEvidenceKind;
  label?: string;
};

export const CODE_GRAPH_CONTEXT_PURPOSES = ['investigate', 'implement', 'review', 'test'] as const;
export type CodeGraphContextPurpose = (typeof CODE_GRAPH_CONTEXT_PURPOSES)[number];

export type CodeGraphContextSelection = {
  symbolIds?: string[];
  scopeId?: string;
  findingId?: string;
};

export type CodeGraphSourceExcerpt = {
  symbolId: string;
  projectId: string;
  path: string;
  startLine: number;
  endLine: number;
  language: CodeGraphLanguage | null;
  content: string;
  redacted: boolean;
};

export type CodeGraphRelationshipExplanation = {
  edge: CodeGraphEdge;
  source: CodeGraphSymbol;
  target: CodeGraphSymbol;
  classification: 'static' | 'inferred' | 'runtime';
  provenance: {
    path: string | null;
    line: number | null;
    column: number | null;
    confidence: number;
    runtimeOnly: boolean;
  };
  summary: string;
};

export type CodeGraphContextPackage = {
  id: string;
  workspaceId: string;
  purpose: CodeGraphContextPurpose;
  generatedAt: string;
  revisionIds: string[];
  selectedSymbolIds: string[];
  symbols: CodeGraphSymbol[];
  relationships: CodeGraphRelationshipExplanation[];
  excerpts: CodeGraphSourceExcerpt[];
  likelyTests: string[];
  findings: CodeGraphFinding[];
  estimatedTokens: number;
  maxTokens: number;
  truncated: boolean;
  omitted: { symbols: number; relationships: number; excerpts: number };
  markdown: string;
};

export type CodeGraphContextOptions = {
  selection: CodeGraphContextSelection;
  purpose: CodeGraphContextPurpose;
  maxTokens?: number;
  depth?: number;
  includeSource?: boolean;
};

export type CodeGraphInvestigationState = {
  projectId: string | null;
  viewMode: 'overview' | 'changes' | 'contracts' | 'quality' | 'semantic' | 'runtime' | 'operations' | 'compare';
  query: string;
  searchMode: 'lexical' | 'semantic';
  selectedSymbolIds: string[];
  direction: 'incoming' | 'outgoing' | 'both';
  depth: number;
  camera: { x: number; y: number; ratio: number; angle: number } | null;
  openPath: string | null;
};

export type CodeGraphInvestigation = {
  id: string;
  workspaceId: string;
  name: string;
  state: CodeGraphInvestigationState;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type CodeGraphRevisionSummary = {
  id: string;
  workspaceId: string;
  projectId: string;
  projectName: string;
  sequence: number;
  sourceHash: string;
  gitHead: string | null;
  stats: CodeGraphStats;
  completedAt: string;
  current: boolean;
};

export type CodeGraphRevisionSymbol = {
  fingerprint: string;
  name: string;
  qualifiedName: string;
  kind: CodeGraphSymbolKind;
  path: string | null;
  startLine: number | null;
  endLine: number | null;
  contentHash: string;
};

export type CodeGraphRevisionManifestData = {
  version: 1;
  files: Array<{ path: string; contentHash: string }>;
  symbols: CodeGraphRevisionSymbol[];
  relationships: CodeGraphRevisionRelationship[];
};

export type CodeGraphRevisionRelationship = {
  fingerprint: string;
  sourceFingerprint: string;
  targetFingerprint: string;
  kind: CodeGraphEdgeKind;
  sitePath: string | null;
  siteLine: number | null;
  siteColumn: number | null;
  confidence: number;
  contentHash: string;
};

export type CodeGraphRevisionComparison = {
  projectId: string;
  projectName: string;
  from: CodeGraphRevisionSummary;
  to: CodeGraphRevisionSummary;
  added: CodeGraphRevisionSymbol[];
  removed: CodeGraphRevisionSymbol[];
  modified: Array<{ before: CodeGraphRevisionSymbol; after: CodeGraphRevisionSymbol }>;
  unchanged: number;
  relationships: {
    added: CodeGraphRevisionRelationship[];
    removed: CodeGraphRevisionRelationship[];
    modified: Array<{ before: CodeGraphRevisionRelationship; after: CodeGraphRevisionRelationship }>;
    unchanged: number;
  };
  truncated: boolean;
};

export type CodeGraphAgentOverlay = {
  nodeId: string;
  title: string;
  provider: string | null;
  state: string;
  floorId: string | null;
  floorName: string | null;
  task: { id: string; title: string; status: string } | null;
  symbolIds: string[];
  paths: string[];
};

export type CodeGraphAgentConflict = {
  id: string;
  severity: 'warning' | 'error';
  leftNodeId: string;
  rightNodeId: string;
  sharedSymbolIds: string[];
  sharedPaths: string[];
};

export type CodeGraphOperationsSnapshot = {
  generatedAt: string;
  agents: CodeGraphAgentOverlay[];
  conflicts: CodeGraphAgentConflict[];
  graph: CodeGraphSubgraph;
};
