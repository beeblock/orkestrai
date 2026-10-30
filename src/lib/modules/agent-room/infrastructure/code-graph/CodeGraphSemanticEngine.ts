import { SemanticCacheBuilder, decodeSemanticCache, normalizeSemanticText as normalized, type SemanticSearchCache } from './CodeGraphSemanticCache.js';
import { codeGraphRepository } from '../repositories/CodeGraphRepository.js';
import { createHash } from 'node:crypto';
import { CODE_GRAPH_SEMANTIC_MODEL, CODE_GRAPH_SEMANTIC_DIMENSIONS, type CodeGraphSymbol, type CodeGraphSemanticSearchOptions, type CodeGraphSemanticMatch } from '../../domain/code-graph.js';
import { codeGraphIntelligenceRepository } from '../repositories/CodeGraphIntelligenceRepository.js';
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

function cosine(left: Int8Array, right: Int8Array, leftNorm: number): number {
  if (left.length !== right.length || !left.length) return 0;
  let dot = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    rightNorm += right[index] * right[index];
  }
  return leftNorm && rightNorm ? dot / Math.sqrt(leftNorm * rightNorm) : 0;
}

function contentHash(symbol: CodeGraphSymbol, neighbors: string): string {
  return createHash('sha256').update(JSON.stringify(symbolParts(symbol, neighbors))).digest('hex');
}

export async function buildSemanticGraph(workspaceId: string, force: boolean) {
  let afterId = '';
  let total = 0;
  const revision = await codeGraphIntelligenceRepository.semanticRevision(workspaceId);
  const cache = new SemanticCacheBuilder();
  for (;;) {
    const page = await codeGraphIntelligenceRepository.semanticSymbolsPage(workspaceId, afterId);
    if (!page.length) break;
    total += page.length;
    const existing = new Map((await codeGraphIntelligenceRepository.embeddingStates(workspaceId, CODE_GRAPH_SEMANTIC_MODEL, page.map(entry => entry.symbol.id))).map(entry => [entry.symbolId, entry]));
    const changed = page.flatMap(({ symbol, neighbors }) => {
      const nextContentHash = contentHash(symbol, neighbors);
      const current = existing.get(symbol.id);
      const reuse = !force && current?.contentHash === nextContentHash && current.dimensions === CODE_GRAPH_SEMANTIC_DIMENSIONS;
      const vector = reuse ? current.vector : embed(symbolParts(symbol, neighbors));
      cache.add(symbol, vector);
      if (reuse) return [];
      return [{ workspaceId, projectId: symbol.projectId, revisionId: symbol.revisionId, symbolId: symbol.id,
        model: CODE_GRAPH_SEMANTIC_MODEL, dimensions: CODE_GRAPH_SEMANTIC_DIMENSIONS,
        vector, contentHash: nextContentHash }];
    });
    await codeGraphIntelligenceRepository.syncEmbeddings(workspaceId, CODE_GRAPH_SEMANTIC_MODEL, changed, false);
    afterId = page.at(-1)!.symbol.id;
  }
  if (total) await codeGraphIntelligenceRepository.syncEmbeddings(workspaceId, CODE_GRAPH_SEMANTIC_MODEL, [], true, { revisionKey: revision.key, data: cache.encode(revision.key) });
  else await codeGraphIntelligenceRepository.clearEmbeddings(workspaceId, CODE_GRAPH_SEMANTIC_MODEL);
  return codeGraphIntelligenceRepository.semanticStatus(workspaceId, CODE_GRAPH_SEMANTIC_MODEL);
}

// Only the last workspace is retained, and the compressed accelerator has a
// 128 MiB decoded limit. The analysis worker also exits after 30 seconds idle.
let cachedSearch: { key: string; data: SemanticSearchCache } | null = null;
async function searchCache(workspaceId: string): Promise<SemanticSearchCache | null> {
  const marker = await codeGraphIntelligenceRepository.semanticSearchCache(workspaceId, CODE_GRAPH_SEMANTIC_MODEL);
  const key = `${workspaceId}:${marker?.revision_hash}:${marker?.built_at}`;
  if (cachedSearch?.key === key) return cachedSearch.data;
  cachedSearch = null;
  const stored = await codeGraphIntelligenceRepository.semanticSearchCache(workspaceId, CODE_GRAPH_SEMANTIC_MODEL, true);
  const decoded = stored?.search_data instanceof Uint8Array && stored.revision_hash
    ? decodeSemanticCache(stored.search_data, String(stored.revision_hash)) : null;
  if (decoded) cachedSearch = { key, data: decoded };
  return decoded;
}

export async function searchSemanticGraph(workspaceId: string, options: CodeGraphSemanticSearchOptions): Promise<CodeGraphSemanticMatch[]> {
  const status = await codeGraphIntelligenceRepository.semanticStatus(workspaceId, CODE_GRAPH_SEMANTIC_MODEL);
  if (status.state !== 'ready') throw Object.assign(new Error('The semantic index is preparing; use name search while it refreshes.'), { code: 'semantic_preparing' });
  const requestedKinds = options.kinds ? new Set(options.kinds) : null;
  const query = normalized(options.query);
  const queryVector = embed([{ value: query, weight: 1 }]);
  const queryNorm = queryVector.reduce((sum, value) => sum + value * value, 0);
  const limit = Math.min(Math.max(options.limit ?? 30, 1), 100);
  let afterId = '';
  let best: Array<{ id: string; name: string; score: number; reasons: CodeGraphSemanticMatch['reasons'] }> = [];
  const compare = (a: typeof best[number], b: typeof best[number]) => b.score - a.score || a.name.localeCompare(b.name);
  const keep = (entry: typeof best[number]) => {
    if (best.length >= limit && compare(entry, best[best.length - 1]) >= 0) return;
    best.push(entry); best.sort(compare);
    if (best.length > limit) best.pop();
  };
  const cache = await searchCache(workspaceId);
  const features = Array.from(queryVector, (value, index) => ({ value, index })).filter(feature => feature.value !== 0);
  if (cache) {
    for (let index = 0; index < cache.entries.length; index++) {
      const symbol = cache.entries[index];
      if ((options.projectId && symbol.projectId !== options.projectId) || (requestedKinds && !requestedKinds.has(symbol.kind))) continue;
      let dot = 0;
      const offset = index * CODE_GRAPH_SEMANTIC_DIMENSIONS;
      for (const feature of features) dot += feature.value * cache.vectors[offset + feature.index];
      const similarity = queryNorm && symbol.norm ? dot / Math.sqrt(queryNorm * symbol.norm) : 0;
      const reasons: CodeGraphSemanticMatch['reasons'] = ['semantic'];
      let score = Math.max(0, similarity);
      if (symbol.normalizedName === query) { score += 0.35; reasons.push('name'); }
      else if (symbol.normalizedName.includes(query) || query.includes(symbol.normalizedName)) { score += 0.18; reasons.push('name'); }
      if (symbol.path.includes(query)) { score += 0.1; reasons.push('path'); }
      if (symbol.documentation.includes(query)) { score += 0.08; reasons.push('documentation'); }
      if (symbol.exported) score += 0.02;
      keep({ id: symbol.id, name: symbol.name, score: Math.round(Math.min(score, 1) * 100), reasons });
    }
  } else for (;;) {
    const entries = await codeGraphIntelligenceRepository.embeddingCandidatePage(workspaceId, CODE_GRAPH_SEMANTIC_MODEL, options.projectId, afterId);
    if (!entries.length) break;
    for (const symbol of entries) {
      if (requestedKinds && !requestedKinds.has(symbol.kind)) continue;
      const name = normalized(symbol.name), path = normalized(symbol.path ?? ''), documentation = normalized(symbol.documentation ?? '');
      const reasons: CodeGraphSemanticMatch['reasons'] = ['semantic'];
      let score = Math.max(0, cosine(queryVector, symbol.vector, queryNorm));
      if (name === query) { score += 0.35; reasons.push('name'); }
      else if (name.includes(query) || query.includes(name)) { score += 0.18; reasons.push('name'); }
      if (path.includes(query)) { score += 0.1; reasons.push('path'); }
      if (documentation.includes(query)) { score += 0.08; reasons.push('documentation'); }
      if (symbol.exported) score += 0.02;
      keep({ id: symbol.id, name: symbol.name, score: Math.round(Math.min(score, 1) * 100), reasons });
    }
    afterId = entries.at(-1)!.id;
  }
  const fullSymbols = new Map((await codeGraphRepository.symbols(workspaceId, best.map(entry => entry.id))).map(symbol => [symbol.id, symbol]));
  return best.flatMap(({ id, score, reasons }) => { const symbol = fullSymbols.get(id); return symbol ? [{ symbol, score, reasons }] : []; });
}
