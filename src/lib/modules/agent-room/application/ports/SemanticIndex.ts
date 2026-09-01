import type {
  CodeGraphSemanticMatch,
  CodeGraphSemanticSearchOptions,
  CodeGraphSemanticStatus,
} from '../../domain/code-graph.js';

export interface SemanticIndex {
  status(workspaceId: string): Promise<CodeGraphSemanticStatus>;
  build(workspaceId: string): Promise<CodeGraphSemanticStatus>;
  clear(workspaceId: string): Promise<CodeGraphSemanticStatus>;
  search(workspaceId: string, options: CodeGraphSemanticSearchOptions): Promise<CodeGraphSemanticMatch[]>;
}
