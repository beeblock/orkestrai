import { Connection } from '@beeblock/svelar/database';
import { uuidv7 } from '@beeblock/svelar/support';
import type {
  CodeGraphCommit,
  CodeGraphProjectRoot,
  CodeGraphRevisionHandle,
  CodeGraphStore,
} from '../../application/ports/CodeGraphStore.js';
import type {
  CodeGraphDiagnostic,
  CodeGraphEdge,
  CodeGraphProject,
  CodeGraphSearchOptions,
  CodeGraphSnapshot,
  CodeGraphStats,
  CodeGraphSubgraph,
  CodeGraphSymbol,
  CodeGraphTraversalOptions,
} from '../../domain/code-graph.js';
import { AgentCodeGraphEdge } from '../../domain/models/AgentCodeGraphEdge.js';
import { AgentCodeGraphFile } from '../../domain/models/AgentCodeGraphFile.js';
import { AgentCodeGraphProject } from '../../domain/models/AgentCodeGraphProject.js';
import { AgentCodeGraphRevision } from '../../domain/models/AgentCodeGraphRevision.js';
import { AgentCodeGraphSymbol } from '../../domain/models/AgentCodeGraphSymbol.js';

type RawRow = Record<string, unknown>;
type PersistedRevisionIndex = {
  revisionId: string;
  files: Map<string, RawRow>;
  symbols: Map<string, RawRow>;
  edges: Map<string, RawRow>;
};

function persistenceCache(): Map<string, PersistedRevisionIndex> {
  const global = globalThis as typeof globalThis & {
    __orkestraiCodeGraphPersistenceCache?: Map<string, PersistedRevisionIndex>;
  };
  global.__orkestraiCodeGraphPersistenceCache ??= new Map();
  return global.__orkestraiCodeGraphPersistenceCache;
}

const EMPTY_STATS: CodeGraphStats = {
  files: 0,
  symbols: 0,
  edges: 0,
  skipped: 0,
  durationMs: 0,
  languages: {},
};

function iso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
}

function nullableIso(value: unknown): string | null {
  return value ? iso(value) : null;
}

function parseJson<T>(value: unknown, fallback: T): T {
  try {
    const parsed = JSON.parse(String(value ?? ''));
    return parsed == null ? fallback : parsed as T;
  } catch {
    return fallback;
  }
}

function mapProject(model: AgentCodeGraphProject): CodeGraphProject {
  return {
    id: String(model.getAttribute('id')),
    workspaceId: String(model.getAttribute('workspace_id')),
    name: String(model.getAttribute('name')),
    rootPath: String(model.getAttribute('root_path')),
    relativePath: model.getAttribute('relative_path') as string | null,
    status: model.getAttribute('status') as CodeGraphProject['status'],
    currentRevisionId: model.getAttribute('current_revision_id') as string | null,
    gitHead: model.getAttribute('git_head') as string | null,
    stats: parseJson(model.getAttribute('stats_json'), { ...EMPTY_STATS }),
    diagnostics: parseJson(model.getAttribute('diagnostics_json'), []),
    lastIndexedAt: nullableIso(model.getAttribute('last_indexed_at')),
    createdAt: iso(model.getAttribute('created_at')),
    updatedAt: iso(model.getAttribute('updated_at')),
  };
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
    exported: Boolean(row.exported),
    startLine: row.start_line == null ? null : Number(row.start_line),
    startColumn: row.start_column == null ? null : Number(row.start_column),
    endLine: row.end_line == null ? null : Number(row.end_line),
    endColumn: row.end_column == null ? null : Number(row.end_column),
  };
}

function mapEdge(row: RawRow): CodeGraphEdge {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    projectId: String(row.project_id),
    revisionId: String(row.revision_id),
    sourceSymbolId: String(row.source_symbol_id),
    targetSymbolId: String(row.target_symbol_id),
    kind: row.kind as CodeGraphEdge['kind'],
    confidence: Number(row.confidence),
    sitePath: row.site_path ? String(row.site_path) : null,
    siteLine: row.site_line == null ? null : Number(row.site_line),
    siteColumn: row.site_column == null ? null : Number(row.site_column),
    metadata: parseJson(row.metadata_json, {}),
  };
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(', ');
}

async function insertRows(table: string, columns: string[], rows: unknown[][], batchSize = 800): Promise<void> {
  for (let offset = 0; offset < rows.length; offset += batchSize) {
    const batch = rows.slice(offset, offset + batchSize);
    const values = batch.map(() => `(${placeholders(columns.length)})`).join(', ');
    await Connection.raw(
      `INSERT INTO ${table} (${columns.join(', ')}) VALUES ${values}`,
      batch.flat(),
    );
  }
}

async function deleteRowsByIds(table: string, column: string, ids: string[], batchSize = 800): Promise<void> {
  for (let offset = 0; offset < ids.length; offset += batchSize) {
    const batch = ids.slice(offset, offset + batchSize);
    await Connection.raw(`DELETE FROM ${table} WHERE ${column} IN (${placeholders(batch.length)})`, batch);
  }
}

function ftsQuery(value: string): string {
  const tokens = value.normalize('NFKC').match(/[\p{L}\p{N}_.$\\/-]+/gu)?.slice(0, 10) ?? [];
  return tokens.map((token) => `"${token.replaceAll('"', '""')}"*`).join(' AND ');
}

export class CodeGraphRepository implements CodeGraphStore {
  async syncProjects(workspaceId: string, roots: CodeGraphProjectRoot[]): Promise<CodeGraphProject[]> {
    const existing = await AgentCodeGraphProject.query().where('workspace_id', workspaceId).get();
    const byRoot = new Map(existing.map((project) => [String(project.getAttribute('root_path')), project]));
    const desired = new Set(roots.map((root) => root.rootPath));
    const now = new Date().toISOString();

    await Connection.transaction(async () => {
      for (const root of roots) {
        const project = byRoot.get(root.rootPath);
        if (!project) {
          await AgentCodeGraphProject.create({
            id: uuidv7(),
            workspace_id: workspaceId,
            name: root.name,
            root_path: root.rootPath,
            relative_path: root.relativePath,
            status: 'idle',
            current_revision_id: null,
            git_head: null,
            config_hash: root.configHash,
            stats_json: JSON.stringify(EMPTY_STATS),
            diagnostics_json: '[]',
            last_indexed_at: null,
            created_at: now,
            updated_at: now,
          });
          continue;
        }
        const configChanged = project.getAttribute('config_hash') !== root.configHash;
        await project.update({
          name: root.name,
          relative_path: root.relativePath,
          config_hash: root.configHash,
          status: configChanged && project.getAttribute('status') === 'ready' ? 'stale' : project.getAttribute('status'),
          updated_at: now,
        });
      }
      for (const project of existing) {
        if (!desired.has(String(project.getAttribute('root_path')))) {
          await this.deleteProject(String(project.getAttribute('id')));
        }
      }
    });
    return this.listProjects(workspaceId);
  }

  async listProjects(workspaceId: string): Promise<CodeGraphProject[]> {
    const rows = await AgentCodeGraphProject.query().where('workspace_id', workspaceId).orderBy('name', 'asc').get();
    return rows.map(mapProject);
  }

  async snapshot(workspaceId: string): Promise<CodeGraphSnapshot> {
    const projects = await this.listProjects(workspaceId);
    const totals = projects.reduce<CodeGraphStats>((total, project) => ({
      files: total.files + project.stats.files,
      symbols: total.symbols + project.stats.symbols,
      edges: total.edges + project.stats.edges,
      skipped: total.skipped + project.stats.skipped,
      durationMs: total.durationMs + project.stats.durationMs,
      languages: Object.entries(project.stats.languages).reduce((languages, [language, count]) => ({
        ...languages,
        [language]: (languages[language as keyof typeof languages] ?? 0) + Number(count ?? 0),
      }), total.languages),
    }), { ...EMPTY_STATS, languages: {} });
    return { projects, totals, indexing: projects.some((project) => project.status === 'indexing') };
  }

  async currentSourceHash(projectId: string): Promise<string | null> {
    const project = await AgentCodeGraphProject.find(projectId);
    const revisionId = project?.getAttribute('current_revision_id') as string | null | undefined;
    if (!revisionId) return null;
    const revision = await AgentCodeGraphRevision.find(revisionId);
    return revision?.getAttribute('state') === 'ready'
      ? revision.getAttribute('source_hash') as string | null
      : null;
  }

  async markStale(workspaceId: string, projectId: string): Promise<boolean> {
    const project = await AgentCodeGraphProject.find(projectId);
    if (!project || project.getAttribute('workspace_id') !== workspaceId || project.getAttribute('status') !== 'ready') {
      return false;
    }
    await project.update({ status: 'stale', updated_at: new Date().toISOString() });
    return true;
  }

  async beginRevision(workspaceId: string, projectId: string, gitHead: string | null): Promise<CodeGraphRevisionHandle> {
    const project = await AgentCodeGraphProject.find(projectId);
    if (!project || project.getAttribute('workspace_id') !== workspaceId) throw new Error('Code graph project not found.');
    const previous = await AgentCodeGraphRevision.query().where('project_id', projectId).orderBy('sequence', 'desc').first();
    const now = new Date().toISOString();
    const revision = await AgentCodeGraphRevision.create({
      id: uuidv7(),
      workspace_id: workspaceId,
      project_id: projectId,
      sequence: Number(previous?.getAttribute('sequence') ?? 0) + 1,
      state: 'building',
      source_hash: null,
      git_head: gitHead,
      stats_json: null,
      diagnostics_json: null,
      started_at: now,
      completed_at: null,
      created_at: now,
      updated_at: now,
    });
    await project.update({ status: 'indexing', diagnostics_json: '[]', updated_at: now });
    return {
      id: String(revision.getAttribute('id')),
      projectId,
      sequence: Number(revision.getAttribute('sequence')),
    };
  }

  async commitRevision(input: CodeGraphCommit): Promise<CodeGraphProject> {
    const project = await AgentCodeGraphProject.find(input.projectId);
    const revision = await AgentCodeGraphRevision.find(input.revisionId);
    if (!project || project.getAttribute('workspace_id') !== input.workspaceId) throw new Error('Code graph project not found.');
    if (!revision || revision.getAttribute('project_id') !== input.projectId || revision.getAttribute('state') !== 'building') {
      throw new Error('Code graph revision is not writable.');
    }

    const now = new Date().toISOString();
    const commitStartedAt = Date.now();
    const committedStats = { ...input.stats };
    const previousRevisionId = project.getAttribute('current_revision_id') as string | null;
    if (previousRevisionId && !input.fullReplace) {
      const incremental = await this.commitIncrementalRevision(
        input,
        project,
        revision,
        previousRevisionId,
        now,
        commitStartedAt,
      );
      if (incremental) return incremental;
    }
    const fileIds = new Map(input.files.map((file) => [file.key, uuidv7()]));
    const symbolIds = new Map(input.symbols.map((symbol) => [symbol.key, uuidv7()]));
    const edgeIds = new Map(input.edges.map((edge) => [edge.fingerprint, uuidv7()]));
    const filePathByKey = new Map(input.files.map((file) => [file.key, file.path]));

    await Connection.transaction(async () => {
      if (previousRevisionId && previousRevisionId !== input.revisionId) {
        await AgentCodeGraphRevision.query().where('id', previousRevisionId).update({ state: 'superseded', updated_at: now });
        await Connection.raw('DELETE FROM agent_code_graph_symbol_search WHERE project_id = ?', [input.projectId]);
        await AgentCodeGraphEdge.query().where('revision_id', previousRevisionId).delete();
        await AgentCodeGraphSymbol.query().where('revision_id', previousRevisionId).delete();
        await AgentCodeGraphFile.query().where('revision_id', previousRevisionId).delete();
      }

      await insertRows('agent_code_graph_files', [
        'id', 'workspace_id', 'project_id', 'revision_id', 'path', 'language',
        'content_hash', 'byte_size', 'generated', 'symbol_count', 'edge_count',
        'source_modified_at', 'created_at', 'updated_at',
      ], input.files.map((file) => [
        fileIds.get(file.key), input.workspaceId, input.projectId, input.revisionId,
        file.path, file.language, file.contentHash, file.byteSize, file.generated,
        file.symbolCount, file.edgeCount, file.modifiedAt, now, now,
      ]));

      await insertRows('agent_code_graph_symbols', [
        'id', 'workspace_id', 'project_id', 'revision_id', 'file_id',
        'parent_symbol_id', 'kind', 'name', 'qualified_name', 'signature',
        'documentation', 'modifiers_json', 'exported', 'start_line',
        'start_column', 'end_line', 'end_column', 'fingerprint', 'created_at', 'updated_at',
      ], input.symbols.map((symbol) => [
        symbolIds.get(symbol.key), input.workspaceId, input.projectId, input.revisionId,
        symbol.fileKey ? fileIds.get(symbol.fileKey) ?? null : null,
        symbol.parentKey ? symbolIds.get(symbol.parentKey) ?? null : null,
        symbol.kind, symbol.name, symbol.qualifiedName, symbol.signature,
        symbol.documentation, JSON.stringify(symbol.modifiers), symbol.exported,
        symbol.startLine, symbol.startColumn, symbol.endLine, symbol.endColumn,
        symbol.fingerprint, now, now,
      ]));

      await insertRows('agent_code_graph_edges', [
        'id', 'workspace_id', 'project_id', 'revision_id', 'source_symbol_id',
        'target_symbol_id', 'site_file_id', 'kind', 'confidence', 'site_line',
        'site_column', 'metadata_json', 'fingerprint', 'created_at', 'updated_at',
      ], input.edges.flatMap((edge) => {
        const source = symbolIds.get(edge.sourceKey);
        const target = symbolIds.get(edge.targetKey);
        if (!source || !target) return [];
        return [[
          edgeIds.get(edge.fingerprint), input.workspaceId, input.projectId, input.revisionId, source, target,
          edge.siteFileKey ? fileIds.get(edge.siteFileKey) ?? null : null,
          edge.kind, edge.confidence, edge.siteLine, edge.siteColumn,
          JSON.stringify(edge.metadata), edge.fingerprint, now, now,
        ]];
      }));

      await insertRows('agent_code_graph_symbol_search', [
        'symbol_id', 'revision_id', 'workspace_id', 'project_id', 'name',
        'qualified_name', 'path', 'documentation', 'signature',
      ], input.symbols.map((symbol) => [
        symbolIds.get(symbol.key), input.revisionId, input.workspaceId, input.projectId,
        symbol.name, symbol.qualifiedName, symbol.fileKey ? filePathByKey.get(symbol.fileKey) ?? '' : '',
        symbol.documentation ?? '', symbol.signature ?? '',
      ]));

      committedStats.durationMs += Date.now() - commitStartedAt;
      await revision.update({
        state: 'ready',
        source_hash: input.sourceHash,
        git_head: input.gitHead,
        stats_json: JSON.stringify(committedStats),
        diagnostics_json: JSON.stringify(input.diagnostics.slice(0, 500)),
        completed_at: now,
        updated_at: now,
      });
      await project.update({
        status: 'ready',
        current_revision_id: input.revisionId,
        git_head: input.gitHead,
        stats_json: JSON.stringify(committedStats),
        diagnostics_json: JSON.stringify(input.diagnostics.slice(0, 500)),
        last_indexed_at: now,
        updated_at: now,
      });

    });

    this.cacheCommittedRevision(input, fileIds, symbolIds, edgeIds);
    return mapProject((await AgentCodeGraphProject.find(input.projectId))!);
  }

  private async commitIncrementalRevision(
    input: CodeGraphCommit,
    project: AgentCodeGraphProject,
    revision: AgentCodeGraphRevision,
    previousRevisionId: string,
    now: string,
    commitStartedAt: number,
  ): Promise<CodeGraphProject | null> {
    const cached = persistenceCache().get(input.projectId);
    const [fileRows, symbolRows, edgeRows] = cached?.revisionId === previousRevisionId
      ? [[...cached.files.values()], [...cached.symbols.values()], [...cached.edges.values()]]
      : await Promise.all([
          Connection.raw(`
            SELECT id, path, content_hash
            FROM agent_code_graph_files
            WHERE revision_id = ?
          `, [previousRevisionId]) as Promise<RawRow[]>,
          Connection.raw(`
            SELECT s.id, s.fingerprint, f.path AS file_path
            FROM agent_code_graph_symbols s
            LEFT JOIN agent_code_graph_files f ON f.id = s.file_id
            WHERE s.revision_id = ?
          `, [previousRevisionId]) as Promise<RawRow[]>,
          Connection.raw(`
            SELECT e.id, e.fingerprint, f.path AS site_path
            FROM agent_code_graph_edges e
            LEFT JOIN agent_code_graph_files f ON f.id = e.site_file_id
            WHERE e.revision_id = ?
          `, [previousRevisionId]) as Promise<RawRow[]>,
        ]);

    const existingFileByPath = new Map(fileRows.map((row) => [String(row.path), row]));
    const inputPaths = new Set(input.files.map((file) => file.path));
    const changedFiles = input.files.filter((file) => {
      const existing = existingFileByPath.get(file.path);
      return !existing || String(existing.content_hash) !== file.contentHash;
    });
    const removedFiles = fileRows.filter((row) => !inputPaths.has(String(row.path)));
    const changedPaths = new Set(changedFiles.map((file) => file.path));
    const changedFileCount = changedFiles.length + removedFiles.length;
    const replacementThreshold = Math.max(50, Math.floor(Math.max(fileRows.length, input.files.length) * 0.1));
    if (changedFileCount > replacementThreshold) return null;

    const fileIds = new Map(input.files.map((file) => [
      file.key,
      existingFileByPath.get(file.path)?.id ? String(existingFileByPath.get(file.path)!.id) : uuidv7(),
    ]));
    const filePathByKey = new Map(input.files.map((file) => [file.key, file.path]));
    const addedFiles = input.files.filter((file) => !existingFileByPath.has(file.path));

    const existingSymbolByFingerprint = new Map(symbolRows.map((row) => [String(row.fingerprint), row]));
    const inputSymbolFingerprints = new Set(input.symbols.map((symbol) => symbol.fingerprint));
    const symbolIds = new Map(input.symbols.map((symbol) => [
      symbol.key,
      existingSymbolByFingerprint.get(symbol.fingerprint)?.id
        ? String(existingSymbolByFingerprint.get(symbol.fingerprint)!.id)
        : uuidv7(),
    ]));
    const removedSymbols = symbolRows.filter((row) => !inputSymbolFingerprints.has(String(row.fingerprint)));
    const refreshedSymbols = input.symbols.filter((symbol) => {
      const existing = existingSymbolByFingerprint.get(symbol.fingerprint);
      const path = symbol.fileKey ? filePathByKey.get(symbol.fileKey) : null;
      return !existing || Boolean(path && changedPaths.has(path));
    });
    const addedSymbols = refreshedSymbols.filter((symbol) => !existingSymbolByFingerprint.has(symbol.fingerprint));
    const updatedSymbols = refreshedSymbols.filter((symbol) => existingSymbolByFingerprint.has(symbol.fingerprint));

    const existingEdgeByFingerprint = new Map(edgeRows.map((row) => [String(row.fingerprint), row]));
    const edgeIds = new Map(input.edges.map((edge) => [
      edge.fingerprint,
      existingEdgeByFingerprint.get(edge.fingerprint)?.id
        ? String(existingEdgeByFingerprint.get(edge.fingerprint)!.id)
        : uuidv7(),
    ]));
    const inputEdgeFingerprints = new Set(input.edges.map((edge) => edge.fingerprint));
    const removedEdges = edgeRows.filter((row) => !inputEdgeFingerprints.has(String(row.fingerprint)));
    const addedEdges = input.edges.filter((edge) => !existingEdgeByFingerprint.has(edge.fingerprint));
    const updatedEdges = input.edges.filter((edge) => {
      if (!existingEdgeByFingerprint.has(edge.fingerprint) || !edge.siteFileKey) return false;
      const path = filePathByKey.get(edge.siteFileKey);
      return Boolean(path && changedPaths.has(path));
    });

    const committedStats = { ...input.stats };
    await Connection.transaction(async () => {
      await AgentCodeGraphRevision.query().where('id', previousRevisionId).update({ state: 'superseded', updated_at: now });
      await Connection.raw('UPDATE agent_code_graph_files SET revision_id = ?, updated_at = ? WHERE revision_id = ?', [input.revisionId, now, previousRevisionId]);
      await Connection.raw('UPDATE agent_code_graph_symbols SET revision_id = ?, updated_at = ? WHERE revision_id = ?', [input.revisionId, now, previousRevisionId]);
      await Connection.raw('UPDATE agent_code_graph_edges SET revision_id = ?, updated_at = ? WHERE revision_id = ?', [input.revisionId, now, previousRevisionId]);

      await deleteRowsByIds('agent_code_graph_edges', 'id', removedEdges.map((row) => String(row.id)));
      const refreshedSymbolIds = refreshedSymbols.map((symbol) => symbolIds.get(symbol.key)!);
      const removedSymbolIds = removedSymbols.map((row) => String(row.id));
      await deleteRowsByIds('agent_code_graph_symbol_search', 'symbol_id', [...new Set([...refreshedSymbolIds, ...removedSymbolIds])]);
      await deleteRowsByIds('agent_code_graph_symbols', 'id', removedSymbolIds);
      await deleteRowsByIds('agent_code_graph_files', 'id', removedFiles.map((row) => String(row.id)));

      for (const file of changedFiles) {
        const existing = existingFileByPath.get(file.path);
        if (!existing) continue;
        await Connection.raw(`
          UPDATE agent_code_graph_files
          SET revision_id = ?, language = ?, content_hash = ?, byte_size = ?, generated = ?,
              symbol_count = ?, edge_count = ?, source_modified_at = ?, updated_at = ?
          WHERE id = ?
        `, [
          input.revisionId, file.language, file.contentHash, file.byteSize, file.generated,
          file.symbolCount, file.edgeCount, file.modifiedAt, now, String(existing.id),
        ]);
      }
      await insertRows('agent_code_graph_files', [
        'id', 'workspace_id', 'project_id', 'revision_id', 'path', 'language',
        'content_hash', 'byte_size', 'generated', 'symbol_count', 'edge_count',
        'source_modified_at', 'created_at', 'updated_at',
      ], addedFiles.map((file) => [
        fileIds.get(file.key), input.workspaceId, input.projectId, input.revisionId,
        file.path, file.language, file.contentHash, file.byteSize, file.generated,
        file.symbolCount, file.edgeCount, file.modifiedAt, now, now,
      ]));

      for (const symbol of updatedSymbols) {
        await Connection.raw(`
          UPDATE agent_code_graph_symbols
          SET revision_id = ?, file_id = ?, parent_symbol_id = ?, kind = ?, name = ?,
              qualified_name = ?, signature = ?, documentation = ?, modifiers_json = ?,
              exported = ?, start_line = ?, start_column = ?, end_line = ?, end_column = ?, updated_at = ?
          WHERE id = ?
        `, [
          input.revisionId, symbol.fileKey ? fileIds.get(symbol.fileKey) ?? null : null,
          symbol.parentKey ? symbolIds.get(symbol.parentKey) ?? null : null,
          symbol.kind, symbol.name, symbol.qualifiedName, symbol.signature, symbol.documentation,
          JSON.stringify(symbol.modifiers), symbol.exported, symbol.startLine, symbol.startColumn,
          symbol.endLine, symbol.endColumn, now, symbolIds.get(symbol.key),
        ]);
      }
      await insertRows('agent_code_graph_symbols', [
        'id', 'workspace_id', 'project_id', 'revision_id', 'file_id',
        'parent_symbol_id', 'kind', 'name', 'qualified_name', 'signature',
        'documentation', 'modifiers_json', 'exported', 'start_line',
        'start_column', 'end_line', 'end_column', 'fingerprint', 'created_at', 'updated_at',
      ], addedSymbols.map((symbol) => [
        symbolIds.get(symbol.key), input.workspaceId, input.projectId, input.revisionId,
        symbol.fileKey ? fileIds.get(symbol.fileKey) ?? null : null,
        symbol.parentKey ? symbolIds.get(symbol.parentKey) ?? null : null,
        symbol.kind, symbol.name, symbol.qualifiedName, symbol.signature,
        symbol.documentation, JSON.stringify(symbol.modifiers), symbol.exported,
        symbol.startLine, symbol.startColumn, symbol.endLine, symbol.endColumn,
        symbol.fingerprint, now, now,
      ]));

      for (const edge of updatedEdges) {
        const existing = existingEdgeByFingerprint.get(edge.fingerprint)!;
        await Connection.raw(`
          UPDATE agent_code_graph_edges
          SET revision_id = ?, source_symbol_id = ?, target_symbol_id = ?, site_file_id = ?,
              kind = ?, confidence = ?, site_line = ?, site_column = ?, metadata_json = ?, updated_at = ?
          WHERE id = ?
        `, [
          input.revisionId, symbolIds.get(edge.sourceKey), symbolIds.get(edge.targetKey),
          edge.siteFileKey ? fileIds.get(edge.siteFileKey) ?? null : null,
          edge.kind, edge.confidence, edge.siteLine, edge.siteColumn,
          JSON.stringify(edge.metadata), now, String(existing.id),
        ]);
      }
      await insertRows('agent_code_graph_edges', [
        'id', 'workspace_id', 'project_id', 'revision_id', 'source_symbol_id',
        'target_symbol_id', 'site_file_id', 'kind', 'confidence', 'site_line',
        'site_column', 'metadata_json', 'fingerprint', 'created_at', 'updated_at',
      ], addedEdges.flatMap((edge) => {
        const source = symbolIds.get(edge.sourceKey);
        const target = symbolIds.get(edge.targetKey);
        if (!source || !target) return [];
        return [[
          edgeIds.get(edge.fingerprint), input.workspaceId, input.projectId, input.revisionId, source, target,
          edge.siteFileKey ? fileIds.get(edge.siteFileKey) ?? null : null,
          edge.kind, edge.confidence, edge.siteLine, edge.siteColumn,
          JSON.stringify(edge.metadata), edge.fingerprint, now, now,
        ]];
      }));

      await insertRows('agent_code_graph_symbol_search', [
        'symbol_id', 'revision_id', 'workspace_id', 'project_id', 'name',
        'qualified_name', 'path', 'documentation', 'signature',
      ], refreshedSymbols.map((symbol) => [
        symbolIds.get(symbol.key), input.revisionId, input.workspaceId, input.projectId,
        symbol.name, symbol.qualifiedName, symbol.fileKey ? filePathByKey.get(symbol.fileKey) ?? '' : '',
        symbol.documentation ?? '', symbol.signature ?? '',
      ]));

      committedStats.durationMs += Date.now() - commitStartedAt;
      await revision.update({
        state: 'ready',
        source_hash: input.sourceHash,
        git_head: input.gitHead,
        stats_json: JSON.stringify(committedStats),
        diagnostics_json: JSON.stringify(input.diagnostics.slice(0, 500)),
        completed_at: now,
        updated_at: now,
      });
      await project.update({
        status: 'ready',
        current_revision_id: input.revisionId,
        git_head: input.gitHead,
        stats_json: JSON.stringify(committedStats),
        diagnostics_json: JSON.stringify(input.diagnostics.slice(0, 500)),
        last_indexed_at: now,
        updated_at: now,
      });
    });

    this.cacheCommittedRevision(input, fileIds, symbolIds, edgeIds);
    return mapProject((await AgentCodeGraphProject.find(input.projectId))!);
  }

  private cacheCommittedRevision(
    input: CodeGraphCommit,
    fileIds: Map<string, string>,
    symbolIds: Map<string, string>,
    edgeIds: Map<string, string>,
  ): void {
    const filePathByKey = new Map(input.files.map((file) => [file.key, file.path]));
    persistenceCache().set(input.projectId, {
      revisionId: input.revisionId,
      files: new Map(input.files.map((file) => [file.path, {
        id: fileIds.get(file.key),
        path: file.path,
        content_hash: file.contentHash,
      }])),
      symbols: new Map(input.symbols.map((symbol) => [symbol.fingerprint, {
        id: symbolIds.get(symbol.key),
        fingerprint: symbol.fingerprint,
        file_path: symbol.fileKey ? filePathByKey.get(symbol.fileKey) ?? null : null,
      }])),
      edges: new Map(input.edges.map((edge) => [edge.fingerprint, {
        id: edgeIds.get(edge.fingerprint),
        fingerprint: edge.fingerprint,
        site_path: edge.siteFileKey ? filePathByKey.get(edge.siteFileKey) ?? null : null,
      }])),
    });
  }

  async failRevision(
    workspaceId: string,
    projectId: string,
    revisionId: string,
    diagnostics: CodeGraphDiagnostic[],
  ): Promise<void> {
    const now = new Date().toISOString();
    await Connection.transaction(async () => {
      await AgentCodeGraphRevision.query().where('id', revisionId).where('workspace_id', workspaceId).update({
        state: 'failed',
        diagnostics_json: JSON.stringify(diagnostics.slice(0, 500)),
        completed_at: now,
        updated_at: now,
      });
      await AgentCodeGraphProject.query().where('id', projectId).where('workspace_id', workspaceId).update({
        status: 'error',
        diagnostics_json: JSON.stringify(diagnostics.slice(0, 500)),
        updated_at: now,
      });
    });
  }

  async search(workspaceId: string, options: CodeGraphSearchOptions): Promise<CodeGraphSymbol[]> {
    const query = ftsQuery(options.query);
    if (!query) return [];
    const bindings: unknown[] = [query, workspaceId];
    const clauses = [
      'agent_code_graph_symbol_search MATCH ?',
      's.workspace_id = ?',
      's.revision_id = p.current_revision_id',
    ];
    if (options.projectId) {
      clauses.push('s.project_id = ?');
      bindings.push(options.projectId);
    }
    if (options.kinds?.length) {
      clauses.push(`s.kind IN (${placeholders(options.kinds.length)})`);
      bindings.push(...options.kinds);
    }
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);
    bindings.push(limit);
    const rows = await Connection.raw(`
      SELECT s.*, f.path, f.language, p.name AS project_name, p.relative_path AS project_relative_path,
             bm25(agent_code_graph_symbol_search, 2.0, 1.2, 0.7, 0.5, 0.4) AS rank
      FROM agent_code_graph_symbol_search
      JOIN agent_code_graph_symbols s ON s.id = agent_code_graph_symbol_search.symbol_id
      JOIN agent_code_graph_projects p ON p.id = s.project_id
      LEFT JOIN agent_code_graph_files f ON f.id = s.file_id
      WHERE ${clauses.join(' AND ')}
      ORDER BY rank, s.exported DESC, s.name
      LIMIT ?
    `, bindings) as RawRow[];
    return rows.map(mapSymbol);
  }

  async symbol(workspaceId: string, symbolId: string): Promise<CodeGraphSymbol | null> {
    const rows = await this.loadSymbols(workspaceId, [symbolId]);
    return rows[0] ?? null;
  }

  async overview(workspaceId: string, projectId?: string, requestedLimit = 220): Promise<CodeGraphSubgraph> {
    const limit = Math.min(Math.max(requestedLimit, 20), 400);
    const bindings: unknown[] = [workspaceId];
    const projectClause = projectId ? 'AND s.project_id = ?' : '';
    if (projectId) bindings.push(projectId);
    bindings.push(limit + 1);
    const rows = await Connection.raw(`
      SELECT s.*, f.path, f.language, p.name AS project_name, p.relative_path AS project_relative_path
      FROM agent_code_graph_symbols s
      JOIN agent_code_graph_projects p ON p.id = s.project_id
      LEFT JOIN agent_code_graph_files f ON f.id = s.file_id
      WHERE s.workspace_id = ?
        AND s.revision_id = p.current_revision_id
        AND s.kind = 'module'
        ${projectClause}
      ORDER BY p.name, f.path
      LIMIT ?
    `, bindings) as RawRow[];
    const truncated = rows.length > limit;
    const nodes = rows.slice(0, limit).map(mapSymbol);
    const ids = nodes.map((node) => node.id);
    if (!ids.length) return { nodes: [], edges: [], truncated, depth: 0, centerSymbolId: null };
    const edgeRows = await Connection.raw(`
      SELECT e.*, f.path AS site_path
      FROM agent_code_graph_edges e
      JOIN agent_code_graph_projects p ON p.id = e.project_id
      LEFT JOIN agent_code_graph_files f ON f.id = e.site_file_id
      WHERE e.workspace_id = ?
        AND e.revision_id = p.current_revision_id
        AND e.source_symbol_id IN (${placeholders(ids.length)})
        AND e.target_symbol_id IN (${placeholders(ids.length)})
      ORDER BY e.confidence DESC, e.kind
      LIMIT ?
    `, [workspaceId, ...ids, ...ids, limit * 4]) as RawRow[];
    return {
      nodes,
      edges: edgeRows.map(mapEdge),
      truncated: truncated || edgeRows.length >= limit * 4,
      depth: 0,
      centerSymbolId: null,
    };
  }

  async subgraph(workspaceId: string, options: CodeGraphTraversalOptions): Promise<CodeGraphSubgraph> {
    const center = await this.symbol(workspaceId, options.symbolId);
    if (!center) throw new Error('Code graph symbol not found.');
    const depth = Math.min(Math.max(options.depth ?? 2, 1), 4);
    const limit = Math.min(Math.max(options.limit ?? 250, 10), 750);
    const direction = options.direction ?? 'both';
    const visited = new Set<string>([center.id]);
    const edges = new Map<string, CodeGraphEdge>();
    let frontier = [center.id];
    let truncated = false;

    for (let level = 0; level < depth && frontier.length; level += 1) {
      const bindings: unknown[] = [workspaceId];
      const directions: string[] = [];
      if (direction !== 'incoming') {
        directions.push(`e.source_symbol_id IN (${placeholders(frontier.length)})`);
        bindings.push(...frontier);
      }
      if (direction !== 'outgoing') {
        directions.push(`e.target_symbol_id IN (${placeholders(frontier.length)})`);
        bindings.push(...frontier);
      }
      const kindClause = options.kinds?.length
        ? `AND e.kind IN (${placeholders(options.kinds.length)})`
        : '';
      if (options.kinds?.length) bindings.push(...options.kinds);
      bindings.push(limit * 3);
      const rows = await Connection.raw(`
        SELECT e.*, f.path AS site_path
        FROM agent_code_graph_edges e
        JOIN agent_code_graph_projects p ON p.id = e.project_id
        LEFT JOIN agent_code_graph_files f ON f.id = e.site_file_id
        WHERE e.workspace_id = ?
          AND e.revision_id = p.current_revision_id
          AND (${directions.join(' OR ')})
          ${kindClause}
        ORDER BY e.confidence DESC, e.kind
        LIMIT ?
      `, bindings) as RawRow[];
      if (rows.length >= limit * 3) truncated = true;
      const next = new Set<string>();
      for (const row of rows) {
        const edge = mapEdge(row);
        edges.set(edge.id, edge);
        for (const id of [edge.sourceSymbolId, edge.targetSymbolId]) {
          if (!visited.has(id)) {
            if (visited.size >= limit) {
              truncated = true;
              continue;
            }
            visited.add(id);
            next.add(id);
          }
        }
      }
      frontier = [...next];
    }

    const nodes = await this.loadSymbols(workspaceId, [...visited]);
    const visible = new Set(nodes.map((node) => node.id));
    return {
      nodes,
      edges: [...edges.values()].filter((edge) => visible.has(edge.sourceSymbolId) && visible.has(edge.targetSymbolId)),
      truncated,
      depth,
      centerSymbolId: center.id,
    };
  }

  async deleteWorkspace(workspaceId: string): Promise<void> {
    const projects = await AgentCodeGraphProject.query().where('workspace_id', workspaceId).get();
    await Connection.transaction(async () => {
      for (const project of projects) await this.deleteProject(String(project.getAttribute('id')));
    });
  }

  private async loadSymbols(workspaceId: string, ids: string[]): Promise<CodeGraphSymbol[]> {
    if (!ids.length) return [];
    const output: CodeGraphSymbol[] = [];
    for (let offset = 0; offset < ids.length; offset += 400) {
      const batch = ids.slice(offset, offset + 400);
      const rows = await Connection.raw(`
        SELECT s.*, f.path, f.language, p.name AS project_name, p.relative_path AS project_relative_path
        FROM agent_code_graph_symbols s
        JOIN agent_code_graph_projects p ON p.id = s.project_id
        LEFT JOIN agent_code_graph_files f ON f.id = s.file_id
        WHERE s.workspace_id = ?
          AND s.revision_id = p.current_revision_id
          AND s.id IN (${placeholders(batch.length)})
      `, [workspaceId, ...batch]) as RawRow[];
      output.push(...rows.map(mapSymbol));
    }
    return output;
  }

  private async deleteProject(projectId: string): Promise<void> {
    persistenceCache().delete(projectId);
    await Connection.raw('DELETE FROM agent_code_graph_symbol_search WHERE project_id = ?', [projectId]);
    await AgentCodeGraphEdge.query().where('project_id', projectId).delete();
    await AgentCodeGraphSymbol.query().where('project_id', projectId).delete();
    await AgentCodeGraphFile.query().where('project_id', projectId).delete();
    await AgentCodeGraphRevision.query().where('project_id', projectId).delete();
    await AgentCodeGraphProject.query().where('id', projectId).delete();
  }
}

export const codeGraphRepository = new CodeGraphRepository();
