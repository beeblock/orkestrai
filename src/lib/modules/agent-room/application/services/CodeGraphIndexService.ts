import { buildCodeGraphProject } from '../../infrastructure/code-graph/CodeGraphBuildEngine.js';
import { codeGraphConnectionName, buildGraphInWorker } from '$lib/database/code-graph-storage.js';
import { createHash } from 'node:crypto';
import type { Stats } from 'node:fs';
import { access, realpath, stat } from 'node:fs/promises';
import { basename, relative, resolve, sep } from 'node:path';
import { watch, type FSWatcher } from 'chokidar';
import type { CodeGraphProjectRoot } from '../ports/CodeGraphStore.js';
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
import { codeGraphRepository } from '../../infrastructure/repositories/CodeGraphRepository.js';
import { workspaceRepository } from '../../infrastructure/repositories/WorkspaceRepository.js';
import { codeGraphSemanticService } from './CodeGraphSemanticService.js';
import { codeGraphGeneratedRoots, isCodeGraphGeneratedPath } from '../../infrastructure/code-graph/CodeGraphSourcePolicy.js';

const INDEXER_VERSION = 5;
const REPOSITORY_MARKERS = ['.git', 'package.json', 'composer.json', 'src', 'app'];
const WATCHED_SOURCE = /\.(?:[cm]?[jt]sx?|svelte|php)$/i;
const WATCHED_CONTRACT = /(?:^|[._-])(openapi|swagger)(?:[._-]|$).*\.(?:json|ya?ml)$/i;
const IGNORED_WATCH_SEGMENT = /(^|[\\/])(\.git|\.orkestrai|node_modules|vendor|\.svelte-kit|\.next|\.nuxt|build|dist|release|coverage|target|\.cache)([\\/]|$)/;

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
  watcherFailures: Map<string, number>;
  watcherClosing: Map<string, Promise<void>>;
  pollingProjects: Set<string>;
  staleTimers: Map<string, ReturnType<typeof setTimeout>>;
  semanticTimers: Map<string, ReturnType<typeof setTimeout>>;
  backgroundFailures: Map<string, number>;
  backgroundRetryAt: Map<string, number>;
  backgroundRetryTimers: Map<string, ReturnType<typeof setTimeout>>;
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
    watcherFailures: new Map(),
    watcherClosing: new Map(),
    pollingProjects: new Set(),
    staleTimers: new Map(),
    semanticTimers: new Map(),
    backgroundFailures: new Map(),
    backgroundRetryAt: new Map(),
    backgroundRetryTimers: new Map(),
    changeVersions: new Map(),
    indexedChangeVersions: new Map(),
    autoReindexing: new Map(),
    freshnessCheckedProjects: new Set(),
  };
  // Preserve development HMR state created by an older module shape.
  global.__orkestraiCodeGraphIndexState.backgroundFailures ??= new Map();
  global.__orkestraiCodeGraphIndexState.backgroundRetryAt ??= new Map();
  global.__orkestraiCodeGraphIndexState.backgroundRetryTimers ??= new Map();
  global.__orkestraiCodeGraphIndexState.watcherRetryAt ??= new Map();
  global.__orkestraiCodeGraphIndexState.watcherFailures ??= new Map();
  global.__orkestraiCodeGraphIndexState.watcherClosing ??= new Map();
  global.__orkestraiCodeGraphIndexState.pollingProjects ??= new Set();
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

export class CodeGraphPreparingError extends Error {
  readonly code = 'graph_preparing';
  readonly status = 425;
  constructor() { super('The first code graph is preparing in the background. Continue with bounded file search now; do not wait or repeatedly rebuild the index.'); }
}

export class CodeGraphIndexService {
  private state = indexState();

  async status(workspaceId: string): Promise<CodeGraphSnapshot> {
    const projects = await this.syncWorkspaceProjects(workspaceId);
    await this.ensureWatchers(workspaceId, projects);
    this.scheduleSemanticRefresh(workspaceId, false);
    return codeGraphRepository.snapshot(workspaceId);
  }

  /** Explicit freshness requests wait for the structural index. Interactive reads use availableSnapshot. */
  async ensureFresh(workspaceId: string): Promise<CodeGraphSnapshot> {
    const workspace = await this.assertWorkspace(workspaceId, true);
    const projects = await this.syncWorkspaceProjects(workspace.id);
    await this.ensureWatchers(workspace.id, projects);
    for (const project of projects) {
      const version = this.state.changeVersions.get(project.id) ?? 0;
      const indexedVersion = this.state.indexedChangeVersions.get(project.id) ?? 0;
      const firstCheckThisProcess = !this.state.freshnessCheckedProjects.has(project.id);
      if (firstCheckThisProcess || !this.state.watchers.has(project.id) || project.status !== 'ready' || version > indexedVersion) {
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

  /** Interactive reads keep using a committed snapshot while freshness work runs in the background. */
  async availableSnapshot(workspaceId: string): Promise<CodeGraphSnapshot> {
    await this.assertWorkspace(workspaceId, true);
    const snapshot = await codeGraphRepository.snapshot(workspaceId);
    void this.ensureFresh(workspaceId).catch(error => {
      console.warn(`[code-graph] Background refresh failed for ${workspaceId}: ${error instanceof Error ? error.message.slice(0, 240) : 'Unknown error'}`);
    });
    if (!snapshot.projects.some(project => project.currentRevisionId)) throw new CodeGraphPreparingError();
    return snapshot;
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
      const result = await pending;
      this.state.backgroundFailures.delete(project.id);
      this.state.backgroundRetryAt.delete(project.id);
      const timer = this.state.backgroundRetryTimers.get(project.id);
      if (timer) clearTimeout(timer);
      this.state.backgroundRetryTimers.delete(project.id);
      return result;
    } catch (error) {
      const failures = (this.state.backgroundFailures.get(project.id) ?? 0) + 1;
      const delay = Math.min(30_000 * 2 ** Math.min(failures - 1, 4), 300_000);
      this.state.backgroundFailures.set(project.id, failures);
      this.state.backgroundRetryAt.set(project.id, Date.now() + delay);
      const previous = this.state.backgroundRetryTimers.get(project.id);
      if (previous) clearTimeout(previous);
      const timer = setTimeout(() => {
        this.state.backgroundRetryTimers.delete(project.id);
        void this.runAutoReindex(project.workspaceId, project.id).catch(() => undefined);
      }, delay);
      timer.unref?.();
      this.state.backgroundRetryTimers.set(project.id, timer);
      throw error;
    } finally {
      if (this.state.inFlight.get(project.id) === pending) this.state.inFlight.delete(project.id);
    }
  }

  private async buildRevision(project: CodeGraphProject, force: boolean): Promise<CodeGraphProject> {
    if (codeGraphConnectionName()) return buildGraphInWorker(project, force);
    return buildCodeGraphProject(project, force);
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
      await this.state.watcherClosing.get(project.id);
      const current = this.state.watchers.get(project.id);
      const retryAt = this.state.watcherRetryAt.get(project.id) ?? 0;
      if (!current && retryAt > Date.now()) continue;
      if (retryAt) this.state.watcherRetryAt.delete(project.id);
      if (current?.rootPath === project.rootPath) {
        await current.ready;
        continue;
      }
      if (current) await this.closeWatcher(project.id);
      const generatedRoots = await codeGraphGeneratedRoots(project.rootPath);
      const watcher = watch(project.rootPath, {
        // Match descendants, not ancestors: an explicitly approved Floor root
        // inside .orkestrai must still be indexable in its own right.
        ignored: (path, info) => {
          const local = relative(project.rootPath, path);
          return isCodeGraphGeneratedPath(local, generatedRoots) || ignoreWatchPath(local, info);
        },
        ignoreInitial: true,
        followSymlinks: false,
        // macOS fs.watch uses native FSEvents; descriptor pressure can abort the
        // Electron server before JavaScript can catch an error. Poll source
        // metadata instead, also as a fallback on exhausted Linux/Windows hosts.
        usePolling: process.platform === 'darwin' || this.state.pollingProjects.has(project.id),
        interval: 1_000,
        binaryInterval: 1_000,
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
          void this.handleProjectChange(workspaceId, project.id, version).catch(() => {
            this.state.freshnessCheckedProjects.delete(project.id);
          });
        }, 350));
      };
      this.state.watchers.set(project.id, { workspaceId, rootPath: project.rootPath, watcher, ready });
      watcher
        .on('add', changed)
        .on('change', changed)
        .on('unlink', changed)
        .on('error', (error) => {
          // A failing traversal can emit hundreds of errors. Close once and
          // never overlap its teardown with a replacement watcher.
          if (this.state.watchers.get(project.id)?.watcher !== watcher) return;
          const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'unknown';
          const failures = (this.state.watcherFailures.get(project.id) ?? 0) + 1;
          this.state.watcherFailures.set(project.id, failures);
          const backoff = Math.min(300_000, 30_000 * 2 ** Math.min(failures - 1, 4));
          console.warn(`[orkestrai] Code graph watcher paused for ${backoff / 1_000}s after filesystem error (${code}) for project ${project.id}.`);
          this.state.watcherRetryAt.set(project.id, Date.now() + backoff);
          if (['EMFILE', 'ENFILE', 'ENOSPC'].includes(code)) this.state.pollingProjects.add(project.id);
          this.state.watchers.delete(project.id);
          this.state.freshnessCheckedProjects.delete(project.id);
          const closing = watcher.close().catch(() => undefined).finally(() => {
            if (this.state.watcherClosing.get(project.id) === closing) this.state.watcherClosing.delete(project.id);
          });
          // Chokidar.close removes listeners synchronously, but already-running
          // filesystem callbacks may still emit errors during teardown.
          watcher.on('error', () => undefined);
          this.state.watcherClosing.set(project.id, closing);
          void codeGraphRepository.markStale(workspaceId, project.id).then((didChange) => {
            if (didChange) this.broadcast(workspaceId);
          }).catch(() => undefined);
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
    if ((this.state.backgroundRetryAt.get(projectId) ?? 0) > Date.now()) return;
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
    this.state.watcherFailures.delete(projectId);
    this.state.pollingProjects.delete(projectId);
    await this.state.watcherClosing.get(projectId);
    this.state.changeVersions.delete(projectId);
    this.state.indexedChangeVersions.delete(projectId);
    this.state.freshnessCheckedProjects.delete(projectId);
    const entry = this.state.watchers.get(projectId);
    this.state.watchers.delete(projectId);
    const retryTimer = this.state.backgroundRetryTimers.get(projectId);
    if (retryTimer) clearTimeout(retryTimer);
    this.state.backgroundRetryTimers.delete(projectId);
    this.state.backgroundRetryAt.delete(projectId);
    this.state.backgroundFailures.delete(projectId);
    if (entry) {
      const closing = entry.watcher.close();
      entry.watcher.on('error', () => undefined);
      await closing;
    }
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

  private broadcast(workspaceId: string): void {
    const broadcast = (globalThis as typeof globalThis & {
      __orkestraiBroadcast?: (payload: Record<string, unknown>) => void;
    }).__orkestraiBroadcast;
    broadcast?.({ type: 'codeGraphChanged', workspaceId });
  }
}

export const codeGraphIndexService = new CodeGraphIndexService();
