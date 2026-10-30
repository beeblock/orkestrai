import { codeGraphIntelligenceRepository } from '../repositories/CodeGraphIntelligenceRepository.js';
import { loadParseCache, decodeParseCache, encodeParseCache, saveParseCache } from './CodeGraphParseCache.js';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
export { compareGraphRevisions } from './CodeGraphRevisionCompare.js';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Connection } from '@beeblock/svelar/database';
import type { CodeGraphProject, CodeGraphDiagnostic } from '../../domain/code-graph.js';
import type { CodeGraphWriteFile, CodeGraphWriteSymbol, CodeGraphWriteEdge } from '../../application/ports/CodeGraphStore.js';
import type { ParsedCodeFile } from './types.js';
import { codeGraphFileScanner } from './CodeGraphFileScanner.js';
import { codeGraphParser } from './CodeGraphParser.js';
import { codeGraphResolver } from './CodeGraphResolver.js';
import { AgentCodeGraphProject } from '../../domain/models/AgentCodeGraphProject.js';
import { codeGraphRepository } from '../repositories/CodeGraphRepository.js';
export { buildSemanticGraph, searchSemanticGraph } from './CodeGraphSemanticEngine.js';

const execFileAsync = promisify(execFile);
const PARSE_CONCURRENCY = 4;
const { resolutionHash } = createRequire(import.meta.url)(resolve(process.cwd(), 'electron/code-graph-resolution-hash.cjs')) as { resolutionHash(rows: Iterable<{fingerprint:string;confidence:number;metadata_json:string}>): string };
const cache = new Map<string, Map<string, { contentHash: string; file: ParsedCodeFile }>>();
function hash(value: string): string { return createHash('sha256').update(value).digest('hex'); }

async function mapConcurrent<T, R>(items: T[], concurrency: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const output = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await work(items[index]);
    }
  });
  await Promise.all(workers);
  return output;
}

async function readGitHead(root: string): Promise<string | null> {
    try {
      const { stdout } = await execFileAsync('git', ['-C', root, 'rev-parse', 'HEAD'], {
        timeout: 5_000,
        maxBuffer: 128 * 1024,
        windowsHide: true,
      });
      return /^[0-9a-f]{40,64}$/i.test(stdout.trim()) ? stdout.trim() : null;
    } catch {
      return null;
    }
  }

export async function buildCodeGraphProject(project: CodeGraphProject, force: boolean): Promise<CodeGraphProject> {
    const startedAt = Date.now();
    const storedProject = await AgentCodeGraphProject.find(project.id);
    if (!storedProject || storedProject.getAttribute('workspace_id') !== project.workspaceId) throw new Error('Code graph project is no longer available.');
    // A job may have waited in the writer queue while approved roots changed.
    // Read the current persisted root/configuration before any filesystem access.
    project = (await codeGraphRepository.listProjects(project.workspaceId)).find(current => current.id === project.id)!;
    const gitHead = await readGitHead(project.rootPath);
    const scanStartedAt = Date.now();
    const scan = await codeGraphFileScanner.scan(project.rootPath);
    const scanMs = Date.now() - scanStartedAt;
    const sourceHash = hash(JSON.stringify(scan.files.map((file) => [file.relativePath, file.contentHash])));
    const currentSourceHash = await codeGraphRepository.currentSourceHash(project.id);
    const configurationHash = String(storedProject?.getAttribute('config_hash') ?? '');
    const configurationChanged = (project.stats.indexing?.configurationHash ?? storedProject?.getAttribute('indexed_config_hash')) !== configurationHash;
    if (!force && sourceHash === currentSourceHash && !configurationChanged) {
      await storedProject!.update({ status: 'ready', git_head: gitHead, updated_at: new Date().toISOString() });
      return (await codeGraphRepository.listProjects(project.workspaceId)).find(current => current.id === project.id)!;
    }
    const revision = await codeGraphRepository.beginRevision(project.workspaceId, project.id, gitHead);
    try {
      const previousCache = configurationChanged ? undefined : cache.get(project.id);
      const diskCache = await loadParseCache(project.id, configurationHash);
      const parsedWrites: Array<{ path: string; contentHash: string; data: Buffer }> = [];
      const nextCache = new Map<string, { contentHash: string; file: ParsedCodeFile }>();
      let cacheHits = 0;
      let cacheMisses = 0;
      const parseStartedAt = Date.now();
      const parsed = await mapConcurrent(scan.files, PARSE_CONCURRENCY, async (file) => {
        const cached = previousCache?.get(file.relativePath);
        let parsedFile = cached?.contentHash === file.contentHash ? cached.file : decodeParseCache(diskCache.get(file.relativePath), file);
        if (parsedFile) cacheHits++;
        else {
          cacheMisses++;
          parsedFile = await codeGraphParser.parse(file);
          const encoded = encodeParseCache(parsedFile);
          if (encoded) parsedWrites.push({ path: file.relativePath, contentHash: file.contentHash, data: encoded });
        }
        nextCache.set(file.relativePath, { contentHash: file.contentHash, file: parsedFile });
        file.content = ''; // The parser output never needs to retain the full source buffer.
        return parsedFile;
      });
      await saveParseCache(project.workspaceId, project.id, configurationHash, parsedWrites, new Set(scan.files.map(file => file.relativePath)));
      parsedWrites.length = 0;
      diskCache.clear();
      const parseMs = Date.now() - parseStartedAt;
      const resolveStartedAt = Date.now();
      const graph = codeGraphResolver.resolve(parsed);
      const fileKeyByPath = new Map(graph.files.map((file) => [file.relativePath, `file:${file.contentHash}:${file.relativePath}`]));
      const fileKeyBySymbol = new Map<string, string>();
      for (const file of graph.files) {
        const fileKey = fileKeyByPath.get(file.relativePath)!;
        for (const symbol of file.symbols) fileKeyBySymbol.set(symbol.key, fileKey);
      }

      const edgesByFile = new Map<string, number>();
      const edgeGroups = new Map<string, typeof graph.edges>();
      for (const edge of graph.edges) {
        edgesByFile.set(edge.sitePath, (edgesByFile.get(edge.sitePath) ?? 0) + 1);
        const group = edgeGroups.get(edge.sitePath) ?? [];
        group.push(edge);
        edgeGroups.set(edge.sitePath, group);
      }
      const resolutionHashes = new Map<string, string>();
      for (const [path, group] of edgeGroups) {
        group.sort((a,b) => a.fingerprint.localeCompare(b.fingerprint));
        resolutionHashes.set(path, resolutionHash(group.map(edge => ({ fingerprint: edge.fingerprint, confidence: edge.confidence, metadata_json: JSON.stringify(edge.metadata) }))));
      }
      edgeGroups.clear();
      const files: CodeGraphWriteFile[] = graph.files.map((file) => ({
        key: fileKeyByPath.get(file.relativePath)!,
        path: file.relativePath,
        language: file.language,
        contentHash: file.contentHash,
        resolutionHash: resolutionHashes.get(file.relativePath) ?? resolutionHash([]),
        byteSize: file.byteSize,
        generated: file.generated,
        symbolCount: file.symbols.length,
        edgeCount: edgesByFile.get(file.relativePath) ?? 0,
        modifiedAt: file.modifiedAt,
      }));
      // Reuse the resolved records instead of duplicating hundreds of thousands of objects.
      const symbols: CodeGraphWriteSymbol[] = graph.symbols.map(symbol => Object.assign(symbol, { fileKey: fileKeyBySymbol.get(symbol.key) ?? null }));
      const edges: CodeGraphWriteEdge[] = graph.edges.map(edge => Object.assign(edge, { siteFileKey: fileKeyByPath.get(edge.sitePath) ?? null }));
      // Keep a bounded parse cache. Non-cached references can be released before SQL planning.
      let retainedReferences = 0;
      for (const [path, entry] of nextCache) {
        retainedReferences += entry.file.references.length;
        if (retainedReferences > 100_000) {
          nextCache.delete(path);
          entry.file.references = [];
        }
      }
      const diagnostics = [...scan.diagnostics, ...graph.diagnostics].slice(0, 500);
      const resolveMs = Date.now() - resolveStartedAt;
      const scannedPaths = new Set(scan.files.map(file => file.relativePath));
      const removedFiles = previousCache
        ? [...previousCache.keys()].filter((path) => !scannedPaths.has(path)).length
        : 0;
      const languages = graph.files.reduce<Record<string, number>>((counts, file) => {
        counts[file.language] = (counts[file.language] ?? 0) + 1;
        return counts;
      }, {});
      previousCache?.clear();
      const committed = await codeGraphRepository.commitRevision({
        workspaceId: project.workspaceId,
        projectId: project.id,
        revisionId: revision.id,
        sourceHash,
        fullReplace: force || configurationChanged,
        gitHead,
        stats: {
          files: files.length,
          symbols: symbols.length,
          edges: edges.length,
          skipped: scan.skipped,
          durationMs: Date.now() - startedAt,
          languages,
          timings: { scanMs, parseMs, resolveMs, persistMs: 0 },
          indexing: {
            strategy: previousCache ? (force ? 'full' : 'incremental') : 'cold',
            cacheHits,
            cacheMisses,
            changedFiles: cacheMisses + removedFiles,
            configurationHash,
          },
        },
        diagnostics,
        files,
        symbols,
        edges,
      });
      cache.clear();
      if (nextCache.size <= 20_000) cache.set(project.id, nextCache);
      return committed;
    } catch (error) {
      const diagnostics: CodeGraphDiagnostic[] = [{
        path: null,
        severity: 'error',
        code: 'index_failed',
        message: error instanceof Error ? error.message.slice(0, 300) : 'Code graph indexing failed.',
      }];
      await codeGraphRepository.failRevision(project.workspaceId, project.id, revision.id, diagnostics).catch(() => undefined);
      throw error;
    }

}

export function configureGraphBuildConnection(filename: string, query: (sql: string, bindings: unknown[]) => any, transaction: <T>(callback: () => Promise<T>) => Promise<T>): void {
  Connection.configure({default:'sqlite',connections:{sqlite:{driver:'sqlite',filename}}});
  Connection.raw = async (sql, bindings = []) => query(sql, bindings.map(value => value instanceof Date ? value.toISOString() : typeof value === 'boolean' ? Number(value) : value));
  Connection.transaction = transaction;
}

export function readGraphAnalysis(workspaceId: string, nodeLimit: number, edgeLimit: number) { return codeGraphRepository.analysisGraph(workspaceId, nodeLimit, edgeLimit); }

export function readSemanticGraphStatus(workspaceId: string, model: string) { return codeGraphIntelligenceRepository.semanticStatus(workspaceId, model); }
