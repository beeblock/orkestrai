import type {
  CodeGraphDiagnostic,
  CodeGraphEdgeKind,
  CodeGraphIndexOptions,
  CodeGraphProject,
  CodeGraphSearchOptions,
  CodeGraphSnapshot,
  CodeGraphStats,
  CodeGraphSubgraph,
  CodeGraphSymbol,
  CodeGraphSymbolKind,
  CodeGraphTraversalOptions,
  CodeGraphLanguage,
  CodeGraphEdge,
  CodeGraphRevisionManifestData,
  CodeGraphRevisionSummary,
} from '../../domain/code-graph.js';

export type CodeGraphProjectRoot = {
  name: string;
  rootPath: string;
  relativePath: string | null;
  configHash: string;
};

export type CodeGraphRevisionHandle = {
  id: string;
  projectId: string;
  sequence: number;
};

export type CodeGraphWriteFile = {
  key: string;
  path: string;
  language: CodeGraphLanguage;
  contentHash: string;
  byteSize: number;
  generated: boolean;
  symbolCount: number;
  edgeCount: number;
  modifiedAt: string;
};

export type CodeGraphWriteSymbol = {
  key: string;
  fileKey: string | null;
  parentKey: string | null;
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
  fingerprint: string;
};

export type CodeGraphWriteEdge = {
  sourceKey: string;
  targetKey: string;
  siteFileKey: string | null;
  kind: CodeGraphEdgeKind;
  confidence: number;
  siteLine: number | null;
  siteColumn: number | null;
  metadata: Record<string, unknown>;
  fingerprint: string;
};

export type CodeGraphCommit = {
  workspaceId: string;
  projectId: string;
  revisionId: string;
  sourceHash: string;
  fullReplace: boolean;
  gitHead: string | null;
  stats: CodeGraphStats;
  diagnostics: CodeGraphDiagnostic[];
  files: CodeGraphWriteFile[];
  symbols: CodeGraphWriteSymbol[];
  edges: CodeGraphWriteEdge[];
};

export interface CodeGraphStore {
  syncProjects(workspaceId: string, roots: CodeGraphProjectRoot[]): Promise<CodeGraphProject[]>;
  listProjects(workspaceId: string): Promise<CodeGraphProject[]>;
  snapshot(workspaceId: string): Promise<CodeGraphSnapshot>;
  currentSourceHash(projectId: string): Promise<string | null>;
  markStale(workspaceId: string, projectId: string): Promise<boolean>;
  beginRevision(workspaceId: string, projectId: string, gitHead: string | null): Promise<CodeGraphRevisionHandle>;
  commitRevision(input: CodeGraphCommit): Promise<CodeGraphProject>;
  failRevision(workspaceId: string, projectId: string, revisionId: string, diagnostics: CodeGraphDiagnostic[]): Promise<void>;
  search(workspaceId: string, options: CodeGraphSearchOptions): Promise<CodeGraphSymbol[]>;
  symbol(workspaceId: string, symbolId: string): Promise<CodeGraphSymbol | null>;
  edge(workspaceId: string, edgeId: string): Promise<CodeGraphEdge | null>;
  symbolAt(workspaceId: string, projectId: string, path: string, line: number): Promise<CodeGraphSymbol | null>;
  symbols(workspaceId: string, symbolIds: string[]): Promise<CodeGraphSymbol[]>;
  symbolsForPaths(workspaceId: string, projectId: string, paths: string[], limit?: number): Promise<CodeGraphSymbol[]>;
  contractGraph(workspaceId: string, limit?: number): Promise<CodeGraphSubgraph>;
  analysisGraph(workspaceId: string, nodeLimit?: number, edgeLimit?: number): Promise<CodeGraphSubgraph>;
  overview(workspaceId: string, projectId?: string, limit?: number): Promise<CodeGraphSubgraph>;
  subgraph(workspaceId: string, options: CodeGraphTraversalOptions): Promise<CodeGraphSubgraph>;
  impact(workspaceId: string, symbolIds: string[], depth?: number, limit?: number): Promise<CodeGraphSubgraph>;
  revisionSummaries(workspaceId: string, projectId?: string, limit?: number): Promise<CodeGraphRevisionSummary[]>;
  revisionManifest(workspaceId: string, revisionId: string): Promise<CodeGraphRevisionManifestData | null>;
  deleteWorkspace(workspaceId: string): Promise<void>;
}

export type CodeGraphIndexCommand = {
  workspaceId: string;
  options: CodeGraphIndexOptions;
};
