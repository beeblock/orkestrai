import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { access, chmod, copyFile, lstat, mkdir, readdir, readFile, realpath, rm, stat, symlink, unlink, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname, join, win32 } from 'node:path';
import { uuidv7 } from '@beeblock/svelar/support';
import type { Floor, HookCommand, Workspace, WorkspaceHooks } from '../../domain/types.js';
import { AgentFloor } from '../../domain/models/AgentFloor.js';
import { AgentBoardTask } from '../../domain/models/AgentBoardTask.js';
import { workspaceRepository } from '../../infrastructure/repositories/WorkspaceRepository.js';
import { ptySessionManager } from '../../infrastructure/pty/PtySessionManager.ts';
import { agentEnv, IS_WIN } from '../../infrastructure/agent-path.js';
import { buildWorkspaceRuntimeLaunch, guestWorkingDirectory, workspaceExecutionRuntime } from '../../infrastructure/WslRuntime.js';
import { assertFreeDisk, DISK_LIMITS, freeDiskBytes } from '../../infrastructure/disk-guard.js';

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 60_000;

export type FloorAudit = {
  floorId: string; name: string; branch: string; path: string;
  target: string; merged: boolean; safeToRemove: boolean;
  blockers: string[]; revision: string; head: string | null;
  integration: 'ancestor' | 'unchanged' | 'patch_equivalent' | 'patch_applied' | 'diverged' | 'unknown';
  changes: { tracked: number; untracked: number; ignored: number; samples: string[]; truncated: boolean };
};

/** Shared process budget: opening several panels must not spawn hundreds of Git processes. */
const gitSlots: Array<() => void> = [];
let activeGit = 0;
export async function withFloorGitSlot<T>(run: () => Promise<T>): Promise<T> {
  if (activeGit >= 4) await new Promise<void>((resume) => gitSlots.push(resume));
  else activeGit++;
  try { return await run(); }
  finally {
    const next = gitSlots.shift();
    if (next) next();
    else activeGit--;
  }
}

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function mapFloor(model: AgentFloor): Floor {
  return {
    id: model.getAttribute('id'),
    workspaceId: model.getAttribute('workspace_id'),
    name: model.getAttribute('name'),
    branch: model.getAttribute('branch'),
    path: model.getAttribute('path'),
    status: model.getAttribute('status'),
    baseCommit: model.getAttribute('base_commit') ?? null,
    baseKind: (model.getAttribute('base_kind') ?? null) as Floor['baseKind'],
    landedHead: model.getAttribute('landed_head') ?? null,
    createdAt: toIso(model.getAttribute('created_at')),
    updatedAt: toIso(model.getAttribute('updated_at')),
  };
}

export type FloorLandResult = {
  merged: boolean;
  branch: string;
  into: string;
  /** merge: a merge commit on a clean checkout; patch: the floor delta applied to the working tree. */
  mode: 'merge' | 'patch';
  files?: number;
  committedPending?: string | null;
  /** The commit that records this landing on the target branch; null only when it failed (see commitError). */
  commit?: string | null;
  commitError?: string;
  cleanup: 'removed' | 'pending';
  cleanupReason?: string;
};

type DeltaChange = { path: string; status: string };
type DeltaPlan = {
  writes: Array<{ path: string; content: Buffer; executable: boolean }>;
  deletes: string[];
  conflicts: string[];
  /** Paths reached through a symbolic link in the checkout: writing there could leave the workspace. */
  unsafe: string[];
  /** Every path of the floor delta; the landing commit covers all of them. */
  paths: string[];
  unchanged: number;
};

/** Package caches stay per checkout: concurrent dev servers must not share them. */
const UNSHARED_DEPENDENCY_ENTRIES = new Set(['.vite', '.vite-temp', '.cache', '.svelte-kit', '.turbo', '.next']);
const SHARED_DEPENDENCIES_MARKER = '.orkestrai-shared';
const SNAPSHOT_MAX_UNTRACKED_BYTES = 50 * 1024 * 1024;
/**
 * Ignored folders that only ever hold test reports and tool caches. Ambiguous
 * names (build, dist, out, target...) are deliberately absent: being ignored
 * does not prove that their contents can be regenerated.
 */
const DISPOSABLE_ARTIFACT_DIRS = new Set([
  'test-results', 'playwright-report', 'blob-report', 'coverage', '.nyc_output', '.svelte-kit', '.vite', '.turbo',
  '.parcel-cache', '__pycache__', '.pytest_cache', '.mypy_cache',
]);
const DEPENDENCY_LOCKFILES = ['package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lockb', 'bun.lock'];
/** Names that can hold secrets or data even inside a cache or report folder. */
const SENSITIVE_NAME = /^(\.env(\..*)?|.*\.(pem|key|p12|pfx|jks|keystore|sqlite3?|db)|id_(rsa|ed25519|ecdsa)(\.pub)?|credentials(\..*)?|secrets?(\..*)?)$/i;
const ARTIFACT_SCAN_LIMIT = 10_000;

/** True when an ignored folder holds no name that could be a secret or data, within a bounded walk. */
async function holdsOnlyArtifacts(path: string): Promise<boolean> {
  let seen = 0;
  const walk = async (dir: string): Promise<boolean> => {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => null);
    if (!entries) return false;
    for (const entry of entries) {
      if (++seen > ARTIFACT_SCAN_LIMIT || SENSITIVE_NAME.test(entry.name) || entry.isSymbolicLink()) return false;
      if (entry.isDirectory() && !(await walk(join(dir, entry.name)))) return false;
    }
    return true;
  };
  return walk(path);
}

/**
 * Ignored entries that the next run regenerates: test reports and tool caches
 * without secret-like names, logs, and installed dependencies next to a
 * lockfile. Anything else ignored (an .env, a build folder) is local work.
 */
async function isDisposableArtifact(root: string, record: string): Promise<boolean> {
  const relative = record.replace(/\\/g, '/').replace(/\/$/, '');
  const parts = relative.split('/').filter(Boolean);
  const name = parts.at(-1) ?? '';
  if (!name || SENSITIVE_NAME.test(name)) return false;
  const absolute = join(root, ...parts);
  const info = await lstat(absolute).catch(() => null);
  if (!info || info.isSymbolicLink()) return false;
  if (info.isFile()) return /\.log$/i.test(name) || parts.slice(0, -1).some((part) => DISPOSABLE_ARTIFACT_DIRS.has(part));
  if (!info.isDirectory()) return false;
  if (name === 'node_modules') {
    const parent = join(root, ...parts.slice(0, -1));
    return DEPENDENCY_LOCKFILES.some((lockfile) => existsSync(join(parent, lockfile)));
  }
  if (!parts.some((part) => DISPOSABLE_ARTIFACT_DIRS.has(part))) return false;
  return holdsOnlyArtifacts(absolute);
}

/**
 * Working directories of this user's processes (POSIX). A dev server an agent
 * started inside a Floor keeps that Floor alive even after its terminal ends.
 */
async function processWorkingDirectories(): Promise<string[] | null> {
  if (IS_WIN) return null;
  try {
    if (process.platform === 'linux') {
      const { readlink } = await import('node:fs/promises');
      const pids = (await readdir('/proc')).filter((entry) => /^\d+$/.test(entry));
      const cwds = await Promise.all(pids.map((pid) => readlink(`/proc/${pid}/cwd`).catch(() => null)));
      return cwds.filter((cwd): cwd is string => Boolean(cwd));
    }
    const { stdout } = await execFileAsync('lsof', ['-a', '-d', 'cwd', '-u', String(process.getuid?.() ?? ''), '-Fn'], {
      timeout: 15_000, maxBuffer: 16 * 1024 * 1024,
    });
    return stdout.split('\n').filter((line) => line.startsWith('n')).map((line) => line.slice(1));
  } catch {
    return null;
  }
}

function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'andar'
  );
}

/**
 * Andares via git worktree: cada andar e um checkout isolado do repo do
 * workspace em `.orkestrai/floors/<slug>` com sua propria branch.
 * Aterrissagem = merge da branch do andar de volta no checkout principal.
 */
/** Avisa o canvas para recarregar o workspace (via broadcast WS global). */
function notifyWorkspaceChanged(workspaceId: string) {
  const broadcast = (globalThis as { __orkestraiBroadcast?: (payload: Record<string, unknown>) => void }).__orkestraiBroadcast;
  broadcast?.({ type: 'workspaceChanged', workspaceId });
}

export class FloorService {
  private mutations = new Set<string>();
  private audits = new Map<string, Promise<FloorAudit[]>>();

  private async exclusive<T>(workspaceId: string, run: () => Promise<T>): Promise<T> {
    const workspace = await this.workspace(workspaceId);
    const key = await realpath(workspace.workingDir);
    if (this.mutations.has(key)) throw new Error('Outra operacao de andar esta em andamento neste repositorio.');
    this.mutations.add(key);
    try { return await run(); } finally { this.mutations.delete(key); }
  }

  async requireFloor(workspaceId: string, id: string): Promise<Floor> {
    const floor = await this.get(id);
    if (!floor || floor.workspaceId !== workspaceId) throw new Error('Andar nao encontrado neste workspace.');
    return floor;
  }

  private async workspace(workspaceId: string): Promise<Workspace> {
    const workspace = await workspaceRepository.getWorkspace(workspaceId);
    if (!workspace) throw new Error('Workspace nao encontrado.');
    return workspace;
  }

  private async git(workspace: Workspace, cwd: string, args: string[], env: Record<string, string> = {}): Promise<string> {
    const launch = buildWorkspaceRuntimeLaunch({
      workspace, command: 'git', args, hostCwd: cwd, hostEnv: { ...agentEnv(), ...env },
      forwardEnvToWsl: Object.keys(env),
    });
    const { stdout } = await withFloorGitSlot(() => execFileAsync(launch.command, launch.args, {
      cwd: launch.cwd,
      env: launch.env,
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
    }));
    return stdout;
  }

  /** Binary-safe blob read (`git show <rev>:<path>`); null when the path does not exist there. */
  private async gitBlob(workspace: Workspace, rev: string, path: string): Promise<Buffer | null> {
    const launch = buildWorkspaceRuntimeLaunch({ workspace, command: 'git', args: ['show', `${rev}:${path}`], hostCwd: workspace.workingDir, hostEnv: agentEnv() });
    try {
      const { stdout } = await withFloorGitSlot(() => execFileAsync(launch.command, launch.args, {
        cwd: launch.cwd, env: launch.env, timeout: GIT_TIMEOUT_MS, maxBuffer: 256 * 1024 * 1024, windowsHide: true, encoding: 'buffer',
      }));
      return stdout as unknown as Buffer;
    } catch {
      return null;
    }
  }

  /** Configured identity, or a local fallback so snapshot/auto commits never fail on a fresh machine. */
  private async identityArgs(workspace: Workspace, cwd: string): Promise<string[]> {
    const email = await this.git(workspace, cwd, ['config', '--get', 'user.email']).then((value) => value.trim(), () => '');
    return email ? [] : ['-c', 'user.name=Orkestrai', '-c', 'user.email=orkestrai@localhost'];
  }

  /**
   * The commit a new floor starts from. With uncommitted work in the main
   * checkout, the floor must still see the code the owner actually has:
   * snapshot tracked and untracked (non-ignored) files into a commit object
   * through a private index, without touching the owner's index or files.
   */
  private async workingTreeBase(workspace: Workspace): Promise<{ commit: string; kind: 'head' | 'snapshot' }> {
    const head = (await this.git(workspace, workspace.workingDir, ['rev-parse', '--verify', 'HEAD'])).trim();
    const status = (await this.git(workspace, workspace.workingDir, ['status', '--porcelain', '--untracked-files=normal'])).trim();
    if (!status) return { commit: head, kind: 'head' };
    const gitDir = (await this.git(workspace, workspace.workingDir, ['rev-parse', '--git-dir'])).trim();
    const indexName = `orkestrai-floor-base-${uuidv7()}`;
    const env = { GIT_INDEX_FILE: `${gitDir}/${indexName}` };
    try {
      await this.git(workspace, workspace.workingDir, ['read-tree', 'HEAD'], env);
      await this.git(workspace, workspace.workingDir, ['add', '-u'], env);
      // Untracked work is included, except very large files (videos, dumps)
      // that would bloat the object store for every floor.
      const pathApi = workspace.runtimeKind === 'wsl' ? win32 : { resolve };
      const untracked = (await this.git(workspace, workspace.workingDir, ['ls-files', '--others', '--exclude-standard', '-z'], env)).split('\0').filter(Boolean);
      const included: string[] = [];
      for (const path of untracked) {
        const size = await stat(pathApi.resolve(workspace.workingDir, path)).then((info) => info.size, () => Number.POSITIVE_INFINITY);
        if (size <= SNAPSHOT_MAX_UNTRACKED_BYTES) included.push(path);
      }
      for (let index = 0; index < included.length; index += 200) {
        await this.git(workspace, workspace.workingDir, ['add', '--', ...included.slice(index, index + 200)], env);
      }
      const tree = (await this.git(workspace, workspace.workingDir, ['write-tree'], env)).trim();
      const identity = await this.identityArgs(workspace, workspace.workingDir);
      const commit = (await this.git(workspace, workspace.workingDir, [...identity, 'commit-tree', tree, '-p', head, '-m', 'Orkestrai floor base (working tree snapshot)'])).trim();
      return { commit, kind: 'snapshot' };
    } finally {
      const pathApi = workspace.runtimeKind === 'wsl' ? win32 : { resolve };
      await rm(pathApi.resolve(workspace.workingDir, gitDir, indexName), { force: true }).catch(() => undefined);
    }
  }

  /**
   * Dependencies are shared through a per-entry link farm: packages resolve
   * from the main checkout while caches such as node_modules/.vite stay per
   * floor, so dev servers in different floors never share an optimizer cache.
   */
  private async shareDependencies(workspace: Workspace, floorPath: string): Promise<number> {
    if (workspace.runtimeKind === 'wsl') return 0;
    let linked = 0;
    const roots = ['.'];
    for (const entry of await readdir(workspace.workingDir, { withFileTypes: true }).catch(() => [])) {
      if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') roots.push(entry.name);
    }
    for (const root of roots) {
      const source = join(workspace.workingDir, root, 'node_modules');
      const target = join(floorPath, root, 'node_modules');
      if (!existsSync(source) || !existsSync(join(floorPath, root, 'package.json')) || existsSync(target)) continue;
      await mkdir(target, { recursive: true });
      await writeFile(join(target, SHARED_DEPENDENCIES_MARKER), 'Links to the main checkout dependencies, created by Orkestrai.\n');
      for (const entry of await readdir(source, { withFileTypes: true })) {
        if (UNSHARED_DEPENDENCY_ENTRIES.has(entry.name)) continue;
        const from = join(source, entry.name);
        const to = join(target, entry.name);
        try {
          if (IS_WIN && !entry.isDirectory() && !entry.isSymbolicLink()) await copyFile(from, to);
          else await symlink(from, to, IS_WIN ? 'junction' : undefined);
          linked++;
        } catch {
          // A missing optional entry must not block the floor.
        }
      }
    }
    return linked;
  }

  /** Commits whatever the floor's agent left uncommitted. Repository hooks still run. */
  async commitPending(floorId: string, message: string): Promise<string | null> {
    const floor = await this.get(floorId);
    if (!floor || floor.status !== 'active') return null;
    const workspace = await this.workspace(floor.workspaceId);
    await this.assertFloorPath(floor, workspace);
    return this.commitInFloor(workspace, floor, message);
  }

  private async commitInFloor(workspace: Workspace, floor: Floor, message: string): Promise<string | null> {
    const status = (await this.git(workspace, floor.path, ['status', '--porcelain', '--untracked-files=all'])).trim();
    if (!status) return null;
    await this.git(workspace, floor.path, ['add', '-A']);
    const identity = await this.identityArgs(workspace, floor.path);
    await this.git(workspace, floor.path, [...identity, 'commit', '-m', message.slice(0, 200)]);
    return (await this.git(workspace, floor.path, ['rev-parse', '--verify', 'HEAD'])).trim();
  }

  /**
   * Records a patch landing as one commit with exactly the floor's files.
   * `--only` leaves every other staged or unstaged change in the checkout as
   * it was, so unrelated local work never rides along. Repository hooks run.
   */
  private async commitLanded(workspace: Workspace, paths: string[], message: string): Promise<string | null> {
    const gitDir = (await this.git(workspace, workspace.workingDir, ['rev-parse', '--git-dir'])).trim();
    const pathApi = workspace.runtimeKind === 'wsl' ? win32 : { resolve };
    const present: string[] = [];
    const removed: string[] = [];
    for (const path of paths) {
      (await lstat(pathApi.resolve(workspace.workingDir, path)).then(() => true, () => false) ? present : removed).push(path);
    }
    // A deletion can already be staged by an earlier, refused attempt: only
    // paths HEAD still has need recording, and git rm tolerates the rest.
    const inHead = new Set<string>();
    for (let index = 0; index < removed.length; index += 200) {
      const listed = await this.git(workspace, workspace.workingDir, ['ls-tree', '-r', '-z', '--name-only', 'HEAD', '--', ...removed.slice(index, index + 200)]);
      for (const path of listed.split('\0').filter(Boolean)) inHead.add(path);
    }
    const commitPaths = [...present, ...removed.filter((path) => inHead.has(path))];
    if (!commitPaths.length) return null;
    const files: string[] = [];
    const specFile = async (list: string[]) => {
      const name = `orkestrai-land-${uuidv7()}`;
      files.push(pathApi.resolve(workspace.workingDir, gitDir, name));
      await writeFile(files.at(-1)!, list.join('\0') + '\0');
      return [`--pathspec-from-file=${gitDir}/${name}`, '--pathspec-file-nul'];
    };
    try {
      // Tracked in the floor means tracked here, even if the checkout ignores the path.
      if (present.length) await this.git(workspace, workspace.workingDir, ['add', '-A', '--force', ...(await specFile(present))]);
      if (removed.length) await this.git(workspace, workspace.workingDir, ['rm', '-q', '--cached', '--ignore-unmatch', ...(await specFile(removed))]);
      const identity = await this.identityArgs(workspace, workspace.workingDir);
      try {
        await this.git(workspace, workspace.workingDir, [...identity, 'commit', '--only', '-m', message, ...(await specFile(commitPaths))]);
      } catch (error) {
        // Already committed (a retried landing): nothing left to record.
        const output = `${(error as { stdout?: unknown }).stdout ?? ''}${(error as { stderr?: unknown }).stderr ?? ''}`;
        if (/nothing to commit|no changes added to commit/i.test(output)) return null;
        throw error;
      }
      return (await this.git(workspace, workspace.workingDir, ['rev-parse', '--verify', 'HEAD'])).trim();
    } finally {
      await Promise.all(files.map((file) => rm(file, { force: true }).catch(() => undefined)));
    }
  }

  /** Where the floor's own work begins: its recorded base, or the merge base for legacy floors. */
  private async floorBase(workspace: Workspace, floor: Floor, head: string): Promise<string> {
    if (floor.baseCommit) return floor.baseCommit;
    return (await this.git(workspace, workspace.workingDir, ['merge-base', 'HEAD', head])).trim();
  }

  /**
   * Plans the floor delta (base..head) against the main working tree with a
   * per-file three-way merge. Nothing is written while any file conflicts.
   */
  private async planDelta(workspace: Workspace, base: string, head: string): Promise<DeltaPlan> {
    const raw = await this.git(workspace, workspace.workingDir, ['diff', '--name-status', '-z', '--no-renames', base, head]);
    const fields = raw.split('\0').filter(Boolean);
    const changes: DeltaChange[] = [];
    for (let index = 0; index + 1 < fields.length; index += 2) changes.push({ status: fields[index], path: fields[index + 1] });
    const plan: DeltaPlan = { writes: [], deletes: [], conflicts: [], unsafe: [], paths: [], unchanged: 0 };
    const treeModes = async (rev: string) => {
      const modes = new Map<string, string>();
      const tree = await this.git(workspace, workspace.workingDir, ['ls-tree', '-r', '-z', rev]);
      for (const record of tree.split('\0').filter(Boolean)) {
        const tab = record.indexOf('\t');
        if (tab > 0) modes.set(record.slice(tab + 1), record.split(' ')[0]);
      }
      return modes;
    };
    const [modes, baseModes] = await Promise.all([treeModes(head), treeModes(base)]);
    // The executable bit is part of the change; Windows checkouts do not track it.
    const tracksMode = !IS_WIN && workspace.runtimeKind !== 'wsl';
    const pathApi = workspace.runtimeKind === 'wsl' ? win32 : { resolve };
    for (const change of changes) {
      const absolute = pathApi.resolve(workspace.workingDir, change.path);
      if (!absolute.startsWith(pathApi.resolve(workspace.workingDir))) {
        plan.conflicts.push(change.path);
        continue;
      }
      const mode = modes.get(change.path) ?? '100644';
      if (mode === '120000' || mode === '160000') {
        plan.conflicts.push(change.path);
        continue;
      }
      if (await this.reachesThroughLink(workspace, change.path)) {
        plan.unsafe.push(change.path);
        continue;
      }
      plan.paths.push(change.path);
      const [baseBlob, theirs] = await Promise.all([
        change.status === 'A' ? Promise.resolve(null) : this.gitBlob(workspace, base, change.path),
        change.status === 'D' ? Promise.resolve(null) : this.gitBlob(workspace, head, change.path),
      ]);
      const ours = await readFile(absolute).catch(() => null);
      const oursExecutable = tracksMode && ours ? await stat(absolute).then((info) => (info.mode & 0o111) !== 0, () => false) : false;
      const theirsExecutable = mode === '100755';
      // The floor's own mode change wins; otherwise the checkout keeps its mode.
      const executable = tracksMode && theirsExecutable !== ((baseModes.get(change.path) ?? '100644') === '100755')
        ? theirsExecutable : tracksMode ? oursExecutable : theirsExecutable;
      const same = (a: Buffer | null, b: Buffer | null) => (a === null && b === null) || Boolean(a && b && a.equals(b));
      if (same(ours, theirs)) {
        if (ours && tracksMode && oursExecutable !== executable) plan.writes.push({ path: change.path, content: ours, executable });
        else plan.unchanged++;
        continue;
      }
      if (same(ours, baseBlob)) {
        if (theirs === null) plan.deletes.push(change.path);
        else plan.writes.push({ path: change.path, content: theirs, executable });
        continue;
      }
      // Both sides changed the file: only text merges cleanly.
      if (!ours || !theirs || !baseBlob || [ours, theirs, baseBlob].some((blob) => blob.includes(0))) {
        plan.conflicts.push(change.path);
        continue;
      }
      const merged = await this.mergeText(workspace, ours, baseBlob, theirs);
      if (merged === null) plan.conflicts.push(change.path);
      else plan.writes.push({ path: change.path, content: merged, executable });
    }
    return plan;
  }

  private async mergeText(workspace: Workspace, ours: Buffer, base: Buffer, theirs: Buffer): Promise<Buffer | null> {
    const gitDir = (await this.git(workspace, workspace.workingDir, ['rev-parse', '--git-dir'])).trim();
    const pathApi = workspace.runtimeKind === 'wsl' ? win32 : { resolve };
    const id = uuidv7();
    const names = ['ours', 'base', 'theirs'].map((side) => `${gitDir}/orkestrai-merge-${id}-${side}`);
    const files = names.map((name) => pathApi.resolve(workspace.workingDir, name));
    try {
      await Promise.all([writeFile(files[0], ours), writeFile(files[1], base), writeFile(files[2], theirs)]);
      const launch = buildWorkspaceRuntimeLaunch({ workspace, command: 'git', args: ['merge-file', '-p', ...names], hostCwd: workspace.workingDir, hostEnv: agentEnv() });
      try {
        const { stdout } = await execFileAsync(launch.command, launch.args, {
          cwd: launch.cwd, env: launch.env, timeout: GIT_TIMEOUT_MS, maxBuffer: 256 * 1024 * 1024, windowsHide: true, encoding: 'buffer',
        });
        return stdout as unknown as Buffer;
      } catch {
        // A positive exit code is the number of conflicts.
        return null;
      }
    } finally {
      await Promise.all(files.map((file) => rm(file, { force: true }).catch(() => undefined)));
    }
  }

  /**
   * True when an existing component of this path in the main checkout is a
   * symbolic link. Writes follow links, so such a path could change files
   * outside the workspace; new components are created as real directories.
   */
  private async reachesThroughLink(workspace: Workspace, path: string): Promise<boolean> {
    const pathApi = workspace.runtimeKind === 'wsl' ? win32 : { join };
    let current = workspace.workingDir;
    for (const part of path.split(/[\\/]/).filter(Boolean)) {
      if (part === '..') return true;
      current = pathApi.join(current, part);
      const info = await lstat(current).catch(() => null);
      if (!info) return false;
      if (info.isSymbolicLink()) return true;
    }
    return false;
  }

  private async applyDelta(workspace: Workspace, plan: DeltaPlan): Promise<number> {
    // All-or-nothing in practice: never start writing files the disk cannot hold.
    const bytes = plan.writes.reduce((total, write) => total + write.content.length, 0);
    await assertFreeDisk(workspace.workingDir, bytes + 256 * 1024 * 1024, 'aterrissar o andar');
    // A link could have appeared since planning; check every target before the first write.
    for (const path of [...plan.writes.map((write) => write.path), ...plan.deletes]) {
      if (await this.reachesThroughLink(workspace, path)) throw new Error(`Aterrissagem recusada: ${path} passa por um link simbólico no checkout principal. Nenhum arquivo foi alterado.`);
    }
    const pathApi = workspace.runtimeKind === 'wsl' ? win32 : { resolve, dirname };
    for (const write of plan.writes) {
      const absolute = pathApi.resolve(workspace.workingDir, write.path);
      await mkdir(pathApi.dirname(absolute), { recursive: true });
      await writeFile(absolute, write.content);
      if (!IS_WIN) {
        const current = await stat(absolute).then((info) => info.mode & 0o777, () => null);
        const next = current === null ? null : write.executable ? current | 0o111 : current & ~0o111;
        if (current !== null && next !== current) await chmod(absolute, next!).catch(() => undefined);
      }
    }
    for (const path of plan.deletes) await unlink(pathApi.resolve(workspace.workingDir, path)).catch(() => undefined);
    return plan.writes.length + plan.deletes.length;
  }

  private async assertRepo(workspace: Workspace) {
    try {
      await this.git(workspace, workspace.workingDir, ['rev-parse', '--is-inside-work-tree']);
    } catch {
      throw new Error('O diretorio do workspace nao e um repositorio git.');
    }
    // Os worktrees vivem em .orkestrai/floors dentro do repo; exclui localmente
    // (info/exclude) para o andar nao sujar o status do checkout principal.
    try {
      const { appendFileSync, existsSync, readFileSync } = await import('node:fs');
      const excludePath = resolve(workspace.workingDir, '.git', 'info', 'exclude');
      const current = existsSync(excludePath) ? readFileSync(excludePath, 'utf8') : '';
      if (!current.includes('.orkestrai')) {
        appendFileSync(excludePath, '\n.orkestrai/\n');
      }
    } catch {
      // exclude e conveniencia; nao bloqueia
    }
  }

  async list(workspaceId: string): Promise<Floor[]> {
    const rows = await AgentFloor.query()
      .where('workspace_id', workspaceId)
      .whereIn('status', ['active', 'landed', 'deleted'])
      .orderBy('created_at', 'asc')
      .get();
    // Legacy versions marked floors landed/deleted even when removal failed.
    // Async, bounded probes also avoid blocking PTY input on slow WSL/UNC paths.
    const floors = rows.map(mapFloor);
    const visible = await Promise.all(floors.map((floor) => floor.status === 'active'
      ? true : withFloorGitSlot(() => access(floor.path).then(() => true, () => false))));
    return floors.filter((_, index) => visible[index]);
  }

  /** One bounded native audit, instead of one model/tool round trip per Git check. No hooks or writes. */
  async audit(workspaceId: string): Promise<FloorAudit[]> {
    const existing = this.audits.get(workspaceId);
    if (existing) return existing;
    const pending = this.loadAudit(workspaceId).finally(() => {
      if (this.audits.get(workspaceId) === pending) this.audits.delete(workspaceId);
    });
    this.audits.set(workspaceId, pending);
    return pending;
  }

  private async loadAudit(workspaceId: string): Promise<FloorAudit[]> {
    const workspace = await this.workspace(workspaceId);
    const [floors, context] = await Promise.all([this.list(workspaceId), this.auditContext(workspace)]);
    return Promise.all(floors.map((floor) => this.inspectFloor(floor, workspace, context)));
  }

  private async auditContext(workspace: Workspace) {
    const [target, targetHead, nodes, tasks, processCwds] = await Promise.all([
      this.currentBranch(workspace),
      this.git(workspace, workspace.workingDir, ['rev-parse', '--verify', 'HEAD']),
      workspaceRepository.listNodes(workspace.id),
      AgentBoardTask.query().where('workspace_id', workspace.id).whereNull('archived_at').where('status', '!=', 'done').get(),
      workspace.runtimeKind === 'wsl' ? Promise.resolve(null) : processWorkingDirectories(),
    ]);
    return { target, targetHead: targetHead.trim(), nodes, tasks, processCwds };
  }

  private async assertFloorPath(floor: Floor, workspace: Workspace) {
    const pathApi = workspace.runtimeKind === 'wsl' ? win32 : { resolve, dirname };
    const expectedParent = pathApi.resolve(workspace.workingDir, '.orkestrai', 'floors');
    if (pathApi.dirname(pathApi.resolve(floor.path)) !== expectedParent) throw new Error('Caminho do andar fora da pasta de worktrees.');
    // A symlinked floor or parent must never redirect a cleanup outside this workspace.
    const [actual, parent, root] = await Promise.all([realpath(floor.path), realpath(expectedParent), realpath(workspace.workingDir)]);
    if (parent !== pathApi.resolve(root, '.orkestrai', 'floors') || pathApi.dirname(actual) !== parent
      || actual !== pathApi.resolve(parent, pathApi === win32 ? win32.basename(floor.path) : floor.path.split('/').at(-1)!)) {
      throw new Error('Caminho do andar redirecionado.');
    }
    const [rootCommon, floorCommon, branch] = await Promise.all([
      this.git(workspace, workspace.workingDir, ['rev-parse', '--path-format=absolute', '--git-common-dir']),
      this.git(workspace, floor.path, ['rev-parse', '--path-format=absolute', '--git-common-dir']),
      this.git(workspace, floor.path, ['branch', '--show-current']),
    ]);
    if (rootCommon.trim() !== floorCommon.trim() || branch.trim() !== floor.branch) throw new Error('Worktree ou branch nao corresponde ao andar registrado.');
  }

  private async inspectFloor(floor: Floor, workspace: Workspace, context: Awaited<ReturnType<FloorService['auditContext']>>): Promise<FloorAudit> {
    const blockers: string[] = [];
    let head: string | null = null;
    let merged = false;
    let integration: FloorAudit['integration'] = 'unknown';
    const changes: FloorAudit['changes'] = { tracked: 0, untracked: 0, ignored: 0, samples: [], truncated: false };
    let status = '';
    try {
      await this.assertFloorPath(floor, workspace);
      [head, status] = await Promise.all([
        this.git(workspace, floor.path, ['rev-parse', '--verify', 'HEAD']).then((value) => value.trim()),
        this.git(workspace, floor.path, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignored=matching']),
      ]);
      // Git status AND non-forced worktree removal honor these index flags.
      // They can hide valuable local edits, so a clean status is not sufficient.
      const indexFlags = await this.git(workspace, floor.path, ['ls-files', '-v', '-z']);
      if (indexFlags.split('\0').some((entry) => /^[a-zS] /.test(entry))) blockers.push('hidden_index_flags');
      const records = status.split('\0').filter(Boolean);
      const ownedRecords: string[] = [];
      for (let index = 0; index < records.length; index++) {
        const record = records[index];
        const state = record.slice(0, 2);
        // Orkestrai's own dependency link farm is reproducible, not local work.
        if (state === '!!' && /(^|\/)node_modules\/$/.test(record.slice(3))
          && existsSync(join(floor.path, record.slice(3), SHARED_DEPENDENCIES_MARKER))) continue;
        // Build output, caches, test reports and logs are regenerated by the
        // next run; keeping them only fills the disk. Other ignored files stay.
        if (state === '!!' && await isDisposableArtifact(floor.path, record.slice(3))) {
          changes.ignored++;
          continue;
        }
        ownedRecords.push(record);
        changes[state === '??' ? 'untracked' : state === '!!' ? 'ignored' : 'tracked']++;
        if (changes.samples.length < 20) changes.samples.push(record);
        else changes.truncated = true;
        if (/[RC]/.test(state)) index++; // porcelain -z rename has a second path
      }
      if (ownedRecords.length) blockers.push('local_changes_or_untracked_or_ignored_files');
      try {
        if (floor.landedHead && floor.landedHead === head) {
          // Applied to a dirty checkout without a merge commit: integrated at this exact HEAD.
          merged = true;
          integration = 'patch_applied';
        } else if (floor.baseCommit && floor.baseCommit === head) {
          // Still at its creation snapshot: the floor holds no work of its own.
          merged = true;
          integration = 'unchanged';
        } else {
          await this.git(workspace, workspace.workingDir, ['merge-base', '--is-ancestor', head, context.targetHead]);
          merged = true;
          integration = 'ancestor';
        }
      } catch (error) {
        if ((error as { code?: unknown }).code !== 1) throw error;
        const patches = (await this.git(workspace, workspace.workingDir, ['cherry', context.targetHead, head])).trim().split('\n').filter(Boolean);
        // Patch equivalence is useful evidence, not permission to discard the branch.
        integration = patches.length > 0 && patches.every((line) => line.startsWith('- ')) ? 'patch_equivalent' : 'diverged';
        blockers.push('unmerged_commits_review_required');
      }
      const floorNodes = context.nodes.filter((node) => node.floorId === floor.id);
      const ids = new Set(floorNodes.map((node) => node.id));
      if (context.tasks.some((task) => ids.has(String(task.getAttribute('assignee_node_id'))))) blockers.push('pending_tasks');
      const sessions = ptySessionManager.list();
      if (sessions.some((session) => !session.exited && (ids.has(session.nodeId ?? '')
        || session.cwd === floor.path || session.cwd.startsWith(`${floor.path}/`) || session.cwd.startsWith(`${floor.path}\\`)))
        || floorNodes.some((node) => {
          const id = (node.payload as { sessionId?: string }).sessionId;
          const session = id ? ptySessionManager.get(id) : null;
          return session && !session.exited;
        })) blockers.push('live_terminal');
      if (context.processCwds?.length) {
        // Process tables report resolved paths (/private/var for /var on macOS).
        const roots = [floor.path, await realpath(floor.path).catch(() => floor.path)];
        const sep = workspace.runtimeKind === 'wsl' ? '\\' : '/';
        if (context.processCwds.some((cwd) => roots.some((root) => cwd === root || cwd.startsWith(`${root}${sep}`)))) blockers.push('running_process');
      }
    } catch {
      blockers.push('unavailable_or_mismatched_worktree');
    }
    const revision = createHash('sha256').update(JSON.stringify([floor.id, floor.path, floor.branch, context.target, context.targetHead, head, status, blockers])).digest('hex');
    return { floorId: floor.id, name: floor.name, branch: floor.branch, path: floor.path, target: context.target,
      merged, safeToRemove: merged && !blockers.length, blockers, revision, head, integration, changes };
  }

  /** Explicit, revision-bound cleanup. Branches are retained; blocked floors are never forced. */
  async cleanup(workspaceId: string, entries: Array<{ floorId: string; revision: string }>) {
    if (!entries.length || entries.length > 100 || new Set(entries.map((entry) => entry.floorId)).size !== entries.length) throw new Error('Selecione de 1 a 100 andares distintos.');
    // Validate every scope before any mutation, including mixed-workspace requests.
    await Promise.all(entries.map((entry) => this.requireFloor(workspaceId, entry.floorId)));
    return this.exclusive(workspaceId, async () => {
      const results: Array<{ floorId: string; removed: boolean; error?: string }> = [];
      for (const entry of entries) {
        try {
          await this.removeChecked(entry.floorId, false, entry.revision);
          results.push({ floorId: entry.floorId, removed: true });
        } catch (error) {
          results.push({ floorId: entry.floorId, removed: false, error: error instanceof Error ? error.message : 'Falha na limpeza.' });
        }
      }
      return results;
    });
  }

  async get(id: string): Promise<Floor | null> {
    const model = await AgentFloor.find(id);
    return model ? mapFloor(model) : null;
  }

  /**
   * Cria um andar: branch nova (ou existente) + worktree + registro.
   * cloneLayout duplica os nos do terreo para o andar.
   */
  async create(
    workspaceId: string,
    input: { name: string; branch?: string; existingBranch?: boolean; cloneLayout?: boolean }
  ): Promise<Floor> {
    return this.exclusive(workspaceId, () => this.createChecked(workspaceId, input));
  }

  private async createChecked(workspaceId: string, input: { name: string; branch?: string; existingBranch?: boolean; cloneLayout?: boolean }): Promise<Floor> {
    const workspace = await this.workspace(workspaceId);
    await this.assertRepo(workspace);

    const name = input.name.trim();
    if (!name) throw new Error('Informe o nome do andar.');
    const branch = input.branch?.trim() || `orkestrai/${slugify(name)}`;
    await this.git(workspace, workspace.workingDir, ['check-ref-format', '--branch', branch]);
    const floorPath = workspace.runtimeKind === 'wsl'
      ? win32.resolve(workspace.workingDir, '.orkestrai', 'floors', slugify(name))
      : resolve(workspace.workingDir, '.orkestrai', 'floors', slugify(name));

    if (existsSync(floorPath)) throw new Error(`Ja existe um andar em ${floorPath}.`);
    if (((await freeDiskBytes(workspace.workingDir)) ?? Number.POSITIVE_INFINITY) < DISK_LIMITS.floorCreate) {
      // Integrated, idle Floors are the usual reason the disk filled up.
      await this.retireIntegrated(workspace);
    }
    await assertFreeDisk(workspace.workingDir, DISK_LIMITS.floorCreate, 'criar um andar');

    const base = input.existingBranch ? null : await this.workingTreeBase(workspace);
    const args = input.existingBranch
      ? ['worktree', 'add', floorPath, branch]
      : ['worktree', 'add', '-b', branch, floorPath, base!.commit];
    await this.git(workspace, workspace.workingDir, args);

    const model = await AgentFloor.create({
      id: uuidv7(),
      workspace_id: workspaceId,
      name,
      branch,
      path: floorPath,
      status: 'active',
      base_commit: base?.commit ?? null,
      base_kind: base?.kind ?? null,
      landed_head: null,
    });
    const floor = mapFloor(model);
    await this.shareDependencies(workspace, floorPath).catch(() => 0);

    if (input.cloneLayout) {
      const groundNodes = await workspaceRepository.listNodes(workspaceId, null);
      const clonedIds = new Map<string, string>();
      for (const node of groundNodes) {
        const payload: Record<string, unknown> = {
          ...(node.payload as Record<string, unknown>),
          floorCloneOfNodeId: node.id,
        };
        if (node.type === 'terminal') {
          delete payload.sessionId;
          delete payload.agentSessionId;
          payload.resumeRecovery = false;
        }
        const cloned = await workspaceRepository.createNode({
          workspaceId,
          type: node.type,
          title: node.title,
          x: node.x,
          y: node.y,
          width: node.width,
          height: node.height,
          zIndex: node.zIndex,
          payload,
          floorId: floor.id,
        });
        clonedIds.set(node.id, cloned.id);
      }
      const { creativeStoryboardService } = await import('$lib/modules/creative-media/application/services/CreativeStoryboardService.js');
      for (const node of groundNodes.filter(item => item.type === 'storyboard')) await creativeStoryboardService.clone(workspaceId, node.id, workspaceId, clonedIds.get(node.id)!, clonedIds);
      const { creativeSequenceService } = await import('$lib/modules/creative-media/application/services/CreativeSequenceService.js');
      for (const node of groundNodes.filter(item => item.type === 'sequence')) await creativeSequenceService.clone(workspaceId, node.id, workspaceId, clonedIds.get(node.id)!, clonedIds);
    }

    const hooks = workspace.hooks;
    if (hooks.autoRunSetup && hooks.setup?.length) {
      await this.runHooks(floor, workspace, hooks.setup).catch(() => {});
    }

    notifyWorkspaceChanged(workspaceId);
    return floor;
  }

  async rename(id: string, name: string): Promise<Floor> {
    const floor = await this.get(id);
    if (!floor) throw new Error('Andar nao encontrado.');
    const next = name.trim();
    if (!next) throw new Error('O nome do andar nao pode ficar vazio.');
    await AgentFloor.query().where('id', id).update({ name: next });
    return (await this.get(id))!;
  }

  /** Preview da aterrissagem: stats do diff e conflitos potenciais. */
  async landingPreview(id: string, targetBranch?: string) {
    const floor = await this.get(id);
    if (!floor) throw new Error('Andar nao encontrado.');
    const workspace = await this.workspace(floor.workspaceId);
    const target = targetBranch || (await this.currentBranch(workspace));

    await this.validateBranch(workspace, target);
    await this.assertFloorPath(floor, workspace);
    const dirtyTarget = (await this.git(workspace, workspace.workingDir, ['status', '--porcelain'])).trim().length > 0;
    const pendingInFloor = (await this.git(workspace, floor.path, ['status', '--porcelain', '--untracked-files=all'])).trim().split('\n').filter(Boolean).length;
    if (dirtyTarget || floor.baseKind === 'snapshot') {
      // Patch landing: preview the floor's own delta against the real working tree.
      const head = (await this.git(workspace, floor.path, ['rev-parse', '--verify', 'HEAD'])).trim();
      const base = await this.floorBase(workspace, floor, head);
      const plan = await this.planDelta(workspace, base, head);
      const stat = await this.git(workspace, workspace.workingDir, ['diff', '--stat', base, head]);
      return {
        floor: floor.name,
        from: floor.branch,
        to: target,
        stat: stat.trim(),
        conflicts: plan.conflicts,
        targetDirty: dirtyTarget,
        mode: 'patch' as const,
        files: plan.writes.length + plan.deletes.length,
        pendingInFloor,
      };
    }
    const stat = await this.git(workspace, workspace.workingDir, ['diff', '--stat', `${target}...${floor.branch}`]);
    let conflicts: string[] = [];
    try {
      const mergeTree = await this.git(workspace, workspace.workingDir, ['merge-tree', '--write-tree', '--name-only', target, floor.branch]);
      if (!mergeTree.trim()) throw new Error('Git nao retornou a previa de merge.');
    } catch (error) {
      // merge-tree exits 1 for conflicts; stdout still contains the paths.
      const result = error as { code?: unknown; stdout?: string };
      if (result.code !== 1 || !result.stdout?.trim()) throw error;
      conflicts = result.stdout.split('\n\n')[0].split('\n').slice(1).filter(Boolean);
      if (!conflicts.length) throw error;
    }

    return {
      floor: floor.name,
      from: floor.branch,
      to: target,
      stat: stat.trim(),
      conflicts,
      targetDirty: dirtyTarget,
      mode: 'merge' as const,
      pendingInFloor,
    };
  }

  /**
   * Aterrissa o andar. Checkout principal limpo: merge da branch. Checkout com
   * alteracoes locais (ou andar criado de um snapshot): aplica somente o delta
   * do andar nos arquivos, com merge de 3 vias por arquivo, sem commit.
   */
  async land(id: string, targetBranch?: string, options: { commitPending?: boolean; message?: string } = {}): Promise<FloorLandResult> {
    const floor = await this.get(id);
    if (!floor) throw new Error('Andar nao encontrado.');
    return this.exclusive(floor.workspaceId, () => this.landChecked(id, targetBranch, options));
  }

  private async landChecked(id: string, targetBranch: string | undefined, options: { commitPending?: boolean; message?: string }): Promise<FloorLandResult> {
    const floor = await this.get(id);
    if (!floor) throw new Error('Andar nao encontrado.');
    const workspace = await this.workspace(floor.workspaceId);

    // Never abort a merge/cherry-pick that predates this operation.
    for (const ref of ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD']) {
      let pending = false;
      try {
        await this.git(workspace, workspace.workingDir, ['rev-parse', '--verify', '--quiet', ref]);
        pending = true;
      } catch (error) {
        if ((error as { code?: unknown }).code !== 1) throw error;
      }
      if (pending) throw new Error('O checkout principal ja tem uma integracao em andamento. Conclua-a antes de aterrissar.');
    }

    const dirty = (await this.git(workspace, workspace.workingDir, ['status', '--porcelain'])).trim();
    const current = await this.currentBranch(workspace);
    const target = targetBranch || current;
    await this.validateBranch(workspace, target);
    await this.assertFloorPath(floor, workspace);
    let committedPending: string | null = null;
    if ((await this.git(workspace, floor.path, ['status', '--porcelain', '--untracked-files=all'])).trim()) {
      if (options.commitPending === false) {
        throw new Error('O andar tem alteracoes nao commitadas. Preserve e revise essas alteracoes antes de aterrissar.');
      }
      // The floor's agent finished: its uncommitted work is part of the delivery.
      committedPending = await this.commitInFloor(workspace, floor, `Orkestrai: ${floor.name}`);
    }

    if (dirty || floor.baseKind === 'snapshot') {
      if (target !== current) throw new Error('Com alteracoes locais no checkout principal, o andar so aterrissa na branch atual.');
      const head = (await this.git(workspace, floor.path, ['rev-parse', '--verify', 'HEAD'])).trim();
      const base = await this.floorBase(workspace, floor, head);
      const plan = await this.planDelta(workspace, base, head);
      if (plan.unsafe.length) {
        throw new Error(`Aterrissagem recusada: ${plan.unsafe.join(', ')} passa(m) por um link simbólico no checkout principal e poderia(m) alterar arquivos fora do workspace. Nenhum arquivo foi alterado.`);
      }
      if (plan.conflicts.length) {
        throw new Error(`Conflito ao aterrissar ${floor.branch}: ${plan.conflicts.join(', ')}. Nenhum arquivo foi alterado. Atribua a resolucao ao agente do andar (rebase do andar sobre o estado atual) ou resolva no editor.`);
      }
      const files = await this.applyDelta(workspace, plan);
      // Delivered work is committed, not left for someone to commit later. The
      // commit covers every delta path, so landing again after a refused commit
      // (a failing hook) records the files that were already applied.
      let commit: string | null = null;
      try {
        commit = plan.paths.length ? await this.commitLanded(workspace, plan.paths, landingMessage(floor, options.message, files)) : null;
      } catch (error) {
        // Not integrated until committed: the floor stays, with its work, and
        // the audit keeps treating it as unmerged so nothing retires it.
        notifyWorkspaceChanged(floor.workspaceId);
        return {
          merged: false, branch: floor.branch, into: target, mode: 'patch', files, committedPending, commit: null,
          commitError: gitErrorText(error), cleanup: 'pending', cleanupReason: 'commit_failed',
        };
      }
      await AgentFloor.query().where('id', id).update({ landed_head: head });
      const cleanup = await this.cleanupAfterLand(id);
      notifyWorkspaceChanged(floor.workspaceId);
      return { merged: true, branch: floor.branch, into: target, mode: 'patch', files, committedPending, commit, ...cleanup };
    }

    if (targetBranch && targetBranch !== current) {
      await this.git(workspace, workspace.workingDir, ['checkout', targetBranch]);
    }

    try {
      const message = options.message?.trim() ? ['-m', landingMessage(floor, options.message)] : ['--no-edit'];
      await this.git(workspace, workspace.workingDir, ['merge', '--no-ff', ...message, floor.branch]);
    } catch (error) {
      // Lista os arquivos em conflito antes de abortar para o chamador
      // (humano ou agente lider) saber o que precisa de resolucao.
      const conflicted = (await this.git(workspace, workspace.workingDir, ['diff', '--name-only', '--diff-filter=U']).catch(() => ''))
        .split('\n')
        .filter(Boolean);
      await this.git(workspace, workspace.workingDir, ['merge', '--abort']).catch(() => {});
      const files = conflicted.length ? ` Arquivos em conflito: ${conflicted.join(', ')}.` : '';
      throw new Error(`Conflito ao aterrissar ${floor.branch} em ${target}.${files} Atribua a resolucao a um agente do andar ou resolva no editor/terminal.`);
    }

    const commit = (await this.git(workspace, workspace.workingDir, ['rev-parse', '--verify', 'HEAD'])).trim();
    const cleanup = await this.cleanupAfterLand(id);
    notifyWorkspaceChanged(floor.workspaceId);
    return { merged: true, branch: floor.branch, into: target, mode: 'merge', committedPending, commit, ...cleanup };
  }

  /**
   * Removes every Floor whose work is integrated and that nothing uses: no
   * live terminal, running process, pending card or local work. Callers hold
   * the workspace lock.
   */
  private async retireIntegrated(workspace: Workspace): Promise<number> {
    const audit = await this.loadAudit(workspace.id);
    let removed = 0;
    for (const entry of audit.filter((item) => item.safeToRemove)) {
      try {
        await this.removeChecked(entry.floorId, false, entry.revision, 'landed');
        removed++;
      } catch {
        // A Floor that changed meanwhile stays; the next audit sees it again.
      }
    }
    return removed;
  }

  /** Integration already succeeded; a floor still in use is kept, never reported as a failed landing. */
  private async cleanupAfterLand(id: string): Promise<Pick<FloorLandResult, 'cleanup' | 'cleanupReason'>> {
    try {
      await this.removeChecked(id, false, undefined, 'landed');
      return { cleanup: 'removed' };
    } catch (error) {
      return { cleanup: 'pending', cleanupReason: error instanceof Error ? error.message : String(error) };
    }
  }

  /** Exclui o andar (worktree + opcionalmente a branch). */
  async remove(id: string, deleteBranch = false, revision?: string): Promise<{ removed: boolean; branchDeleted?: boolean; warning?: string }> {
    const floor = await this.get(id);
    if (!floor) throw new Error('Andar nao encontrado.');
    return this.exclusive(floor.workspaceId, () => this.removeChecked(id, deleteBranch, revision));
  }

  private async removeChecked(id: string, deleteBranch: boolean, revision?: string, finalStatus = 'deleted') {
    const floor = await this.get(id);
    if (!floor) throw new Error('Andar nao encontrado.');
    const workspace = await this.workspace(floor.workspaceId);

    const inspect = async () => this.inspectFloor(floor, workspace, await this.auditContext(workspace));
    const before = await inspect();
    if (revision && before.revision !== revision) throw new Error('O andar mudou desde a auditoria. Consulte floor_audit novamente.');
    if (!before.safeToRemove) throw new Error(`Andar preservado: ${before.blockers.join(', ')}.`);

    const hooks = workspace.hooks;
    if (hooks.teardown?.length) {
      const results = await this.runHooks(floor, workspace, hooks.teardown);
      if (results.some((result) => !result.ok)) throw new Error('Hook de teardown falhou; andar preservado.');
    }

    // Hooks and other agents can change a checkout after the first check.
    const after = await inspect();
    if (!after.safeToRemove || after.revision !== before.revision) throw new Error('O andar mudou durante a limpeza; worktree preservada.');
    await this.git(workspace, workspace.workingDir, ['worktree', 'remove', floor.path]);
    await this.retireFloorNodes(floor);
    await AgentFloor.query().where('id', id).update({ status: finalStatus });
    notifyWorkspaceChanged(floor.workspaceId);
    if (deleteBranch) {
      try {
        // A branch still at its working-tree snapshot carries no floor work;
        // Git cannot see it as merged because the snapshot commit never lands.
        const unchangedSnapshot = before.integration === 'unchanged' && floor.baseKind === 'snapshot';
        await this.git(workspace, workspace.workingDir, ['branch', unchangedSnapshot ? '-D' : '-d', '--', floor.branch]);
        return { removed: true, branchDeleted: true };
      } catch {
        return { removed: true, branchDeleted: false, warning: 'Worktree removida, mas o Git recusou excluir a branch; branch preservada.' };
      }
    }
    return { removed: true };
  }

  /** Executa comandos de hook no diretorio do andar com as variaveis $ORKESTRAI_*. */
  async runHooks(floor: Floor, workspace: Workspace, commands: HookCommand[]): Promise<Array<{ command: string; ok: boolean; output: string }>> {
    const runtime = workspaceExecutionRuntime(workspace);
    const env = {
      ...agentEnv(),
      ORKESTRAI_FLOOR_NAME: floor.name,
      ORKESTRAI_BRANCH_NAME: floor.branch,
      ORKESTRAI_FLOOR_PATH: runtime.kind === 'wsl'
        ? guestWorkingDirectory(runtime, floor.path, workspace.workingDir)
        : floor.path,
      ORKESTRAI_ROOT_PATH: runtime.kind === 'wsl' ? runtime.linuxWorkingDir : workspace.workingDir,
      ORKESTRAI_PROJECT_NAME: workspace.name,
    };
    const results = [];
    for (const { command } of commands) {
      try {
        // WSL hooks must execute in the selected distribution. Native Windows
        // keeps cmd.exe while Unix workspaces use /bin/sh.
        const [shell, shellArgs] = IS_WIN && runtime.kind === 'native'
          ? [process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', command]]
          : ['/bin/sh', ['-c', command]];
        const launch = buildWorkspaceRuntimeLaunch({
          workspace,
          command: shell,
          args: shellArgs,
          hostCwd: floor.path,
          hostEnv: env,
          forwardEnvToWsl: [
            'ORKESTRAI_FLOOR_NAME',
            'ORKESTRAI_BRANCH_NAME',
            'ORKESTRAI_FLOOR_PATH',
            'ORKESTRAI_PROJECT_NAME',
          ],
        });
        const { stdout, stderr } = await execFileAsync(launch.command, launch.args, {
          cwd: launch.cwd,
          env: launch.env,
          timeout: 120_000,
          windowsHide: true,
        });
        results.push({ command, ok: true, output: (stdout + stderr).trim() });
      } catch (error) {
        results.push({ command, ok: false, output: error instanceof Error ? error.message : String(error) });
      }
    }
    return results;
  }

  async hooksFor(workspaceId: string): Promise<WorkspaceHooks> {
    const workspace = await this.workspace(workspaceId);
    return workspace.hooks;
  }

  async saveHooks(workspaceId: string, hooks: WorkspaceHooks): Promise<WorkspaceHooks> {
    await this.workspace(workspaceId);
    await workspaceRepository.updateWorkspace(workspaceId, { hooks });
    return hooks;
  }

  private async currentBranch(workspace: Workspace): Promise<string> {
    const branch = (await this.git(workspace, workspace.workingDir, ['branch', '--show-current'])).trim();
    if (!branch) throw new Error('Checkout principal em detached HEAD. Selecione a branch de integracao.');
    return branch;
  }

  private async validateBranch(workspace: Workspace, branch: string) {
    await this.git(workspace, workspace.workingDir, ['check-ref-format', '--branch', branch]);
    await this.git(workspace, workspace.workingDir, ['show-ref', '--verify', `refs/heads/${branch}`]);
  }

  private async retireFloorNodes(floor: Floor): Promise<void> {
    const [floorNodes, workspaceNodes] = await Promise.all([
      workspaceRepository.listNodes(floor.workspaceId, floor.id, true, true),
      workspaceRepository.listNodes(floor.workspaceId, undefined, true, true),
    ]);
    const sharedSessionIds = new Set(
      workspaceNodes
        .filter((node) => node.floorId !== floor.id)
        .flatMap((node) => {
          const sessionId = (node.payload as { sessionId?: unknown }).sessionId;
          return typeof sessionId === 'string' ? [sessionId] : [];
        }),
    );
    for (const node of floorNodes) {
      const sessionId = (node.payload as { sessionId?: unknown }).sessionId;
      if (typeof sessionId === 'string' && !sharedSessionIds.has(sessionId)) {
        ptySessionManager.kill(sessionId);
      }
    }
    await workspaceRepository.archiveFloorNodes(floor.workspaceId, floor.id);
  }
}

/** Conventional subject for the landing commit; the caller's message wins. */
function landingMessage(floor: Floor, message: string | undefined, files?: number): string {
  const subject = message?.trim() || `chore(floor): land ${floor.name}`;
  const body = `Integrated by Orkestrai from ${floor.branch}${files === undefined ? '' : ` (${files} files)`}.`;
  return `${subject.slice(0, 200)}\n\n${body}`;
}

function gitErrorText(error: unknown): string {
  const detail = (error as { stderr?: unknown }).stderr;
  const text = typeof detail === 'string' && detail.trim() ? detail : error instanceof Error ? error.message : String(error);
  return text.trim().slice(0, 600);
}

export const floorService = new FloorService();
