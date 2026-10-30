import { gzipSync, gunzipSync } from 'node:zlib';
import { CODE_GRAPH_SEMANTIC_DIMENSIONS, type CodeGraphSymbol } from '../../domain/code-graph.js';

const LIMIT = 128 * 1024 ** 2;
const MAGIC = Buffer.from('OGS1');
export type SemanticCandidate = {
  id: string; projectId: string; kind: CodeGraphSymbol['kind']; name: string;
  normalizedName: string; path: string; documentation: string; exported: boolean; norm: number;
};
export type SemanticSearchCache = { entries: SemanticCandidate[]; vectors: Int8Array };
export function normalizeSemanticText(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/** A derived, bounded accelerator. The SQLite embeddings remain authoritative. */
export class SemanticCacheBuilder {
  private entries: SemanticCandidate[] = [];
  private vectors: Buffer[] = [];
  private bytes = 0;
  private overflow = false;
  add(symbol: CodeGraphSymbol, vector: Int8Array): void {
    if (this.overflow) return;
    const entry: SemanticCandidate = { id: symbol.id, projectId: symbol.projectId, kind: symbol.kind, name: symbol.name,
      normalizedName: normalizeSemanticText(symbol.name), path: normalizeSemanticText(symbol.path ?? ''),
      documentation: normalizeSemanticText(symbol.documentation ?? ''), exported: symbol.exported,
      norm: vector.reduce((sum, value) => sum + value * value, 0) };
    this.bytes += Buffer.byteLength(JSON.stringify(entry)) + vector.length + 1;
    if (this.bytes > LIMIT - 1024) { this.overflow = true; this.entries = []; this.vectors = []; return; }
    this.entries.push(entry);
    this.vectors.push(Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength));
  }
  encode(revisionKey: string): Buffer | null {
    if (this.overflow || !this.entries.length) return null;
    const header = Buffer.from(JSON.stringify({ version: 1, revisionKey, entries: this.entries }));
    const prefix = Buffer.alloc(8);
    MAGIC.copy(prefix); prefix.writeUInt32LE(header.length, 4);
    const data = Buffer.concat([prefix, header, ...this.vectors]);
    return data.length <= LIMIT ? gzipSync(data, { level: 1 }) : null;
  }
}

export function decodeSemanticCache(value: Uint8Array, revisionKey: string): SemanticSearchCache | null {
  try {
    const data = gunzipSync(value, { maxOutputLength: LIMIT });
    if (!data.subarray(0, 4).equals(MAGIC)) return null;
    const length = data.readUInt32LE(4);
    if (length > data.length - 8) return null;
    const header = JSON.parse(data.toString('utf8', 8, 8 + length));
    if (header.version !== 1 || header.revisionKey !== revisionKey || !Array.isArray(header.entries)
      || data.length - 8 - length !== header.entries.length * CODE_GRAPH_SEMANTIC_DIMENSIONS) return null;
    if (!header.entries.every((entry: SemanticCandidate) => typeof entry.id === 'string' && typeof entry.projectId === 'string'
      && typeof entry.name === 'string' && typeof entry.normalizedName === 'string' && typeof entry.path === 'string'
      && typeof entry.documentation === 'string' && Number.isFinite(entry.norm) && entry.norm >= 0)) return null;
    return { entries: header.entries, vectors: new Int8Array(data.buffer, data.byteOffset + 8 + length, data.length - 8 - length) };
  } catch { return null; }
}
