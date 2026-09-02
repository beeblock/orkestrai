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
import { codeGraphSemanticService } from './CodeGraphSemanticService.js';

const execFileAsync = promisify(execFile);
const INDEXER_VERSION = 3;
const PARSE_CONCURRENCY = 4;
const REPOSITORY_MARKERS = ['.git', 'package.json', 'composer.json', 'src', 'app'];
const WATCHED_SOURCE = /\.(?:[cm]?[jt]sx?|svelte|php)$/i;
const WATCHED_CONTRACT = /(?:^|[._-])(openapi|swagger)(?:[._-]|$).*\.(?:json|ya?ml)$/i;
const IGNORED_WATCH_SEGMENT = /(^|[\\/])(\.git|node_modules|vendor|\.svelte-kit|\.next|\.nuxt|build|dist|release|coverage|target|\.cache)([\\/]|$)/;

export class CodeGraphAccessError extends Error {
  readonly status = 403;

  constructor(readonly mode: Workspace['codeIntelligenceMode']) {
    super(mode === 'manual'
      ? 'Code Intelligence is in manual mode. Agent access is disabled for this workspace.'
      : 'Code Intelligence is disabled for this workspace.');
    this.name = 'CodeGraphAccessError';
  }
}

type IndexState = {
  inFlight: Map<string, Promise<CodeGraphProject>>;
  watchers: Map<string, { workspaceId: string; rootPath: string; watcher: FSWatcher; ready: Promise<void> }>;
  watcherRetryAt: Map<string, number>;
  staleTimers: Map<string, ReturnType<typeof setTimeout>>;
  semanticTimers: Map<string, ReturnType<typeof setTimeout>>;
  parseCache: Map<string, Map<string, { contentHash: string; file: ParsedCodeFile }>>;
  changeVersions: Map<string, number>;
  indexedChangeVersions: Map<string, number>;
  autoReindexing: Map<string, Promise<void>>;
  freshnessCheckedProjects: Set<string>;
};

function indexState(): IndexState {
  const global = globalThis as typeof globalThis & { __orkestraiCodeGraphIndexState?: IndexState };
  global.__orkestraiCodeGraphIndexState ??= {
    inFlight: new Map(),
    watchers: new Map(),
    watcherRetryAt: new Map(),
    staleTimers: new Map(),
    semanticTimers: new Map(),
    parseCache: new Map(),
    changeVersions: new Map(),
    indexedChangeVersions: new Map(),
    autoReindexing: new Map(),
    freshnessCheckedProjects: new Set(),
  };
  // Preserve development HMR state created by an older module shape.
  global.__orkestraiCodeGraphIndexState.parseCache ??= new Map();
  global.__orkestraiCodeGraphIndexState.watcherRetryAt ??= new Map();
  global.__orkestraiCodeGraphIndexState.semanticTimers ??= new Map();
  global.__orkestraiCodeGraphIndexState.changeVersions ??= new Map();
  global.__orkestraiCodeGraphIndexState.indexedChangeVersions ??= new Map();
  global.__orkestraiCodeGraphIndexState.autoReindexing ??= new Map();
  global.__orkestraiCodeGraphIndexState.freshnessCheckedProjects ??= new Set();
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
    this.scheduleSemanticRefresh(workspaceId, false);
    return codeGraphRepository.snapshot(workspaceId);
  }

  /** Agent reads use this gate so a known-stale graph is never returned. */
  async ensureFresh(workspaceId: string): Promise<CodeGraphSnapshot> {
    const workspace = await this.assertWorkspace(workspaceId, true);
    const projects = await this.syncWorkspaceProjects(workspace.id);
    await this.ensureWatchers(workspace.id, projects);
    for (const project of projects) {
      const version = this.state.changeVersions.get(project.id) ?? 0;
      const indexedVersion = this.state.indexedChangeVersions.get(project.id) ?? 0;
      const firstCheckThisProcess = !this.state.freshnessCheckedProjects.has(project.id);
      if (firstCheckThisProcess || project.status !== 'ready' || version > indexedVersion) {
        const timer = this.state.staleTimers.get(project.id);
        if (timer) clearTimeout(timer);
        this.state.staleTimers.delete(project.id);
        await this.runAutoReindex(workspace.id, project.id);
      }
      this.state.freshnessCheckedProjects.add(project.id);
    }
    this.scheduleSemanticRefresh(workspace.id, true);
    return codeGraphRepository.snapshot(workspace.id);
  }

  async applyWorkspaceMode(workspace: Workspace): Promise<void> {
    if (workspace.codeIntelligenceMode === 'disabled') {
      await this.pauseWorkspace(workspace.id);
      this.broadcast(workspace.id);
      return;
    }
    if (workspace.codeIntelligenceMode === 'assisted') {
      await this.ensureFresh(workspace.id);
      return;
    }
    const projects = await this.syncWorkspaceProjects(workspace.id);
    await this.ensureWatchers(workspace.id, projects);
    this.broadcast(workspace.id);
  }

  async pauseWorkspace(workspaceId: string): Promise<void> {
    const semanticTimer = this.state.semanticTimers.get(workspaceId);
    if (semanticTimer) clearTimeout(semanticTimer);
    this.state.semanticTimers.delete(workspaceId);
    for (const [projectId, entry] of this.state.watchers) {
      if (entry.workspaceId === workspaceId) await this.closeWatcher(projectId);
    }
  }

  async assertAvailable(workspaceId: string): Promise<void> {
    await this.assertWorkspace(workspaceId);
  }

  async index(workspaceId: string, options: CodeGraphIndexOptions = {}): Promise<CodeGraphIndexResult> {
    const projects = await this.syncWorkspaceProjects(workspaceId);
    await this.ensureWatchers(workspaceId, projects);
    const selected = options.projectIds?.length
      ? projects.filter((project) => options.projectIds!.includes(project.id))
      : projects;
    if (options.projectIds?.length && selected.length !== new Set(options.projectIds).size) {
      throw new Error('One or more code graph projects do not belong to this workspace.');
    }

    const indexed: CodeGraphProject[] = [];
    for (const project of selected) {
      indexed.push(await this.indexProject(project, options.force ?? false));
      this.state.indexedChangeVersions.set(project.id, this.state.changeVersions.get(project.id) ?? 0);
    }
    const snapshot = await codeGraphRepository.snapshot(workspaceId);
    this.scheduleSemanticRefresh(workspaceId, true);
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

  async revisions(workspaceId: string, projectId?: string, limit = 30) {
    await this.assertWorkspace(workspaceId);
    return codeGraphRepository.revisionSummaries(workspaceId, projectId, limit);
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
    const semanticTimer = this.state.semanticTimers.get(workspaceId);
    if (semanticTimer) clearTimeout(semanticTimer);
    this.state.semanticTimers.delete(workspaceId);
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
    const scanStartedAt = Date.now();
    const scan = await codeGraphFileScanner.scan(project.rootPath);
    const scanMs = Date.now() - scanStartedAt;
    const sourceHash = hash(JSON.stringify(scan.files.map((file) => [file.relativePath, file.contentHash])));
    const currentSourceHash = await codeGraphRepository.currentSourceHash(project.id);
    if (!force && project.status === 'ready' && sourceHash === currentSourceHash) {
      return project;
    }
    const revision = await codeGraphRepository.beginRevision(project.workspaceId, project.id, gitHead);
    try {
      const previousCache = this.state.parseCache.get(project.id);
      const nextCache = new Map<string, { contentHash: string; file: ParsedCodeFile }>();
      let cacheHits = 0;
      let cacheMisses = 0;
      const parseStartedAt = Date.now();
      const parsed = await mapConcurrent(scan.files, PARSE_CONCURRENCY, async (file) => {
        const cached = previousCache?.get(file.relativePath);
        if (cached?.contentHash === file.contentHash) cacheHits += 1;
        else cacheMisses += 1;
        const parsedFile = cached?.contentHash === file.contentHash
          ? cached.file
          : await codeGraphParser.parse(file);
        nextCache.set(file.relativePath, { contentHash: file.contentHash, file: parsedFile });
        return parsedFile;
      });
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
      const resolveMs = Date.now() - resolveStartedAt;
      const removedFiles = previousCache
        ? [...previousCache.keys()].filter((path) => !nextCache.has(path)).length
        : 0;
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
          timings: { scanMs, parseMs, resolveMs, persistMs: 0 },
          indexing: {
            strategy: previousCache ? (force ? 'full' : 'incremental') : 'cold',
            cacheHits,
            cacheMisses,
            changedFiles: cacheMisses + removedFiles,
          },
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
      const retryAt = this.state.watcherRetryAt.get(project.id) ?? 0;
      if (!current && retryAt > Date.now()) continue;
      if (retryAt) this.state.watcherRetryAt.delete(project.id);
      if (current?.rootPath === project.rootPath) {
        await current.ready;
        continue;
      }
      if (current) await this.closeWatcher(project.id);
      const watcher = watch(project.rootPath, {
        ignored: ignoreWatchPath,
        ignoreInitial: true,
        followSymlinks: false,
        awaitWriteFinish: { stabilityThreshold: 250, pollInterval: 100 },
      });
      const ready = new Promise<void>((resolveReady) => {
        let settled = false;
        const settle = () => {
          if (settled) return;
          settled = true;
          resolveReady();
        };
        watcher.once('ready', settle);
        watcher.once('error', settle);
      });
      const changed = (path: string) => {
        if (!WATCHED_SOURCE.test(path) && !WATCHED_CONTRACT.test(basename(path))) return;
        const version = (this.state.changeVersions.get(project.id) ?? 0) + 1;
        this.state.changeVersions.set(project.id, version);
        const prior = this.state.staleTimers.get(project.id);
        if (prior) clearTimeout(prior);
        this.state.staleTimers.set(project.id, setTimeout(() => {
          this.state.staleTimers.delete(project.id);
          void this.handleProjectChange(workspaceId, project.id, version);
        }, 350));
      };
      this.state.watchers.set(project.id, { workspaceId, rootPath: project.rootPath, watcher, ready });
      watcher
        .on('add', changed)
        .on('change', changed)
        .on('unlink', changed)
        .on('error', (error) => {
          const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'unknown';
          console.warn(`[orkestrai] Code graph watcher entered a 30-second backoff after filesystem error (${code}) for project ${project.id}.`);
          this.state.watcherRetryAt.set(project.id, Date.now() + 30_000);
          if (this.state.watchers.get(project.id)?.watcher === watcher) this.state.watchers.delete(project.id);
          void watcher.close().catch(() => undefined);
          void codeGraphRepository.markStale(workspaceId, project.id).then((didChange) => {
            if (didChange) this.broadcast(workspaceId);
          });
        });
      await ready;
    }
  }

  private async handleProjectChange(workspaceId: string, projectId: string, version: number): Promise<void> {
    if ((this.state.indexedChangeVersions.get(projectId) ?? 0) >= version) return;
    const didChange = await codeGraphRepository.markStale(workspaceId, projectId);
    if (didChange) this.broadcast(workspaceId);
    const workspace = await workspaceRepository.getWorkspace(workspaceId);
    if (workspace?.codeIntelligenceMode === 'assisted') {
      await this.runAutoReindex(workspaceId, projectId).catch(() => undefined);
      this.scheduleSemanticRefresh(workspaceId, true);
    }
  }

  private scheduleSemanticRefresh(workspaceId: string, reset: boolean): void {
    const existing = this.state.semanticTimers.get(workspaceId);
    if (existing && !reset) return;
    if (existing) clearTimeout(existing);
    this.state.semanticTimers.set(workspaceId, setTimeout(() => {
      this.state.semanticTimers.delete(workspaceId);
      void (async () => {
        const workspace = await workspaceRepository.getWorkspace(workspaceId);
        if (!workspace || workspace.codeIntelligenceMode !== 'assisted') return;
        const before = await codeGraphSemanticService.status(workspaceId);
        if (before.state === 'ready' || before.totalSymbols === 0) return;
        const after = await codeGraphSemanticService.ensureFresh(workspaceId);
        if (after.builtAt !== before.builtAt || after.state !== before.state) this.broadcast(workspaceId);
      })().catch((error) => {
        const message = error instanceof Error ? error.message.slice(0, 240) : 'Unknown semantic indexing error.';
        console.warn(`[orkestrai] Automatic semantic code index refresh failed for workspace ${workspaceId}: ${message}`);
      });
    }, 750));
  }

  private async runAutoReindex(workspaceId: string, projectId: string): Promise<void> {
    const existing = this.state.autoReindexing.get(projectId);
    if (existing) return existing;
    const pending = (async () => {
      while (true) {
        const workspace = await workspaceRepository.getWorkspace(workspaceId);
        if (!workspace || workspace.codeIntelligenceMode !== 'assisted') return;
        const projects = await this.syncWorkspaceProjects(workspaceId);
        const project = projects.find((candidate) => candidate.id === projectId);
        if (!project) return;
        const version = this.state.changeVersions.get(projectId) ?? 0;
        await this.indexProject(project, false);
        this.state.indexedChangeVersions.set(projectId, version);
        this.state.freshnessCheckedProjects.add(projectId);
        this.broadcast(workspaceId);
        if ((this.state.changeVersions.get(projectId) ?? 0) <= version) return;
      }
    })();
    this.state.autoReindexing.set(projectId, pending);
    try {
      await pending;
    } finally {
      if (this.state.autoReindexing.get(projectId) === pending) this.state.autoReindexing.delete(projectId);
    }
  }

  private async closeWatcher(projectId: string): Promise<void> {
    const timer = this.state.staleTimers.get(projectId);
    if (timer) clearTimeout(timer);
    this.state.staleTimers.delete(projectId);
    this.state.watcherRetryAt.delete(projectId);
    this.state.changeVersions.delete(projectId);
    this.state.indexedChangeVersions.delete(projectId);
    this.state.freshnessCheckedProjects.delete(projectId);
    const entry = this.state.watchers.get(projectId);
    this.state.watchers.delete(projectId);
    this.state.parseCache.delete(projectId);
    await entry?.watcher.close();
  }

  private async assertWorkspace(workspaceId: string, requireAgentAccess = false): Promise<Workspace> {
    const workspace = await workspaceRepository.getWorkspace(workspaceId);
    if (!workspace) throw new Error('Workspace not found.');
    if (workspace.codeIntelligenceMode === 'disabled' || (requireAgentAccess && workspace.codeIntelligenceMode !== 'assisted')) {
      throw new CodeGraphAccessError(workspace.codeIntelligenceMode);
    }
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
