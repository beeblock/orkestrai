import { codeGraphConnectionName, runCodeGraphOperation, CodeGraphConnection as Connection } from '$lib/database/code-graph-storage.js';
import { uuidv7 } from '@beeblock/svelar/support';
import { createHash } from 'node:crypto';
import type {
  CodeGraphEmbeddingEntry,
  CodeGraphEmbeddingState,
  CodeGraphEmbeddingWrite,
  CodeGraphEvidenceRunWrite,
  CodeGraphIntelligenceStore,
  CodeGraphSemanticStoreStatus,
} from '../../application/ports/CodeGraphIntelligenceStore.js';
import type { CodeGraphEvidenceEdge, CodeGraphEvidenceRun, CodeGraphSymbol } from '../../domain/code-graph.js';

type RawRow = Record<string, unknown>;

function placeholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(', ');
}

function parseJson<T>(value: unknown, fallback: T): T {
  try {
    const parsed = JSON.parse(String(value ?? ''));
    return parsed == null ? fallback : parsed as T;
  } catch {
    return fallback;
  }
}

function iso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
}

function mapSymbol(row: RawRow): CodeGraphSymbol {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    projectId: String(row.project_id),
    projectName: row.project_name ? String(row.project_name) : null,
    projectRelativePath: row.project_relative_path ? String(row.project_relative_path) : null,
    revisionId: String(row.published_revision_id ?? row.revision_id),
    fileId: row.file_id ? String(row.file_id) : null,
    path: row.path ? String(row.path) : null,
    language: row.language ? row.language as CodeGraphSymbol['language'] : null,
    parentSymbolId: row.parent_symbol_id ? String(row.parent_symbol_id) : null,
    kind: row.kind as CodeGraphSymbol['kind'],
    name: String(row.name),
    qualifiedName: String(row.qualified_name),
    signature: row.signature ? String(row.signature) : null,
    documentation: row.documentation ? String(row.documentation) : null,
    modifiers: parseJson(row.modifiers_json, []),
    metadata: parseJson(row.metadata_json, {}),
    exported: Boolean(row.exported),
    startLine: row.start_line == null ? null : Number(row.start_line),
    startColumn: row.start_column == null ? null : Number(row.start_column),
    endLine: row.end_line == null ? null : Number(row.end_line),
    endColumn: row.end_column == null ? null : Number(row.end_column),
  };
}

function asVector(value: unknown): Int8Array {
  if (value instanceof Uint8Array) return new Int8Array(value.buffer, value.byteOffset, value.byteLength);
  if (Array.isArray(value)) return Int8Array.from(value.map(Number));
  return new Int8Array();
}

function mapRun(row: RawRow): CodeGraphEvidenceRun {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    projectId: String(row.project_id),
    projectName: String(row.project_name ?? ''),
    revisionId: String(row.revision_id),
    kind: row.kind as CodeGraphEvidenceRun['kind'],
    label: String(row.label),
    sourcePath: String(row.source_path),
    stats: parseJson(row.stats_json, {
      coveredSymbols: 0,
      failures: 0,
      observedCalls: 0,
      runtimeOnlyCalls: 0,
      unmatchedLocations: 0,
    }),
    importedAt: iso(row.imported_at),
  };
}

function mapEvidenceEdge(row: RawRow): CodeGraphEvidenceEdge {
  return {
    id: String(row.id),
    runId: String(row.run_id),
    sourceSymbolId: row.source_symbol_id ? String(row.source_symbol_id) : null,
    targetSymbolId: String(row.target_symbol_id),
    kind: row.kind as CodeGraphEvidenceEdge['kind'],
    count: Number(row.count),
    confidence: Number(row.confidence),
    metadata: parseJson(row.metadata_json, {}),
  };
}

export class CodeGraphIntelligenceRepository implements CodeGraphIntelligenceStore {
  async semanticRevision(workspaceId: string): Promise<{ key: string; total: number }> {
    const projects = await Connection.raw(`SELECT id, current_revision_id, stats_json FROM agent_code_graph_projects
      WHERE workspace_id = ? AND current_revision_id IS NOT NULL ORDER BY id`, [workspaceId]) as RawRow[];
    return { key: createHash('sha256').update(JSON.stringify(projects.map(row => [row.id, row.current_revision_id]))).digest('hex'),
      total: projects.reduce((sum, row) => sum + Number(parseJson<{ symbols?: number }>(row.stats_json, {}).symbols ?? 0), 0) };
  }

  async semanticSearchCache(workspaceId: string, model: string, data = false) {
    const rows = await Connection.raw(`SELECT built_at, revision_hash ${data ? ', search_data' : ''}
      FROM agent_code_graph_semantic_indexes WHERE workspace_id = ? AND model = ? LIMIT 1`, [workspaceId, model]) as RawRow[];
    return rows[0];
  }

  async semanticStatus(workspaceId: string, model: string): Promise<CodeGraphSemanticStoreStatus> {
    if (codeGraphConnectionName()) return runCodeGraphOperation('semantic-status', [workspaceId, model], true);
    const revision = await this.semanticRevision(workspaceId);
    const markers = await Connection.raw(`SELECT revision_hash, symbol_count, built_at FROM agent_code_graph_semantic_indexes
      WHERE workspace_id = ? AND model = ? LIMIT 1`, [workspaceId, model]) as RawRow[];
    const marker = markers[0];
    // The completion marker is committed only after all vectors. Revision ids
    // invalidate it immediately without recounting/joining every symbol on each poll.
    if (marker?.revision_hash === revision.key && Number(marker.symbol_count) === revision.total) {
      return { state: revision.total ? 'ready' : 'empty', totalSymbols: revision.total,
        indexedSymbols: Number(marker.symbol_count), builtAt: marker.built_at ? iso(marker.built_at) : null };
    }
    const rows = await Connection.raw(`
      SELECT
        COUNT(s.id) AS total_symbols,
        MAX(p.last_indexed_at) AS graph_indexed_at,
        COUNT(e.symbol_id) AS indexed_symbols,
        (SELECT COUNT(*) FROM agent_code_graph_semantic_indexes marker WHERE marker.workspace_id = ? AND marker.model = ?) AS has_index,
        (SELECT marker.built_at FROM agent_code_graph_semantic_indexes marker WHERE marker.workspace_id = ? AND marker.model = ? LIMIT 1) AS built_at
      FROM agent_code_graph_symbols s
      JOIN agent_code_graph_projects p ON p.id = s.project_id
      LEFT JOIN agent_code_graph_embeddings e ON e.symbol_id = s.id AND e.revision_id = p.current_revision_id AND e.model = ?
      WHERE s.workspace_id = ? AND s.revision_id = COALESCE(p.storage_revision_id, p.current_revision_id)
    `, [workspaceId, model, workspaceId, model, model, workspaceId]) as RawRow[];
    const totalSymbols = Number(rows[0]?.total_symbols ?? 0);
    const indexedSymbols = Number(rows[0]?.indexed_symbols ?? 0);
    const hasIndex = Number(rows[0]?.has_index ?? 0) > 0;
    return {
      state: totalSymbols === 0
        ? 'empty'
        : indexedSymbols === totalSymbols && hasIndex && new Date(String(rows[0]?.built_at)).getTime() >= new Date(String(rows[0]?.graph_indexed_at)).getTime()
          ? 'ready'
          : hasIndex
            ? 'stale'
            : 'empty',
      indexedSymbols,
      totalSymbols,
      builtAt: rows[0]?.built_at ? iso(rows[0].built_at) : null,
    };
  }

  async embeddingStates(workspaceId: string, model: string, symbolIds?: string[]): Promise<Array<CodeGraphEmbeddingState & { vector: Int8Array }>> {
    const rows = await Connection.raw(`
      SELECT symbol_id, model, dimensions, content_hash, vector
      FROM agent_code_graph_embeddings
      WHERE workspace_id = ? AND model = ? ${symbolIds?.length ? `AND symbol_id IN (${symbolIds.map(() => '?').join(',')})` : ''}
    `, [workspaceId, model, ...(symbolIds ?? [])]) as RawRow[];
    return rows.map((row) => ({
      symbolId: String(row.symbol_id),
      model: String(row.model),
      dimensions: Number(row.dimensions),
      contentHash: String(row.content_hash),
      vector: asVector(row.vector),
    }));
  }

  async syncEmbeddings(workspaceId: string, model: string, changedRows: CodeGraphEmbeddingWrite[], complete = true, cache?: { revisionKey: string; data: Buffer | null }): Promise<void> {
    const now = new Date().toISOString();
    await Connection.transaction(async () => {
      if (complete) {
      // Stable symbols keep their ids across incremental graph revisions. Move
      // their existing vectors to the current revision without rewriting blobs.
      await Connection.raw(`
        UPDATE agent_code_graph_embeddings
        SET revision_id = (
              SELECT p.current_revision_id FROM agent_code_graph_symbols s
              JOIN agent_code_graph_projects p ON p.id = s.project_id
              WHERE s.id = agent_code_graph_embeddings.symbol_id
                AND s.revision_id = COALESCE(p.storage_revision_id, p.current_revision_id)
              LIMIT 1
            ),
            project_id = (
              SELECT s.project_id FROM agent_code_graph_symbols s
              JOIN agent_code_graph_projects p ON p.id = s.project_id
              WHERE s.id = agent_code_graph_embeddings.symbol_id
                AND s.revision_id = COALESCE(p.storage_revision_id, p.current_revision_id)
              LIMIT 1
            ),
            updated_at = ?
        WHERE workspace_id = ? AND model = ?
          AND EXISTS (
            SELECT 1 FROM agent_code_graph_symbols s
            JOIN agent_code_graph_projects p ON p.id = s.project_id
            WHERE s.id = agent_code_graph_embeddings.symbol_id
              AND s.revision_id = COALESCE(p.storage_revision_id, p.current_revision_id)
          )
      `, [now, workspaceId, model]);

      }
      for (let offset = 0; offset < changedRows.length; offset += 400) {
        const batch = changedRows.slice(offset, offset + 400);
        const values = batch.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
        await Connection.raw(`
          INSERT INTO agent_code_graph_embeddings
            (id, workspace_id, project_id, revision_id, symbol_id, model, dimensions, vector, content_hash, created_at, updated_at)
          VALUES ${values}
          ON CONFLICT(symbol_id, model) DO UPDATE SET
            workspace_id = excluded.workspace_id,
            project_id = excluded.project_id,
            revision_id = excluded.revision_id,
            dimensions = excluded.dimensions,
            vector = excluded.vector,
            content_hash = excluded.content_hash,
            updated_at = excluded.updated_at
        `, batch.flatMap((row) => [
          uuidv7(), row.workspaceId, row.projectId, row.revisionId, row.symbolId,
          row.model, row.dimensions,
          Buffer.from(row.vector.buffer, row.vector.byteOffset, row.vector.byteLength),
          row.contentHash, now, now,
        ]));
      }

      if (!complete) return;
      await Connection.raw(`
        DELETE FROM agent_code_graph_embeddings
        WHERE workspace_id = ? AND model = ?
          AND NOT EXISTS (
            SELECT 1 FROM agent_code_graph_symbols s
            JOIN agent_code_graph_projects p ON p.id = s.project_id
            WHERE s.id = agent_code_graph_embeddings.symbol_id
              AND s.revision_id = COALESCE(p.storage_revision_id, p.current_revision_id)
          )
      `, [workspaceId, model]);
      await Connection.raw(`
        INSERT INTO agent_code_graph_semantic_indexes (id, workspace_id, model, built_at, created_at, updated_at, revision_hash, symbol_count, search_data)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(workspace_id, model) DO UPDATE SET built_at = excluded.built_at, updated_at = excluded.updated_at,
          revision_hash = excluded.revision_hash, symbol_count = excluded.symbol_count, search_data = excluded.search_data
      `, [uuidv7(), workspaceId, model, now, now, now, cache?.revisionKey ?? null,
        cache ? (await this.semanticRevision(workspaceId)).total : null, cache?.data ?? null]);
      // Evict only regenerable accelerators, never completion markers or vectors.
      const sizes = await Connection.raw(`SELECT id, length(search_data) AS bytes FROM agent_code_graph_semantic_indexes
        WHERE search_data IS NOT NULL ORDER BY built_at DESC, id DESC`) as RawRow[];
      let retainedBytes = 0;
      for (const entry of sizes) {
        retainedBytes += Number(entry.bytes);
        if (retainedBytes > 64 * 1024 ** 2) await Connection.raw('UPDATE agent_code_graph_semantic_indexes SET search_data = NULL WHERE id = ?', [entry.id]);
      }
    });
  }

  async clearEmbeddings(workspaceId: string, model: string): Promise<void> {
    await Connection.transaction(async () => {
      await Connection.raw('DELETE FROM agent_code_graph_embeddings WHERE workspace_id = ? AND model = ?', [workspaceId, model]);
      await Connection.raw('DELETE FROM agent_code_graph_semantic_indexes WHERE workspace_id = ? AND model = ?', [workspaceId, model]);
    });
  }

  async semanticSymbolsPage(workspaceId: string, afterId = '', limit = 500): Promise<Array<{ symbol: CodeGraphSymbol; neighbors: string }>> {
    const rows = await Connection.raw(`
      SELECT s.*, p.current_revision_id AS published_revision_id, f.path, f.language,
        p.name AS project_name, p.relative_path AS project_relative_path,
        (SELECT group_concat(value, ' ') FROM (
          SELECT edge.kind || ' ' || neighbor.name AS value
          FROM agent_code_graph_edges edge JOIN agent_code_graph_symbols neighbor ON neighbor.id = edge.target_symbol_id
          WHERE edge.workspace_id = s.workspace_id AND edge.source_symbol_id = s.id LIMIT 8
        )) AS outgoing_names,
        (SELECT group_concat(value, ' ') FROM (
          SELECT edge.kind || ' ' || neighbor.name AS value
          FROM agent_code_graph_edges edge JOIN agent_code_graph_symbols neighbor ON neighbor.id = edge.source_symbol_id
          WHERE edge.workspace_id = s.workspace_id AND edge.target_symbol_id = s.id LIMIT 8
        )) AS incoming_names
      FROM agent_code_graph_symbols s JOIN agent_code_graph_projects p ON p.id = s.project_id
      LEFT JOIN agent_code_graph_files f ON f.id = s.file_id
      WHERE s.workspace_id = ? AND s.id > ? AND s.revision_id = COALESCE(p.storage_revision_id, p.current_revision_id)
      ORDER BY s.id LIMIT ?
    `, [workspaceId, afterId, limit]) as RawRow[];
    return rows.map(row => ({ symbol: mapSymbol(row), neighbors: [row.outgoing_names, row.incoming_names].filter(Boolean).join(' ') }));
  }

  async embeddingCandidatePage(workspaceId: string, model: string, projectId: string | undefined, afterId: string, limit = 2_000) {
    const bindings: unknown[] = [model, workspaceId];
    if (projectId) bindings.push(projectId);
    bindings.push(afterId, limit);
    const rows = await Connection.raw(`
      SELECT s.id, s.kind, s.name, s.documentation, s.exported, f.path, e.vector
      FROM agent_code_graph_symbols s
      CROSS JOIN agent_code_graph_embeddings e ON e.symbol_id = s.id AND e.model = ?
      JOIN agent_code_graph_projects p ON p.id = s.project_id
      LEFT JOIN agent_code_graph_files f ON f.id = s.file_id
      WHERE s.workspace_id = ? ${projectId ? 'AND s.project_id = ?' : ''} AND s.id > ?
        AND s.revision_id = COALESCE(p.storage_revision_id, p.current_revision_id)
        AND e.revision_id = p.current_revision_id
      ORDER BY s.id LIMIT ?`, bindings) as RawRow[];
    return rows.map(row => ({ id: String(row.id), kind: row.kind as CodeGraphSymbol['kind'], name: String(row.name),
      documentation: row.documentation ? String(row.documentation) : null, path: row.path ? String(row.path) : null,
      exported: Boolean(row.exported), vector: asVector(row.vector) }));
  }

  async embeddingEntries(workspaceId: string, model: string, projectId?: string, afterId?: string, limit?: number): Promise<CodeGraphEmbeddingEntry[]> {
    const projectClause = projectId ? 'AND s.project_id = ?' : '';
    const bindings: unknown[] = projectId ? [model, workspaceId, projectId] : [model, workspaceId];
    if (afterId !== undefined) bindings.push(afterId);
    if (limit !== undefined) bindings.push(limit);
    const rows = await Connection.raw(`
      SELECT s.*, p.current_revision_id AS published_revision_id, f.path, f.language, p.name AS project_name, p.relative_path AS project_relative_path, e.vector
      FROM agent_code_graph_embeddings e
      JOIN agent_code_graph_symbols s ON s.id = e.symbol_id
      JOIN agent_code_graph_projects p ON p.id = s.project_id
      LEFT JOIN agent_code_graph_files f ON f.id = s.file_id
      WHERE e.model = ? AND e.workspace_id = ? AND s.revision_id = COALESCE(p.storage_revision_id, p.current_revision_id) ${projectClause} ${afterId !== undefined ? 'AND s.id > ?' : ''}
      ORDER BY ${afterId !== undefined ? 's.id' : 's.exported DESC, s.name'} ${limit !== undefined ? 'LIMIT ?' : ''}
    `, bindings) as RawRow[];
    return rows.map((row) => ({ symbol: mapSymbol(row), vector: asVector(row.vector) }));
  }

  async replaceEvidenceRun(run: CodeGraphEvidenceRunWrite, edges: CodeGraphEvidenceEdge[]): Promise<CodeGraphEvidenceRun> {
    const now = new Date().toISOString();
    const existing = await Connection.raw(
      'SELECT id FROM agent_code_graph_evidence_runs WHERE project_id = ? AND source_path = ? LIMIT 1',
      [run.projectId, run.sourcePath],
    ) as RawRow[];
    const runId = existing[0] ? String(existing[0].id) : run.id;
    await Connection.transaction(async () => {
      if (existing[0]) {
        await Connection.raw('DELETE FROM agent_code_graph_evidence_edges WHERE run_id = ?', [runId]);
        await Connection.raw(`
          UPDATE agent_code_graph_evidence_runs
          SET revision_id = ?, kind = ?, label = ?, content_hash = ?, stats_json = ?, imported_at = ?, updated_at = ?
          WHERE id = ? AND workspace_id = ?
        `, [run.revisionId, run.kind, run.label, run.contentHash, JSON.stringify(run.stats), run.importedAt, now, runId, run.workspaceId]);
      } else {
        await Connection.raw(`
          INSERT INTO agent_code_graph_evidence_runs
            (id, workspace_id, project_id, revision_id, kind, label, source_path, content_hash, stats_json, imported_at, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [runId, run.workspaceId, run.projectId, run.revisionId, run.kind, run.label, run.sourcePath, run.contentHash, JSON.stringify(run.stats), run.importedAt, now, now]);
      }
      for (let offset = 0; offset < edges.length; offset += 500) {
        const batch = edges.slice(offset, offset + 500);
        const values = batch.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
        await Connection.raw(`
          INSERT INTO agent_code_graph_evidence_edges
            (id, run_id, workspace_id, project_id, revision_id, source_symbol_id, target_symbol_id, kind, count, confidence, metadata_json, created_at)
          VALUES ${values}
        `, batch.flatMap((edge) => [
          uuidv7(), runId, run.workspaceId, run.projectId, run.revisionId,
          edge.sourceSymbolId, edge.targetSymbolId, edge.kind, edge.count,
          edge.confidence, JSON.stringify(edge.metadata), now,
        ]));
      }
    });
    const saved = (await this.evidenceRuns(run.workspaceId, 200)).find((row) => row.id === runId);
    if (!saved) throw new Error('Runtime evidence run could not be persisted.');
    return saved;
  }

  async evidenceRuns(workspaceId: string, requestedLimit = 100): Promise<CodeGraphEvidenceRun[]> {
    const limit = Math.min(Math.max(requestedLimit, 1), 200);
    const rows = await Connection.raw(`
      SELECT r.*, p.name AS project_name
      FROM agent_code_graph_evidence_runs r
      JOIN agent_code_graph_projects p ON p.id = r.project_id
      WHERE r.workspace_id = ? AND r.revision_id = p.current_revision_id
      ORDER BY r.imported_at DESC
      LIMIT ?
    `, [workspaceId, limit]) as RawRow[];
    return rows.map(mapRun);
  }

  async evidenceEdges(workspaceId: string, runIds: string[], requestedLimit = 2_000): Promise<CodeGraphEvidenceEdge[]> {
    const ids = [...new Set(runIds)].slice(0, 200);
    const limit = Math.min(Math.max(requestedLimit, 1), 5_000);
    if (!ids.length) return [];
    const rows = await Connection.raw(`
      SELECT e.*
      FROM agent_code_graph_evidence_edges e
      JOIN agent_code_graph_projects p ON p.id = e.project_id
      WHERE e.workspace_id = ? AND e.revision_id = p.current_revision_id
        AND e.run_id IN (${placeholders(ids.length)})
      ORDER BY e.count DESC, e.confidence DESC
      LIMIT ?
    `, [workspaceId, ...ids, limit]) as RawRow[];
    return rows.map(mapEvidenceEdge);
  }
}

export const codeGraphIntelligenceRepository = new CodeGraphIntelligenceRepository();
