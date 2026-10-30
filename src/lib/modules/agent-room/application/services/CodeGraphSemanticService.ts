import { buildSemanticGraph, searchSemanticGraph } from '../../infrastructure/code-graph/CodeGraphSemanticEngine.js';
import { codeGraphConnectionName, runCodeGraphOperation } from '$lib/database/code-graph-storage.js';
import type { SemanticIndex } from '../ports/SemanticIndex.js';
import type {
  CodeGraphSemanticMatch,
  CodeGraphSemanticSearchOptions,
  CodeGraphSemanticStatus,
} from '../../domain/code-graph.js';
import { CODE_GRAPH_SEMANTIC_DIMENSIONS, CODE_GRAPH_SEMANTIC_MODEL } from '../../domain/code-graph.js';
import { codeGraphIntelligenceRepository } from '../../infrastructure/repositories/CodeGraphIntelligenceRepository.js';
import { workspaceRepository } from '../../infrastructure/repositories/WorkspaceRepository.js';

type SemanticSyncState = { inFlight: Map<string, Promise<CodeGraphSemanticStatus>>; failures: Map<string, number>; retryAt: Map<string, number> };
function semanticSyncState(): SemanticSyncState {
  const global = globalThis as typeof globalThis & { __orkestraiCodeGraphSemanticSyncState?: SemanticSyncState };
  const state = global.__orkestraiCodeGraphSemanticSyncState ??= { inFlight: new Map(), failures: new Map(), retryAt: new Map() };
  state.failures ??= new Map(); state.retryAt ??= new Map();
  return state;
}

export class CodeGraphSemanticPreparingError extends Error {
  readonly code = 'semantic_preparing';
  readonly status = 425;
  constructor() { super('The semantic index is preparing in the background. Use code_graph_search / orkestrai graph search now; do not wait or rebuild it repeatedly.'); }
}

export class CodeGraphSemanticService implements SemanticIndex {
  private syncState = semanticSyncState();

  async status(workspaceId: string): Promise<CodeGraphSemanticStatus> {
    await this.assertWorkspace(workspaceId);
    const status = await codeGraphIntelligenceRepository.semanticStatus(workspaceId, CODE_GRAPH_SEMANTIC_MODEL);
    return { ...status, model: CODE_GRAPH_SEMANTIC_MODEL, dimensions: CODE_GRAPH_SEMANTIC_DIMENSIONS, refreshing: this.syncState.inFlight.has(workspaceId) };
  }

  async ensureFresh(workspaceId: string, wait = true): Promise<CodeGraphSemanticStatus> {
    const workspace = await this.assertWorkspace(workspaceId);
    let latest = await this.status(workspaceId);
    if (workspace.codeIntelligenceMode !== 'assisted' || latest.state === 'ready' || latest.totalSymbols === 0) {
      return latest;
    }
    if ((this.syncState.retryAt.get(workspaceId) ?? 0) > Date.now()) return latest;
    if (!wait) {
      if (!this.syncState.inFlight.has(workspaceId)) void this.synchronize(workspaceId, false).catch(error => {
        console.warn(`[code-graph] Semantic refresh failed for ${workspaceId}: ${error instanceof Error ? error.message.slice(0, 240) : 'Unknown error'}`);
      });
      return { ...latest, refreshing: true };
    }
    for (let attempt = 0; attempt < 3 && latest.state !== 'ready'; attempt += 1) {
      const active = this.syncState.inFlight.get(workspaceId);
      latest = active ? await active : await this.synchronize(workspaceId, false);
      latest = await this.status(workspaceId);
    }
    return latest;
  }

  async build(workspaceId: string): Promise<CodeGraphSemanticStatus> {
    await this.assertWorkspace(workspaceId);
    const active = this.syncState.inFlight.get(workspaceId);
    if (active) await active;
    await this.synchronize(workspaceId, true);
    return this.status(workspaceId);
  }

  private async synchronize(workspaceId: string, force: boolean): Promise<CodeGraphSemanticStatus> {
    const active = this.syncState.inFlight.get(workspaceId);
    if (active) return active;
    const pending = this.performSync(workspaceId, force);
    this.syncState.inFlight.set(workspaceId, pending);
    try {
      const result = await pending;
      this.syncState.failures.delete(workspaceId);
      this.syncState.retryAt.delete(workspaceId);
      return result;
    } catch (error) {
      const failures = (this.syncState.failures.get(workspaceId) ?? 0) + 1;
      this.syncState.failures.set(workspaceId, failures);
      this.syncState.retryAt.set(workspaceId, Date.now() + Math.min(300_000, 30_000 * 2 ** Math.min(failures - 1, 4)));
      throw error;
    } finally {
      if (this.syncState.inFlight.get(workspaceId) === pending) this.syncState.inFlight.delete(workspaceId);
      (globalThis as any).__orkestraiBroadcast?.({ type: 'codeGraphChanged', workspaceId });
    }
  }

  private async performSync(workspaceId: string, force: boolean): Promise<CodeGraphSemanticStatus> {
    if (codeGraphConnectionName()) await runCodeGraphOperation('semantic-build', [workspaceId, force]);
    else await buildSemanticGraph(workspaceId, force);
    return this.status(workspaceId);
  }

  async clear(workspaceId: string): Promise<CodeGraphSemanticStatus> {
    await this.assertWorkspace(workspaceId);
    const active = this.syncState.inFlight.get(workspaceId);
    if (active) await active;
    await codeGraphIntelligenceRepository.clearEmbeddings(workspaceId, CODE_GRAPH_SEMANTIC_MODEL);
    return this.status(workspaceId);
  }

  async search(workspaceId: string, options: CodeGraphSemanticSearchOptions): Promise<CodeGraphSemanticMatch[]> {
    const workspace = await this.assertWorkspace(workspaceId);
    const status = workspace.codeIntelligenceMode === 'assisted'
      ? await this.ensureFresh(workspaceId, false)
      : await this.status(workspaceId);
    if (status.state !== 'ready' && workspace.codeIntelligenceMode === 'assisted') throw new CodeGraphSemanticPreparingError();
    if (status.state !== 'ready') throw new Error('Build the semantic index before using intent search.');
    try {
      return codeGraphConnectionName()
        ? await runCodeGraphOperation('semantic-search', [workspaceId, options], true)
        : await searchSemanticGraph(workspaceId, options);
    } catch (error) {
      if ((error as { code?: string }).code === 'semantic_preparing' && workspace.codeIntelligenceMode === 'assisted') {
        await this.ensureFresh(workspaceId, false);
        throw new CodeGraphSemanticPreparingError();
      }
      throw error;
    }
  }

  private async assertWorkspace(workspaceId: string) {
    const workspace = await workspaceRepository.getWorkspace(workspaceId);
    if (!workspace) throw new Error('Workspace not found.');
    return workspace;
  }
}

export const codeGraphSemanticService = new CodeGraphSemanticService();
