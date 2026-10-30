import { gzipSync, gunzipSync } from 'node:zlib';
import { uuidv7 } from '@beeblock/svelar/support';
import { CodeGraphConnection as Connection } from '$lib/database/code-graph-storage.js';
import type { ParsedCodeFile, ScannedCodeFile } from './types.js';

type CacheRow = { id: string; path: string; content_hash: string; config_hash: string; data: Uint8Array };
const MAX_ENTRY_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_BYTES = 128 * 1024 * 1024;

/** Regenerable parser data, bounded across all workspaces; never contains full source bodies. */
export async function loadParseCache(projectId: string, configurationHash: string): Promise<Map<string, CacheRow>> {
  const rows = await Connection.raw('SELECT id, path, content_hash, config_hash, data FROM agent_code_graph_parse_cache WHERE project_id = ? AND config_hash = ?', [projectId, configurationHash]) as CacheRow[];
  return new Map(rows.map(row => [row.path, row]));
}
export function decodeParseCache(row: CacheRow | undefined, source: ScannedCodeFile): ParsedCodeFile | null {
  if (!row || row.content_hash !== source.contentHash) return null;
  try {
    const decoded = JSON.parse(gunzipSync(Buffer.from(row.data), { maxOutputLength: MAX_ENTRY_BYTES }).toString('utf8'));
    const file = decoded.file;
    if (decoded.version !== 1 || !file || file.relativePath !== source.relativePath || file.contentHash !== source.contentHash
      || !Array.isArray(file.symbols) || !Array.isArray(file.references) || !Array.isArray(file.diagnostics)) return null;
    return { ...file, absolutePath: source.absolutePath, modifiedAt: source.modifiedAt };
  } catch { return null; }
}
export function encodeParseCache(file: ParsedCodeFile): Buffer | null {
  const text = JSON.stringify({ version: 1, file });
  return Buffer.byteLength(text) <= MAX_ENTRY_BYTES ? gzipSync(text, { level: 1 }) : null;
}
export async function saveParseCache(workspaceId: string, projectId: string, configurationHash: string, rows: Array<{ path: string; contentHash: string; data: Buffer }>, retainedPaths: Set<string>): Promise<void> {
  const now = new Date().toISOString();
  for (let offset = 0; offset < rows.length; offset += 100) {
    const batch = rows.slice(offset, offset + 100);
    await Connection.transaction(() => Connection.raw(`INSERT INTO agent_code_graph_parse_cache
      (id, workspace_id, project_id, path, content_hash, config_hash, data, saved_at)
      VALUES ${batch.map(() => '(?, ?, ?, ?, ?, ?, ?, ?)').join(',')}
      ON CONFLICT(project_id, path) DO UPDATE SET content_hash = excluded.content_hash,
        config_hash = excluded.config_hash, data = excluded.data, saved_at = excluded.saved_at`,
    batch.flatMap(row => [uuidv7(), workspaceId, projectId, row.path, row.contentHash, configurationHash, row.data, now])));
  }
  const stored = await Connection.raw('SELECT id, path FROM agent_code_graph_parse_cache WHERE project_id = ?', [projectId]);
  const removed = stored.filter((row: any) => !retainedPaths.has(String(row.path))).map((row: any) => row.id);
  const sizes = await Connection.raw('SELECT id, length(data) AS bytes FROM agent_code_graph_parse_cache ORDER BY saved_at, id');
  let bytes = sizes.reduce((sum: number, row: any) => sum + Number(row.bytes), 0);
  for (const row of sizes) {
    if (bytes <= MAX_TOTAL_BYTES) break;
    removed.push(row.id);
    bytes -= Number(row.bytes);
  }
  for (let offset = 0; offset < removed.length; offset += 500) {
    const batch = removed.slice(offset, offset + 500);
    await Connection.raw(`DELETE FROM agent_code_graph_parse_cache WHERE id IN (${batch.map(() => '?').join(',')})`, batch);
  }
}
