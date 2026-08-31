export const CODE_GRAPH_LANGUAGES = ['typescript', 'javascript', 'svelte', 'php', 'json', 'yaml'] as const;
export type CodeGraphLanguage = (typeof CODE_GRAPH_LANGUAGES)[number];

export const CODE_GRAPH_SYMBOL_KINDS = [
  'module', 'namespace', 'class', 'interface', 'type', 'enum', 'function',
  'method', 'variable', 'endpoint', 'apiRequest', 'schema', 'gateway', 'resource', 'external',
] as const;
export type CodeGraphSymbolKind = (typeof CODE_GRAPH_SYMBOL_KINDS)[number];

export const CODE_GRAPH_EDGE_KINDS = [
  'contains', 'defines', 'imports', 'exports', 'calls', 'references',
  'instantiates', 'inherits', 'implements', 'handles', 'requests', 'matches',
  'validates', 'generatedFrom', 'routesTo', 'reads', 'writes', 'queries',
  'usesEnv', 'sends', 'receives',
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
  kind: 'review' | 'task';
  scopeId: string;
  title: string;
  locale: 'pt-BR' | 'en' | 'es';
};

export type CodeGraphHandoffResult = {
  kind: CodeGraphHandoffOptions['kind'];
  scopeId: string;
  artifact: {
    id: string;
    title: string;
    status: string;
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
