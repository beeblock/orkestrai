import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync, createGunzip } from 'node:zlib';
import { Readable } from 'node:stream';
import { CodeGraphConnection as Connection } from '$lib/database/code-graph-storage.js';
import { uuidv7 } from '@beeblock/svelar/support';
import type { CodeGraphCommit } from '../../application/ports/CodeGraphStore.js';
import type { CodeGraphRevisionManifestData, CodeGraphRevisionSymbol, CodeGraphRevisionRelationship } from '../../domain/code-graph.js';

type Entry = { section: 'symbols'; value: CodeGraphRevisionSymbol } | { section: 'relationships'; value: CodeGraphRevisionRelationship };
type Header = { version: 2; files: CodeGraphRevisionManifestData['files']; chunks: string[] };
const MAGIC = Buffer.from('OG2\0');
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const buffer = (value: unknown): Buffer => Buffer.isBuffer(value) ? value : Buffer.from(value as Uint8Array);

/** Each bounded chunk is addressed by its content, so unchanged history shares bytes. */
export async function encodeRevisionChunks(input: CodeGraphCommit): Promise<Buffer> {
  const paths = new Map(input.files.map(file => [file.key, file.path]));
  const hashes = new Map(input.files.map(file => [file.key, file.contentHash]));
  const fingerprints = new Map(input.symbols.map(symbol => [symbol.key, symbol.fingerprint]));
  const groups = new Map<string, { symbols: typeof input.symbols; edges: typeof input.edges }>();
  const group = (path: string) => {
    let result = groups.get(path);
    if (!result) groups.set(path, result = { symbols: [], edges: [] });
    return result;
  };
  for (const symbol of input.symbols) group(symbol.fileKey ? paths.get(symbol.fileKey) ?? '' : `external:${symbol.fingerprint.slice(0, 2)}`).symbols.push(symbol);
  for (const edge of input.edges) group(edge.siteFileKey ? paths.get(edge.siteFileKey) ?? '' : `external:${edge.fingerprint.slice(0, 2)}`).edges.push(edge);
  const header: Header = { version: 2, files: input.files.map(file => ({ path: file.path, contentHash: file.contentHash })), chunks: [] };
  const known = new Set((await Connection.raw('SELECT content_hash FROM agent_code_graph_manifest_chunks WHERE project_id = ?', [input.projectId])).map((row: any) => String(row.content_hash)));
  const save = async (symbols: CodeGraphRevisionSymbol[], relationships: CodeGraphRevisionRelationship[]) => {
    if (!symbols.length && !relationships.length) return;
    const text = JSON.stringify({ symbols, relationships });
    const hash = digest(text);
    header.chunks.push(hash);
    if (known.has(hash)) return;
    await Connection.raw('INSERT OR IGNORE INTO agent_code_graph_manifest_chunks (id, workspace_id, project_id, content_hash, data) VALUES (?, ?, ?, ?, ?)',
      [uuidv7(), input.workspaceId, input.projectId, hash, gzipSync(text, { level: 1 })]);
    known.add(hash);
  };
  for (const key of [...groups.keys()].sort()) {
    const values = groups.get(key)!;
    values.symbols.sort((a, b) => a.fingerprint.localeCompare(b.fingerprint));
    values.edges.sort((a, b) => a.fingerprint.localeCompare(b.fingerprint));
    for (let offset = 0; offset < values.symbols.length; offset += 256) {
      await save(values.symbols.slice(offset, offset + 256).map(symbol => ({
        fingerprint: symbol.fingerprint, name: symbol.name, qualifiedName: symbol.qualifiedName,
        kind: symbol.kind, path: symbol.fileKey ? paths.get(symbol.fileKey) ?? null : null,
        startLine: symbol.startLine, endLine: symbol.endLine,
        contentHash: digest(JSON.stringify({ file: symbol.fileKey ? hashes.get(symbol.fileKey) ?? null : null,
          signature: symbol.signature, documentation: symbol.documentation, modifiers: symbol.modifiers, metadata: symbol.metadata })),
      })), []);
    }
    for (let offset = 0; offset < values.edges.length; offset += 256) {
      await save([], values.edges.slice(offset, offset + 256).flatMap(edge => {
        const sourceFingerprint = fingerprints.get(edge.sourceKey);
        const targetFingerprint = fingerprints.get(edge.targetKey);
        return sourceFingerprint && targetFingerprint ? [{ fingerprint: edge.fingerprint, sourceFingerprint, targetFingerprint,
          kind: edge.kind, sitePath: edge.siteFileKey ? paths.get(edge.siteFileKey) ?? null : null,
          siteLine: edge.siteLine, siteColumn: edge.siteColumn, confidence: edge.confidence,
          contentHash: digest(JSON.stringify({ confidence: edge.confidence, metadata: edge.metadata })) }] : [];
      }));
    }
  }
  return Buffer.concat([MAGIC, gzipSync(JSON.stringify(header), { level: 1 })]);
}

export function revisionChunkHeader(value: unknown): Header | null {
  try {
    const compressed = buffer(value);
    if (!compressed.subarray(0, MAGIC.length).equals(MAGIC) || compressed.length > 16 * 1024 * 1024) return null;
    const header = JSON.parse(gunzipSync(compressed.subarray(MAGIC.length), { maxOutputLength: 32 * 1024 * 1024 }).toString('utf8'));
    return header.version === 2 && Array.isArray(header.chunks) && header.chunks.every((hash: unknown) => typeof hash === 'string' && /^[a-f0-9]{64}$/.test(hash)) ? header : null;
  } catch { return null; }
}

/** Reads our legacy JSON arrays incrementally, including historical graphs larger than 128 MB. */
async function* legacyEntries(compressed: Buffer): AsyncGenerator<Entry> {
  const stream = Readable.from([compressed]).pipe(createGunzip()).setEncoding('utf8');
  let depth = 0, quoted = false, escaped = false, key = '', token = '', item = '', collecting = false;
  let bytes = 0;
  try {
    for await (const part of stream) {
      bytes += Buffer.byteLength(part);
      if (bytes > 1024 ** 3) throw new Error('Historical graph exceeds the supported 1 GB manifest size.');
      for (const character of part as string) {
        if (collecting) {
          item += character;
          if (item.length > 16 * 1024 * 1024) throw new Error('Historical graph entry exceeds 16 MB.');
        }
        if (quoted) {
          if (depth === 1) token += character;
          if (escaped) escaped = false;
          else if (character === '\\') escaped = true;
          else if (character === '"') {
            quoted = false;
            if (depth === 1) { key = JSON.parse('"' + token); token = ''; }
          }
          continue;
        }
        if (character === '"') { quoted = true; token = ''; continue; }
        if (character === '{' || character === '[') {
          if (depth === 2 && character === '{' && (key === 'symbols' || key === 'relationships')) { collecting = true; item = '{'; }
          depth++;
        } else if (character === '}' || character === ']') {
          depth--;
          if (collecting && depth === 2) {
            collecting = false;
            yield { section: key, value: JSON.parse(item) } as Entry;
            item = '';
          }
        }
      }
    }
    if (depth !== 0 || quoted || collecting) throw new Error('Historical graph manifest is incomplete.');
  } finally { stream.destroy(); }
}

export async function* revisionEntries(workspaceId: string, projectId: string, value: unknown): AsyncGenerator<Entry> {
  const header = revisionChunkHeader(value);
  if (!header) { yield* legacyEntries(buffer(value)); return; }
  for (const hash of header.chunks) {
    const rows = await Connection.raw('SELECT data FROM agent_code_graph_manifest_chunks WHERE workspace_id = ? AND project_id = ? AND content_hash = ?', [workspaceId, projectId, hash]);
    if (!rows[0]) throw new Error('A historical graph chunk is missing.');
    const text = gunzipSync(buffer(rows[0].data), { maxOutputLength: 32 * 1024 * 1024 }).toString('utf8');
    if (digest(text) !== hash) throw new Error('A historical graph chunk failed integrity verification.');
    const chunk = JSON.parse(text);
    for (const symbol of chunk.symbols) yield { section: 'symbols', value: symbol };
    for (const relationship of chunk.relationships) yield { section: 'relationships', value: relationship };
  }
}

export async function pruneRevisionChunks(projectId: string): Promise<void> {
  const manifests = await Connection.raw('SELECT manifest FROM agent_code_graph_revision_manifests WHERE project_id = ? AND format = 2', [projectId]);
  const retained = new Set<string>();
  for (const row of manifests) {
    const header = revisionChunkHeader(row.manifest);
    if (!header) throw new Error('Historical graph cleanup stopped because a retained manifest could not be verified.');
    for (const hash of header.chunks) retained.add(hash);
  }
  const stored = await Connection.raw('SELECT id, content_hash FROM agent_code_graph_manifest_chunks WHERE project_id = ?', [projectId]);
  const expired = stored.filter((row: any) => !retained.has(String(row.content_hash))).map((row: any) => row.id);
  for (let offset = 0; offset < expired.length; offset += 500) {
    const batch = expired.slice(offset, offset + 500);
    await Connection.raw(`DELETE FROM agent_code_graph_manifest_chunks WHERE id IN (${batch.map(() => '?').join(',')})`, batch);
  }
}
