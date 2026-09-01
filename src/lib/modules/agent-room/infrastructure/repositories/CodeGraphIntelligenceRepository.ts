import { Connection } from '@beeblock/svelar/database';
import { uuidv7 } from '@beeblock/svelar/support';
import type {
  CodeGraphEmbeddingEntry,
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
    revisionId: String(row.revision_id),
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
  async semanticStatus(workspaceId: string, model: string): Promise<CodeGraphSemanticStoreStatus> {
    const rows = await Connection.raw(`
      SELECT
        COUNT(s.id) AS total_symbols,
        COUNT(e.id) AS indexed_symbols,
        (SELECT COUNT(*) FROM agent_code_graph_semantic_indexes marker WHERE marker.workspace_id = ? AND marker.model = ?) AS has_index,
        (SELECT marker.built_at FROM agent_code_graph_semantic_indexes marker WHERE marker.workspace_id = ? AND marker.model = ? LIMIT 1) AS built_at
      FROM agent_code_graph_symbols s
      JOIN agent_code_graph_projects p ON p.id = s.project_id
      LEFT JOIN agent_code_graph_embeddings e ON e.symbol_id = s.id AND e.revision_id = s.revision_id AND e.model = ?
      WHERE s.workspace_id = ? AND s.revision_id = p.current_revision_id
    `, [workspaceId, model, workspaceId, model, model, workspaceId]) as RawRow[];
    const totalSymbols = Number(rows[0]?.total_symbols ?? 0);
    const indexedSymbols = Number(rows[0]?.indexed_symbols ?? 0);
    const hasIndex = Number(rows[0]?.has_index ?? 0) > 0;
    return {
      state: totalSymbols === 0
        ? 'empty'
        : indexedSymbols === totalSymbols && hasIndex
          ? 'ready'
          : hasIndex
            ? 'stale'
            : 'empty',
      indexedSymbols,
      totalSymbols,
      builtAt: rows[0]?.built_at ? iso(rows[0].built_at) : null,
    };
  }

  async replaceEmbeddings(workspaceId: string, model: string, rows: CodeGraphEmbeddingWrite[]): Promise<void> {
    const now = new Date().toISOString();
    await Connection.transaction(async () => {
      await Connection.raw('DELETE FROM agent_code_graph_embeddings WHERE workspace_id = ? AND model = ?', [workspaceId, model]);
      for (let offset = 0; offset < rows.length; offset += 400) {
        const batch = rows.slice(offset, offset + 400);
        const values = batch.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
        await Connection.raw(`
          INSERT INTO agent_code_graph_embeddings
            (id, workspace_id, project_id, revision_id, symbol_id, model, dimensions, vector, content_hash, created_at, updated_at)
          VALUES ${values}
        `, batch.flatMap((row) => [
          uuidv7(), row.workspaceId, row.projectId, row.revisionId, row.symbolId,
          row.model, row.dimensions,
          Buffer.from(row.vector.buffer, row.vector.byteOffset, row.vector.byteLength),
          row.contentHash, now, now,
        ]));
      }
      await Connection.raw(`
        INSERT INTO agent_code_graph_semantic_indexes (id, workspace_id, model, built_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(workspace_id, model) DO UPDATE SET built_at = excluded.built_at, updated_at = excluded.updated_at
      `, [uuidv7(), workspaceId, model, now, now, now]);
    });
  }

  async clearEmbeddings(workspaceId: string, model: string): Promise<void> {
    await Connection.transaction(async () => {
      await Connection.raw('DELETE FROM agent_code_graph_embeddings WHERE workspace_id = ? AND model = ?', [workspaceId, model]);
      await Connection.raw('DELETE FROM agent_code_graph_semantic_indexes WHERE workspace_id = ? AND model = ?', [workspaceId, model]);
    });
  }

  async embeddingEntries(workspaceId: string, model: string, projectId?: string): Promise<CodeGraphEmbeddingEntry[]> {
    const projectClause = projectId ? 'AND s.project_id = ?' : '';
    const bindings = projectId ? [model, workspaceId, projectId] : [model, workspaceId];
    const rows = await Connection.raw(`
      SELECT s.*, f.path, f.language, p.name AS project_name, p.relative_path AS project_relative_path, e.vector
      FROM agent_code_graph_embeddings e
      JOIN agent_code_graph_symbols s ON s.id = e.symbol_id
      JOIN agent_code_graph_projects p ON p.id = s.project_id
      LEFT JOIN agent_code_graph_files f ON f.id = s.file_id
      WHERE e.model = ? AND e.workspace_id = ? AND s.revision_id = p.current_revision_id ${projectClause}
      ORDER BY s.exported DESC, s.name
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
