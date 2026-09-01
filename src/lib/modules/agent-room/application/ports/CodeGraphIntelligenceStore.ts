import type {
  CodeGraphEvidenceEdge,
  CodeGraphEvidenceRun,
  CodeGraphSemanticState,
  CodeGraphSymbol,
} from '../../domain/code-graph.js';

export type CodeGraphEmbeddingWrite = {
  workspaceId: string;
  projectId: string;
  revisionId: string;
  symbolId: string;
  model: string;
  dimensions: number;
  vector: Int8Array;
  contentHash: string;
};

export type CodeGraphEmbeddingEntry = {
  symbol: CodeGraphSymbol;
  vector: Int8Array;
};

export type CodeGraphSemanticStoreStatus = {
  state: CodeGraphSemanticState;
  indexedSymbols: number;
  totalSymbols: number;
  builtAt: string | null;
};

export type CodeGraphEvidenceRunWrite = Omit<CodeGraphEvidenceRun, 'projectName'> & {
  contentHash: string;
};

export interface CodeGraphIntelligenceStore {
  semanticStatus(workspaceId: string, model: string): Promise<CodeGraphSemanticStoreStatus>;
  replaceEmbeddings(workspaceId: string, model: string, rows: CodeGraphEmbeddingWrite[]): Promise<void>;
  clearEmbeddings(workspaceId: string, model: string): Promise<void>;
  embeddingEntries(workspaceId: string, model: string, projectId?: string): Promise<CodeGraphEmbeddingEntry[]>;
  replaceEvidenceRun(run: CodeGraphEvidenceRunWrite, edges: CodeGraphEvidenceEdge[]): Promise<CodeGraphEvidenceRun>;
  evidenceRuns(workspaceId: string, limit?: number): Promise<CodeGraphEvidenceRun[]>;
  evidenceEdges(workspaceId: string, runIds: string[], limit?: number): Promise<CodeGraphEvidenceEdge[]>;
}
