import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import type { Stats } from 'node:fs';
import { access, realpath, stat } from 'node:fs/promises';
import { basename, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { watch, type FSWatcher } from 'chokidar';
import type { CodeGraphProjectRoot, CodeGraphWriteEdge, CodeGraphWriteFile, CodeGraphWriteSymbol } from '../ports/CodeGraphStore.js';
import type {
  CodeGraphDiagnostic,
  CodeGraphIndexOptions,
  CodeGraphIndexResult,
  CodeGraphProject,
  CodeGraphSearchOptions,
  CodeGraphSnapshot,
  CodeGraphSubgraph,
  CodeGraphSymbol,
  CodeGraphTraversalOptions,
} from '../../domain/code-graph.js';
import type { Workspace } from '../../domain/types.js';
import { codeGraphFileScanner } from '../../infrastructure/code-graph/CodeGraphFileScanner.js';
import { codeGraphParser } from '../../infrastructure/code-graph/CodeGraphParser.js';
import { codeGraphResolver } from '../../infrastructure/code-graph/CodeGraphResolver.js';
import type { ParsedCodeFile } from '../../infrastructure/code-graph/types.js';
import { codeGraphRepository } from '../../infrastructure/repositories/CodeGraphRepository.js';
import { workspaceRepository } from '../../infrastructure/repositories/WorkspaceRepository.js';

const execFileAsync = promisify(execFile);
const INDEXER_VERSION = 3;
const PARSE_CONCURRENCY = 4;
const REPOSITORY_MARKERS = ['.git', 'package.json', 'composer.json', 'src', 'app'];
const WATCHED_SOURCE = /\.(?:[cm]?[jt]sx?|svelte|php)$/i;
const WATCHED_CONTRACT = /(?:^|[._-])(openapi|swagger)(?:[._-]|$).*\.(?:json|ya?ml)$/i;
const IGNORED_WATCH_SEGMENT = /(^|[\\/])(\.git|node_modules|vendor|\.svelte-kit|\.next|\.nuxt|build|dist|release|coverage|target|\.cache)([\\/]|$)/;

type IndexState = {
  inFlight: Map<string, Promise<CodeGraphProject>>;
  watchers: Map<string, { workspaceId: string; rootPath: string; watcher: FSWatcher }>;
  staleTimers: Map<string, ReturnType<typeof setTimeout>>;
  parseCache: Map<string, Map<string, { contentHash: string; file: ParsedCodeFile }>>;
};

function indexState(): IndexState {
  const global = globalThis as typeof globalThis & { __orkestraiCodeGraphIndexState?: IndexState };
  global.__orkestraiCodeGraphIndexState ??= {
    inFlight: new Map(),
    watchers: new Map(),
    staleTimers: new Map(),
    parseCache: new Map(),
  };
  // Preserve development HMR state created by an older module shape.
  global.__orkestraiCodeGraphIndexState.parseCache ??= new Map();
  return global.__orkestraiCodeGraphIndexState;
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function portablePath(value: string): string {
  return value.split(sep).join('/');
}

function isInside(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..');
}

function ignoreWatchPath(path: string, info?: Stats): boolean {
  if (IGNORED_WATCH_SEGMENT.test(path)) return true;
  if (!info || info.isDirectory()) return false;
  if (!info.isFile()) return true;
  return !WATCHED_SOURCE.test(path) && !WATCHED_CONTRACT.test(basename(path));
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(() => true).catch(() => false);
}

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

export class CodeGraphIndexService {
  private state = indexState();

  async status(workspaceId: string): Promise<CodeGraphSnapshot> {
    const projects = await this.syncWorkspaceProjects(workspaceId);
    await this.ensureWatchers(workspaceId, projects);
    return codeGraphRepository.snapshot(workspaceId);
  }

  async index(workspaceId: string, options: CodeGraphIndexOptions = {}): Promise<CodeGraphIndexResult> {
    const projects = await this.syncWorkspaceProjects(workspaceId);
    const selected = options.projectIds?.length
      ? projects.filter((project) => options.projectIds!.includes(project.id))
      : projects;
    if (options.projectIds?.length && selected.length !== new Set(options.projectIds).size) {
      throw new Error('One or more code graph projects do not belong to this workspace.');
    }

    const indexed: CodeGraphProject[] = [];
    for (const project of selected) indexed.push(await this.indexProject(project, options.force ?? false));
    const snapshot = await codeGraphRepository.snapshot(workspaceId);
    this.broadcast(workspaceId);
    return { projects: indexed, stats: snapshot.totals };
  }

  async search(workspaceId: string, options: CodeGraphSearchOptions): Promise<CodeGraphSymbol[]> {
    await this.assertWorkspace(workspaceId);
    return codeGraphRepository.search(workspaceId, options);
  }

  async symbol(workspaceId: string, symbolId: string): Promise<CodeGraphSymbol | null> {
    await this.assertWorkspace(workspaceId);
    return codeGraphRepository.symbol(workspaceId, symbolId);
  }

  async overview(workspaceId: string, projectId?: string, limit?: number): Promise<CodeGraphSubgraph> {
    await this.assertWorkspace(workspaceId);
    return codeGraphRepository.overview(workspaceId, projectId, limit);
  }

  async subgraph(workspaceId: string, options: CodeGraphTraversalOptions): Promise<CodeGraphSubgraph> {
    await this.assertWorkspace(workspaceId);
    return codeGraphRepository.subgraph(workspaceId, options);
  }

  async removeWorkspace(workspaceId: string): Promise<void> {
    const projects = await codeGraphRepository.listProjects(workspaceId);
    for (const project of projects) await this.closeWatcher(project.id);
    await codeGraphRepository.deleteWorkspace(workspaceId);
  }

  private async indexProject(project: CodeGraphProject, force: boolean): Promise<CodeGraphProject> {
    const existing = this.state.inFlight.get(project.id);
    if (existing) return existing;
    const pending = this.buildRevision(project, force);
    this.state.inFlight.set(project.id, pending);
    try {
      return await pending;
    } finally {
      if (this.state.inFlight.get(project.id) === pending) this.state.inFlight.delete(project.id);
    }
  }

  private async buildRevision(project: CodeGraphProject, force: boolean): Promise<CodeGraphProject> {
    const startedAt = Date.now();
    const gitHead = await this.gitHead(project.rootPath);
    const scan = await codeGraphFileScanner.scan(project.rootPath);
    const sourceHash = hash(JSON.stringify(scan.files.map((file) => [file.relativePath, file.contentHash])));
    const currentSourceHash = await codeGraphRepository.currentSourceHash(project.id);
    if (!force && project.status === 'ready' && sourceHash === currentSourceHash) {
      return project;
    }
    const revision = await codeGraphRepository.beginRevision(project.workspaceId, project.id, gitHead);
    try {
      const previousCache = this.state.parseCache.get(project.id);
      const nextCache = new Map<string, { contentHash: string; file: ParsedCodeFile }>();
      const parsed = await mapConcurrent(scan.files, PARSE_CONCURRENCY, async (file) => {
        const cached = previousCache?.get(file.relativePath);
        const parsedFile = cached?.contentHash === file.contentHash
          ? cached.file
          : await codeGraphParser.parse(file);
        nextCache.set(file.relativePath, { contentHash: file.contentHash, file: parsedFile });
        return parsedFile;
      });
      const graph = codeGraphResolver.resolve(parsed);
      const fileKeyByPath = new Map(graph.files.map((file) => [file.relativePath, `file:${file.contentHash}:${file.relativePath}`]));
      const fileKeyBySymbol = new Map<string, string>();
      for (const file of graph.files) {
        const fileKey = fileKeyByPath.get(file.relativePath)!;
        for (const symbol of file.symbols) fileKeyBySymbol.set(symbol.key, fileKey);
      }

      const edgesByFile = new Map<string, number>();
      for (const edge of graph.edges) {
        edgesByFile.set(edge.sitePath, (edgesByFile.get(edge.sitePath) ?? 0) + 1);
      }
      const files: CodeGraphWriteFile[] = graph.files.map((file) => ({
        key: fileKeyByPath.get(file.relativePath)!,
        path: file.relativePath,
        language: file.language,
        contentHash: file.contentHash,
        byteSize: file.byteSize,
        generated: file.generated,
        symbolCount: file.symbols.length,
        edgeCount: edgesByFile.get(file.relativePath) ?? 0,
        modifiedAt: file.modifiedAt,
      }));
      const symbols: CodeGraphWriteSymbol[] = graph.symbols.map((symbol) => ({
        key: symbol.key,
        fileKey: fileKeyBySymbol.get(symbol.key) ?? null,
        parentKey: symbol.parentKey,
        kind: symbol.kind,
        name: symbol.name,
        qualifiedName: symbol.qualifiedName,
        signature: symbol.signature,
        documentation: symbol.documentation,
        modifiers: symbol.modifiers,
        metadata: symbol.metadata,
        exported: symbol.exported,
        startLine: symbol.startLine,
        startColumn: symbol.startColumn,
        endLine: symbol.endLine,
        endColumn: symbol.endColumn,
        fingerprint: symbol.fingerprint,
      }));
      const edges: CodeGraphWriteEdge[] = graph.edges.map((edge) => ({
        sourceKey: edge.sourceKey,
        targetKey: edge.targetKey,
        siteFileKey: fileKeyByPath.get(edge.sitePath) ?? null,
        kind: edge.kind,
        confidence: edge.confidence,
        siteLine: edge.siteLine,
        siteColumn: edge.siteColumn,
        metadata: edge.metadata,
        fingerprint: edge.fingerprint,
      }));
      const diagnostics = [...scan.diagnostics, ...graph.diagnostics].slice(0, 500);
      const languages = graph.files.reduce<Record<string, number>>((counts, file) => {
        counts[file.language] = (counts[file.language] ?? 0) + 1;
        return counts;
      }, {});
      const committed = await codeGraphRepository.commitRevision({
        workspaceId: project.workspaceId,
        projectId: project.id,
        revisionId: revision.id,
        sourceHash,
        fullReplace: force || (project.status === 'stale' && sourceHash === currentSourceHash),
        gitHead,
        stats: {
          files: files.length,
          symbols: symbols.length,
          edges: edges.length,
          skipped: scan.skipped,
          durationMs: Date.now() - startedAt,
          languages,
        },
        diagnostics,
        files,
        symbols,
        edges,
      });
      this.state.parseCache.set(project.id, nextCache);
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

  private async syncWorkspaceProjects(workspaceId: string): Promise<CodeGraphProject[]> {
    const workspace = await this.assertWorkspace(workspaceId);
    const roots = await this.projectRoots(workspace);
    return codeGraphRepository.syncProjects(workspaceId, roots);
  }

  private async ensureWatchers(workspaceId: string, projects: CodeGraphProject[]): Promise<void> {
    const active = new Set(projects.map((project) => project.id));
    for (const [projectId, entry] of this.state.watchers) {
      if (entry.workspaceId === workspaceId && !active.has(projectId)) await this.closeWatcher(projectId);
    }
    for (const project of projects) {
      const current = this.state.watchers.get(project.id);
      if (current?.rootPath === project.rootPath) continue;
      if (current) await this.closeWatcher(project.id);
      const watcher = watch(project.rootPath, {
        ignored: ignoreWatchPath,
        ignoreInitial: true,
        followSymlinks: false,
        awaitWriteFinish: { stabilityThreshold: 250, pollInterval: 100 },
      });
      const changed = (path: string) => {
        if (!WATCHED_SOURCE.test(path) && !WATCHED_CONTRACT.test(basename(path))) return;
        const prior = this.state.staleTimers.get(project.id);
        if (prior) clearTimeout(prior);
        this.state.staleTimers.set(project.id, setTimeout(() => {
          this.state.staleTimers.delete(project.id);
          void codeGraphRepository.markStale(workspaceId, project.id).then((didChange) => {
            if (didChange) this.broadcast(workspaceId);
          });
        }, 350));
      };
      watcher
        .on('add', changed)
        .on('change', changed)
        .on('unlink', changed)
        .on('error', (error) => {
          const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'unknown';
          console.warn(`[orkestrai] Code graph watcher ignored a filesystem error (${code}) for project ${project.id}.`);
        });
      this.state.watchers.set(project.id, { workspaceId, rootPath: project.rootPath, watcher });
    }
  }

  private async closeWatcher(projectId: string): Promise<void> {
    const timer = this.state.staleTimers.get(projectId);
    if (timer) clearTimeout(timer);
    this.state.staleTimers.delete(projectId);
    const entry = this.state.watchers.get(projectId);
    this.state.watchers.delete(projectId);
    this.state.parseCache.delete(projectId);
    await entry?.watcher.close();
  }

  private async assertWorkspace(workspaceId: string): Promise<Workspace> {
    const workspace = await workspaceRepository.getWorkspace(workspaceId);
    if (!workspace) throw new Error('Workspace not found.');
    return workspace;
  }

  private async projectRoots(workspace: Workspace): Promise<CodeGraphProjectRoot[]> {
    const primary = await realpath(resolve(workspace.workingDir));
    if (!(await stat(primary)).isDirectory()) throw new Error('Workspace directory is not available.');
    const explicit = await Promise.all((workspace.repositoryRoots ?? []).map(async (root) => ({
      alias: root.alias.toLowerCase(),
      path: await realpath(resolve(root.path)),
    })));
    const candidates: Array<{ name: string; rootPath: string; relativePath: string | null }> = [];
    if (!explicit.length || await this.looksLikeRepository(primary)) {
      candidates.push({ name: workspace.name, rootPath: primary, relativePath: '.' });
    }
    for (const root of explicit) {
      if (!(await stat(root.path)).isDirectory()) continue;
      candidates.push({
        name: root.alias || basename(root.path),
        rootPath: root.path,
        relativePath: isInside(primary, root.path) ? portablePath(relative(primary, root.path)) || '.' : `@${root.alias}`,
      });
    }

    const unique = new Map<string, CodeGraphProjectRoot>();
    for (const candidate of candidates) {
      unique.set(candidate.rootPath, {
        ...candidate,
        configHash: hash(JSON.stringify({ version: INDEXER_VERSION, root: candidate.rootPath })),
      });
    }
    return [...unique.values()];
  }

  private async looksLikeRepository(root: string): Promise<boolean> {
    const results = await Promise.all(REPOSITORY_MARKERS.map((marker) => exists(resolve(root, marker))));
    return results.some(Boolean);
  }

  private async gitHead(root: string): Promise<string | null> {
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

  private broadcast(workspaceId: string): void {
    const broadcast = (globalThis as typeof globalThis & {
      __orkestraiBroadcast?: (payload: Record<string, unknown>) => void;
    }).__orkestraiBroadcast;
    broadcast?.({ type: 'codeGraphChanged', workspaceId });
  }
}

export const codeGraphIndexService = new CodeGraphIndexService();
