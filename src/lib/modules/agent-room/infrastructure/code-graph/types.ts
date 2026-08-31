import type {
  CodeGraphDiagnostic,
  CodeGraphEdgeKind,
  CodeGraphLanguage,
  CodeGraphSymbolKind,
} from '../../domain/code-graph.js';

export type ParsedCodeSymbol = {
  key: string;
  parentKey: string | null;
  kind: CodeGraphSymbolKind;
  name: string;
  qualifiedName: string;
  signature: string | null;
  documentation: string | null;
  modifiers: string[];
  exported: boolean;
  startLine: number | null;
  startColumn: number | null;
  endLine: number | null;
  endColumn: number | null;
  fingerprint: string;
};

export type ParsedCodeReference = {
  sourceKey: string;
  kind: CodeGraphEdgeKind;
  targetName: string;
  targetQualifiedName?: string | null;
  targetModule?: string | null;
  confidence: number;
  siteLine: number | null;
  siteColumn: number | null;
  metadata: Record<string, unknown>;
};

export type ScannedCodeFile = {
  absolutePath: string;
  relativePath: string;
  language: CodeGraphLanguage;
  content: string;
  contentHash: string;
  byteSize: number;
  modifiedAt: string;
  generated: boolean;
};

export type ParsedCodeFile = Omit<ScannedCodeFile, 'content'> & {
  symbols: ParsedCodeSymbol[];
  references: ParsedCodeReference[];
  diagnostics: CodeGraphDiagnostic[];
};

export type ResolvedCodeEdge = {
  sourceKey: string;
  targetKey: string;
  kind: CodeGraphEdgeKind;
  confidence: number;
  sitePath: string;
  siteLine: number | null;
  siteColumn: number | null;
  metadata: Record<string, unknown>;
  fingerprint: string;
};

export type ResolvedCodeGraph = {
  files: ParsedCodeFile[];
  symbols: ParsedCodeSymbol[];
  edges: ResolvedCodeEdge[];
  diagnostics: CodeGraphDiagnostic[];
};
