import { createHash } from 'node:crypto';
import type { SemanticIndex } from '../ports/SemanticIndex.js';
import type {
  CodeGraphSemanticMatch,
  CodeGraphSemanticSearchOptions,
  CodeGraphSemanticStatus,
  CodeGraphSymbol,
} from '../../domain/code-graph.js';
import { CODE_GRAPH_SEMANTIC_DIMENSIONS, CODE_GRAPH_SEMANTIC_MODEL } from '../../domain/code-graph.js';
import { codeGraphIntelligenceRepository } from '../../infrastructure/repositories/CodeGraphIntelligenceRepository.js';
import { codeGraphRepository } from '../../infrastructure/repositories/CodeGraphRepository.js';
import { workspaceRepository } from '../../infrastructure/repositories/WorkspaceRepository.js';

const SEMANTIC_GROUPS = [
  ['load', 'fetch', 'read', 'get', 'carregar', 'buscar', 'ler', 'obtener'],
  ['save', 'store', 'write', 'persist', 'salvar', 'gravar', 'persistir', 'guardar'],
  ['delete', 'remove', 'destroy', 'apagar', 'remover', 'eliminar'],
  ['create', 'add', 'insert', 'criar', 'adicionar', 'crear', 'agregar'],
  ['calculate', 'compute', 'total', 'sum', 'amount', 'calcular', 'somar', 'soma', 'importe', 'monto'],
  ['user', 'customer', 'account', 'usuario', 'cliente', 'cuenta'],
  ['order', 'purchase', 'checkout', 'pedido', 'compra'],
  ['auth', 'login', 'session', 'authentication', 'autenticacao', 'autenticacion', 'sessao', 'sesion'],
  ['error', 'failure', 'exception', 'erro', 'falha', 'falla'],
  ['search', 'find', 'query', 'lookup', 'pesquisa', 'procurar', 'consulta', 'buscar'],
  ['settings', 'config', 'configuration', 'configuracao', 'configuracion', 'ajustes'],
  ['test', 'spec', 'coverage', 'teste', 'prueba', 'cobertura'],
] as const;
const SEMANTIC_CANONICAL = new Map<string, string>(SEMANTIC_GROUPS.flatMap((group) => group.map((token) => [token, group[0]])));

type SemanticSyncState = {
  inFlight: Map<string, Promise<CodeGraphSemanticStatus>>;
};

function semanticSyncState(): SemanticSyncState {
  const global = globalThis as typeof globalThis & { __orkestraiCodeGraphSemanticSyncState?: SemanticSyncState };
  global.__orkestraiCodeGraphSemanticSyncState ??= { inFlight: new Map() };
  return global.__orkestraiCodeGraphSemanticSyncState;
}

function normalized(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function hashFeature(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function addFeature(vector: Float32Array, feature: string, weight: number): void {
  const hash = hashFeature(feature);
  const index = hash % vector.length;
  vector[index] += (hash & 0x80000000) === 0 ? weight : -weight;
}

function embed(parts: Array<{ value: string | null; weight: number }>): Int8Array {
  const vector = new Float32Array(CODE_GRAPH_SEMANTIC_DIMENSIONS);
  for (const part of parts) {
    const value = normalized(part.value ?? '');
    if (!value) continue;
    const tokens = value.split(/\s+/).slice(0, 180);
    for (const token of tokens) {
      addFeature(vector, `t:${token}`, part.weight);
      const canonical = SEMANTIC_CANONICAL.get(token);
      if (canonical) addFeature(vector, `s:${canonical}`, part.weight * 1.3);
      addFeature(vector, `p:${token.slice(0, 4)}`, part.weight * 0.45);
      const padded = `^${token}$`;
      for (let index = 0; index <= padded.length - 3; index += 1) {
        addFeature(vector, `g:${padded.slice(index, index + 3)}`, part.weight * 0.3);
      }
    }
    for (let index = 0; index < tokens.length - 1; index += 1) {
      addFeature(vector, `b:${tokens[index]}:${tokens[index + 1]}`, part.weight * 0.65);
    }
  }
  let norm = 0;
  for (const value of vector) norm += value * value;
  norm = Math.sqrt(norm) || 1;
  return Int8Array.from(vector, (value) => Math.max(-127, Math.min(127, Math.round((value / norm) * 127))));
}

function symbolParts(symbol: CodeGraphSymbol, neighbors: string): Array<{ value: string | null; weight: number }> {
  return [
    { value: symbol.name, weight: 3.2 },
    { value: symbol.qualifiedName, weight: 2.4 },
    { value: symbol.path, weight: 1.8 },
    { value: symbol.signature, weight: 1.5 },
    { value: symbol.documentation?.slice(0, 1_500) ?? null, weight: 1.2 },
    { value: `${symbol.kind} ${symbol.modifiers.join(' ')}`, weight: 0.8 },
    { value: neighbors, weight: 0.55 },
  ];
}

function cosine(left: Int8Array, right: Int8Array): number {
  if (left.length !== right.length || !left.length) return 0;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] * left[index];
    rightNorm += right[index] * right[index];
  }
  return leftNorm && rightNorm ? dot / Math.sqrt(leftNorm * rightNorm) : 0;
}

function contentHash(symbol: CodeGraphSymbol, neighbors: string): string {
  return createHash('sha256').update(JSON.stringify(symbolParts(symbol, neighbors))).digest('hex');
}

export class CodeGraphSemanticService implements SemanticIndex {
  private syncState = semanticSyncState();

  async status(workspaceId: string): Promise<CodeGraphSemanticStatus> {
    await this.assertWorkspace(workspaceId);
    const status = await codeGraphIntelligenceRepository.semanticStatus(workspaceId, CODE_GRAPH_SEMANTIC_MODEL);
    return { ...status, model: CODE_GRAPH_SEMANTIC_MODEL, dimensions: CODE_GRAPH_SEMANTIC_DIMENSIONS };
  }

  async ensureFresh(workspaceId: string): Promise<CodeGraphSemanticStatus> {
    const workspace = await this.assertWorkspace(workspaceId);
    let latest = await this.status(workspaceId);
    if (workspace.codeIntelligenceMode !== 'assisted' || latest.state === 'ready' || latest.totalSymbols === 0) {
      return latest;
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
    return this.synchronize(workspaceId, true);
  }

  private async synchronize(workspaceId: string, force: boolean): Promise<CodeGraphSemanticStatus> {
    const active = this.syncState.inFlight.get(workspaceId);
    if (active) return active;
    const pending = this.performSync(workspaceId, force);
    this.syncState.inFlight.set(workspaceId, pending);
    try {
      return await pending;
    } finally {
      if (this.syncState.inFlight.get(workspaceId) === pending) this.syncState.inFlight.delete(workspaceId);
    }
  }

  private async performSync(workspaceId: string, force: boolean): Promise<CodeGraphSemanticStatus> {
    const graph = await codeGraphRepository.analysisGraph(workspaceId, 40_000, 180_000);
    if (graph.truncated) throw new Error('The semantic index exceeds the safe 40,000-symbol graph limit. Narrow the registered repositories first.');
    if (!graph.nodes.length) {
      await codeGraphIntelligenceRepository.clearEmbeddings(workspaceId, CODE_GRAPH_SEMANTIC_MODEL);
      return this.status(workspaceId);
    }
    const names = new Map(graph.nodes.map((symbol) => [symbol.id, symbol.name]));
    const neighborNames = new Map<string, string[]>();
    for (const edge of graph.edges) {
      const source = neighborNames.get(edge.sourceSymbolId) ?? [];
      const target = names.get(edge.targetSymbolId);
      if (target && source.length < 8) source.push(`${edge.kind} ${target}`);
      neighborNames.set(edge.sourceSymbolId, source);
      const incoming = neighborNames.get(edge.targetSymbolId) ?? [];
      const sourceName = names.get(edge.sourceSymbolId);
      if (sourceName && incoming.length < 8) incoming.push(`${edge.kind} ${sourceName}`);
      neighborNames.set(edge.targetSymbolId, incoming);
    }
    const existing = new Map(
      (await codeGraphIntelligenceRepository.embeddingStates(workspaceId, CODE_GRAPH_SEMANTIC_MODEL))
        .map((entry) => [entry.symbolId, entry]),
    );
    const changedRows = graph.nodes.flatMap((symbol) => {
      const neighbors = (neighborNames.get(symbol.id) ?? []).join(' ');
      const nextContentHash = contentHash(symbol, neighbors);
      const current = existing.get(symbol.id);
      if (!force && current?.contentHash === nextContentHash && current.dimensions === CODE_GRAPH_SEMANTIC_DIMENSIONS) {
        return [];
      }
      return [{
        workspaceId,
        projectId: symbol.projectId,
        revisionId: symbol.revisionId,
        symbolId: symbol.id,
        model: CODE_GRAPH_SEMANTIC_MODEL,
        dimensions: CODE_GRAPH_SEMANTIC_DIMENSIONS,
        vector: embed(symbolParts(symbol, neighbors)),
        contentHash: nextContentHash,
      }];
    });
    await codeGraphIntelligenceRepository.syncEmbeddings(workspaceId, CODE_GRAPH_SEMANTIC_MODEL, changedRows);
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
      ? await this.ensureFresh(workspaceId)
      : await this.status(workspaceId);
    if (status.state !== 'ready') throw new Error('Build the semantic index before using intent search.');
    const requestedKinds = options.kinds ? new Set(options.kinds) : null;
    const entries = await codeGraphIntelligenceRepository.embeddingEntries(workspaceId, CODE_GRAPH_SEMANTIC_MODEL, options.projectId);
    const query = normalized(options.query);
    const queryVector = embed([{ value: query, weight: 1 }]);
    const limit = Math.min(Math.max(options.limit ?? 30, 1), 100);
    return entries
      .filter(({ symbol }) => !requestedKinds || requestedKinds.has(symbol.kind))
      .map(({ symbol, vector }) => {
        const name = normalized(symbol.name);
        const path = normalized(symbol.path ?? '');
        const documentation = normalized(symbol.documentation ?? '');
        const reasons: CodeGraphSemanticMatch['reasons'] = ['semantic'];
        let score = Math.max(0, cosine(queryVector, vector));
        if (name === query) { score += 0.35; reasons.push('name'); }
        else if (name.includes(query) || query.includes(name)) { score += 0.18; reasons.push('name'); }
        if (path.includes(query)) { score += 0.1; reasons.push('path'); }
        if (documentation.includes(query)) { score += 0.08; reasons.push('documentation'); }
        if (symbol.exported) score += 0.02;
        return { symbol, score: Math.round(Math.min(score, 1) * 100), reasons };
      })
      .filter((match) => match.score >= 8)
      .sort((left, right) => right.score - left.score || left.symbol.name.localeCompare(right.symbol.name))
      .slice(0, limit);
  }

  private async assertWorkspace(workspaceId: string) {
    const workspace = await workspaceRepository.getWorkspace(workspaceId);
    if (!workspace) throw new Error('Workspace not found.');
    return workspace;
  }
}

export const codeGraphSemanticService = new CodeGraphSemanticService();
