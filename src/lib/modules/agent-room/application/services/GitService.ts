import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { open, readFile, stat } from 'node:fs/promises';
import { extname, isAbsolute, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { workspaceRepository } from '../../infrastructure/repositories/WorkspaceRepository.js';
import { agentEnv } from '../../infrastructure/agent-path.js';
import { buildWorkspaceRuntimeLaunch } from '../../infrastructure/WslRuntime.js';
import type { Workspace } from '../../domain/types.js';
import type { ExecuteGitOperationInput, GitOperationInput } from '../../contracts/schemas/fsSchemas.js';

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 15_000;
const MAX_DIFF_BYTES = 1_000_000;

export type GitChange = {
  id: string;
  path: string;
  previousPath: string | null;
  status: string;
  staged: boolean;
};

export type GitStatusResult = {
  isRepo: boolean;
  branch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  head: string | null;
  revision: string;
  changes: GitChange[];
};

export type GitFileDiff = {
  path: string;
  previousPath: string | null;
  status: string;
  staged: boolean;
  binary: boolean;
  truncated: boolean;
  language: string;
  original: string;
  modified: string;
  revision: string;
};

export type GitCommit = {
  hash: string;
  shortHash: string;
  parents: string[];
  author: string;
  email: string;
  authoredAt: string;
  subject: string;
  decorations: string[];
};

export type GitBranchInfo = {
  name: string;
  current: boolean;
  remote: boolean;
  upstream: string | null;
  ahead: number;
  behind: number;
  head: string;
};

export type GitWorktreeInfo = {
  path: string;
  head: string | null;
  branch: string | null;
  bare: boolean;
  detached: boolean;
  locked: string | null;
};

export type GitWorkspaceSnapshot = {
  status: GitStatusResult;
  commits: GitCommit[];
  branches: GitBranchInfo[];
  tags: Array<{ name: string; target: string }>;
  remotes: Array<{ name: string; fetchUrl: string | null; pushUrl: string | null }>;
  worktrees: GitWorktreeInfo[];
  stashes: Array<{ ref: string; subject: string; createdAt: string }>;
  operation: 'merge' | 'rebase' | 'cherry-pick' | 'revert' | null;
};

export type GitOperationPreview = {
  operation: GitOperationInput['operation'];
  summary: string;
  command: string[];
  destructive: boolean;
  confirmationRequired: boolean;
  revision: string;
};

type GitLaunch = { command: string; args: string[]; cwd: string; env: Record<string, string> };

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  '.c': 'c', '.cc': 'cpp', '.cpp': 'cpp', '.cs': 'csharp', '.css': 'css', '.go': 'go',
  '.html': 'html', '.java': 'java', '.js': 'javascript', '.json': 'json', '.jsx': 'javascript',
  '.md': 'markdown', '.php': 'php', '.py': 'python', '.rb': 'ruby', '.rs': 'rust', '.scss': 'scss',
  '.sh': 'shell', '.sql': 'sql', '.svelte': 'svelte', '.swift': 'swift', '.toml': 'toml',
  '.ts': 'typescript', '.tsx': 'typescript', '.vue': 'vue', '.xml': 'xml', '.yaml': 'yaml', '.yml': 'yaml',
};

function parsePorcelain(porcelain: string): GitChange[] {
  const records = porcelain.split('\0');
  const changes: GitChange[] = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record || record.length < 4) continue;
    const x = record[0];
    const y = record[1];
    const path = record.slice(3);
    let previousPath: string | null = null;
    if (x === 'R' || x === 'C' || y === 'R' || y === 'C') previousPath = records[++index] || null;
    if (x !== ' ' && x !== '?') {
      changes.push({ id: `staged:${path}`, path, previousPath, status: x, staged: true });
    }
    if (y !== ' ') {
      changes.push({
        id: `unstaged:${path}`,
        path,
        previousPath,
        status: x === '?' && y === '?' ? '?' : y,
        staged: false,
      });
    }
  }
  return changes;
}

function parseNameStatus(output: string, source: string): GitChange[] {
  const records = output.split('\0');
  const changes: GitChange[] = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record) continue;
    const separator = record.indexOf('\t');
    const status = separator > 0 ? record.slice(0, separator) : record;
    let path = separator > 0 ? record.slice(separator + 1) : records[++index] || '';
    if (!status || !path) continue;
    let previousPath: string | null = null;
    if (status.startsWith('R') || status.startsWith('C')) {
      previousPath = path;
      path = records[++index] || path;
    }
    changes.push({
      id: `${source}:${path}`,
      path,
      previousPath,
      status: status[0],
      staged: false,
    });
  }
  return changes;
}

/** Git operations scoped to the workspace root and executed without a shell. */
export class GitService {
  private notifyChanged(workspaceId: string): void {
    const broadcast = (globalThis as { __orkestraiBroadcast?: (payload: Record<string, unknown>) => void }).__orkestraiBroadcast;
    broadcast?.({ type: 'gitReviewChanged', workspaceId });
  }

  private async workspace(workspaceId: string): Promise<Workspace> {
    const workspace = await workspaceRepository.getWorkspace(workspaceId);
    if (!workspace) throw new Error('Workspace não encontrado.');
    return workspace;
  }

  private async root(workspaceId: string): Promise<string> {
    return (await this.workspace(workspaceId)).workingDir;
  }

  private launch(workspace: Workspace, args: string[], cwd = workspace.workingDir): GitLaunch {
    return buildWorkspaceRuntimeLaunch({
      workspace,
      command: 'git',
      args,
      hostCwd: cwd,
      hostEnv: agentEnv(),
    });
  }

  private async workspaceGit(workspaceId: string, args: string[]): Promise<string> {
    const launch = this.launch(await this.workspace(workspaceId), args);
    const { stdout } = await execFileAsync(launch.command, launch.args, {
      cwd: launch.cwd,
      env: launch.env,
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
    });
    return stdout;
  }

  private async workspaceDirectoryGit(workspaceId: string, cwd: string, args: string[]): Promise<string> {
    const launch = this.launch(await this.workspace(workspaceId), args, cwd);
    const { stdout } = await execFileAsync(launch.command, launch.args, {
      cwd: launch.cwd,
      env: launch.env,
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
    });
    return stdout;
  }

  private async git(cwd: string, args: string[]): Promise<string> {
    const { stdout } = await execFileAsync('git', args, {
      cwd,
      env: agentEnv(),
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: 16 * 1024 * 1024,
    });
    return stdout;
  }

  private async gitBufferLimited(cwd: string, args: string[]): Promise<{ data: Buffer<ArrayBufferLike>; truncated: boolean }> {
    return this.spawnBufferLimited({ command: 'git', args, cwd, env: agentEnv() });
  }

  private async workspaceGitBufferLimited(workspaceId: string, args: string[]): Promise<{ data: Buffer<ArrayBufferLike>; truncated: boolean }> {
    return this.spawnBufferLimited(this.launch(await this.workspace(workspaceId), args));
  }

  private async spawnBufferLimited(launch: GitLaunch): Promise<{ data: Buffer<ArrayBufferLike>; truncated: boolean }> {
    return new Promise((resolvePromise, reject) => {
      const child = spawn(launch.command, launch.args, { cwd: launch.cwd, env: launch.env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
      const chunks: Buffer[] = [];
      const errors: Buffer[] = [];
      let size = 0;
      let truncated = false;
      const timer = setTimeout(() => child.kill(), GIT_TIMEOUT_MS);
      child.stderr.on('data', (chunk: Buffer) => errors.push(Buffer.from(chunk)));
      child.stdout.on('data', (chunk: Buffer) => {
        const data = Buffer.from(chunk);
        const remaining = MAX_DIFF_BYTES - size;
        if (remaining > 0) {
          const slice = data.subarray(0, remaining);
          chunks.push(slice);
          size += slice.length;
        }
        if (data.length > remaining) {
          truncated = true;
          child.kill();
        }
      });
      child.on('error', (error) => { clearTimeout(timer); reject(error); });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code !== 0 && !truncated) {
          reject(new Error(Buffer.concat(errors).toString('utf8') || `git exited with code ${code}`));
          return;
        }
        resolvePromise({ data: Buffer.concat(chunks), truncated });
      });
    });
  }

  private confinedPath(cwd: string, path: string): string {
    const absolute = resolve(cwd, path);
    const inside = relative(cwd, absolute);
    if (!path || isAbsolute(inside) || inside === '..' || inside.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)) {
      throw new Error('Caminho fora do workspace.');
    }
    return absolute;
  }

  private async readWorkingFile(cwd: string, path: string): Promise<{ data: Buffer; truncated: boolean }> {
    const absolute = this.confinedPath(cwd, path);
    const size = (await stat(absolute)).size;
    if (size <= MAX_DIFF_BYTES) return { data: await readFile(absolute), truncated: false };
    const handle = await open(absolute, 'r');
    try {
      const data = Buffer.alloc(MAX_DIFF_BYTES);
      const { bytesRead } = await handle.read(data, 0, MAX_DIFF_BYTES, 0);
      return { data: data.subarray(0, bytesRead), truncated: true };
    } finally {
      await handle.close();
    }
  }

  async status(workspaceId: string): Promise<GitStatusResult> {
    return this.statusWith((args) => this.workspaceGit(workspaceId, args));
  }

  async isRepository(workspaceId: string): Promise<boolean> {
    return this.workspaceGit(workspaceId, ['rev-parse', '--is-inside-work-tree'])
      .then((output) => output.trim() === 'true')
      .catch(() => false);
  }

  /** Internal read-only status for an already authorized repository or Floor. */
  async statusDirectory(cwd: string): Promise<GitStatusResult> {
    return this.statusWith((args) => this.git(cwd, args));
  }

  /** Runtime-aware status for the primary checkout, an approved root, or a Floor. */
  async statusWorkspaceDirectory(workspaceId: string, cwd: string): Promise<GitStatusResult> {
    return this.statusWith((args) => this.workspaceDirectoryGit(workspaceId, cwd, args));
  }

  private async statusWith(run: (args: string[]) => Promise<string>): Promise<GitStatusResult> {
    try {
      await run(['rev-parse', '--is-inside-work-tree']);
    } catch {
      return { isRepo: false, branch: null, upstream: null, ahead: 0, behind: 0, head: null, revision: '', changes: [] };
    }

    const [branchOutput, headOutput, upstreamOutput, porcelain] = await Promise.all([
      run(['branch', '--show-current']).catch(() => ''),
      run(['rev-parse', 'HEAD']).catch(() => ''),
      run(['rev-parse', '--abbrev-ref', '@{upstream}']).catch(() => ''),
      run(['status', '--porcelain=v1', '-z', '-uall']),
    ]);
    const branch = branchOutput.trim() || null;
    const head = headOutput.trim() || null;
    const upstream = upstreamOutput.trim() || null;
    let ahead = 0;
    let behind = 0;
    if (upstream) {
      const counts = (await run(['rev-list', '--left-right', '--count', '@{upstream}...HEAD']).catch(() => '')).trim().split(/\s+/);
      behind = Number(counts[0]) || 0;
      ahead = Number(counts[1]) || 0;
    }
    const changes = parsePorcelain(porcelain);
    const contentHashes = await Promise.all(changes.map(async (change) => {
      if (change.status === 'D') return `${change.id}:deleted`;
      const args = change.staged ? ['rev-parse', `:${change.path}`] : ['hash-object', '--', change.path];
      return `${change.id}:${(await run(args).catch(() => '')).trim()}`;
    }));
    const revision = createHash('sha256')
      .update(`${head ?? ''}\0${porcelain}\0${contentHashes.join('\0')}`)
      .digest('hex');
    return { isRepo: true, branch, upstream, ahead, behind, head, revision, changes };
  }

  /**
   * Returns committed file changes since the common ancestor of two refs.
   * Refs are resolved to commit hashes before diffing, preventing option
   * injection while keeping every subprocess shell-free.
   */
  async changesSinceMergeBase(cwd: string, baseRef: string, headRef = 'HEAD'): Promise<GitChange[]> {
    return this.changesSinceMergeBaseWith((args) => this.git(cwd, args), baseRef, headRef);
  }

  /** Runtime-aware committed changes for WSL-backed repositories and Floors. */
  async changesSinceMergeBaseWorkspace(workspaceId: string, cwd: string, baseRef: string, headRef = 'HEAD'): Promise<GitChange[]> {
    return this.changesSinceMergeBaseWith((args) => this.workspaceDirectoryGit(workspaceId, cwd, args), baseRef, headRef);
  }

  private async changesSinceMergeBaseWith(
    run: (args: string[]) => Promise<string>,
    baseRef: string,
    headRef: string,
  ): Promise<GitChange[]> {
    const [base, head] = await Promise.all([
      this.resolveCommitWith(run, baseRef),
      this.resolveCommitWith(run, headRef),
    ]);
    const mergeBase = (await run(['merge-base', base, head])).trim();
    if (!mergeBase) return [];
    const output = await run([
      'diff', '--name-status', '-z', '--find-renames', mergeBase, head, '--',
    ]);
    return parseNameStatus(output, `range:${head.slice(0, 12)}`);
  }

  async fileDiff(workspaceId: string, path: string, staged = false): Promise<GitFileDiff> {
    const cwd = await this.root(workspaceId);
    this.confinedPath(cwd, path);
    const status = await this.status(workspaceId);
    const change = status.changes.find((item) => item.path === path && item.staged === staged);
    if (!change) throw new Error('Alteracao Git nao encontrada.');

    const originalPath = change.previousPath ?? path;
    let original: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    let modified: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    let truncated = false;
    if (staged) {
      const [before, after] = await Promise.all([
        this.workspaceGitBufferLimited(workspaceId, ['show', `HEAD:${originalPath}`]).catch(() => ({ data: Buffer.alloc(0), truncated: false })),
        this.workspaceGitBufferLimited(workspaceId, ['show', `:${path}`]).catch(() => ({ data: Buffer.alloc(0), truncated: false })),
      ]);
      original = before.data;
      modified = after.data;
      truncated = before.truncated || after.truncated;
    } else {
      const before = await this.workspaceGitBufferLimited(workspaceId, ['show', `:${originalPath}`])
        .catch(() => this.workspaceGitBufferLimited(workspaceId, ['show', `HEAD:${originalPath}`]))
        .catch(() => ({ data: Buffer.alloc(0), truncated: false }));
      original = before.data;
      truncated = before.truncated;
      if (change.status !== 'D') {
        const working = await this.readWorkingFile(cwd, path).catch(() => ({ data: Buffer.alloc(0), truncated: false }));
        modified = working.data;
        truncated = working.truncated;
      }
    }

    if (original.length > MAX_DIFF_BYTES) {
      original = original.subarray(0, MAX_DIFF_BYTES);
      truncated = true;
    }
    if (modified.length > MAX_DIFF_BYTES) {
      modified = modified.subarray(0, MAX_DIFF_BYTES);
      truncated = true;
    }
    const binary = original.includes(0) || modified.includes(0);
    return {
      path,
      previousPath: change.previousPath,
      status: change.status,
      staged,
      binary,
      truncated,
      language: LANGUAGE_BY_EXTENSION[extname(path).toLowerCase()] ?? 'plaintext',
      original: binary ? '' : original.toString('utf8'),
      modified: binary ? '' : modified.toString('utf8'),
      revision: status.revision,
    };
  }

  async diff(workspaceId: string, path?: string | null, staged = false): Promise<{ diff: string }> {
    const cwd = await this.root(workspaceId);
    if (path) this.confinedPath(cwd, path);
    const args = ['diff'];
    if (staged) args.push('--cached');
    if (path) args.push('--', path);
    return { diff: await this.workspaceGit(workspaceId, args) };
  }

  async logGraph(workspaceId: string, limit = 25): Promise<{ graph: string }> {
    const graph = await this.workspaceGit(workspaceId, ['log', '--oneline', '--graph', '--decorate', '-n', String(limit)]).catch(() => '');
    return { graph };
  }

  async stage(workspaceId: string, path: string) {
    this.confinedPath(await this.root(workspaceId), path);
    await this.workspaceGit(workspaceId, ['add', '--', path]);
    this.notifyChanged(workspaceId);
    return { staged: path };
  }

  async unstage(workspaceId: string, path: string) {
    const cwd = await this.root(workspaceId);
    this.confinedPath(cwd, path);
    await this.workspaceGit(workspaceId, ['restore', '--staged', '--', path])
      .catch(() => this.workspaceGit(workspaceId, ['reset', 'HEAD', '--', path]));
    this.notifyChanged(workspaceId);
    return { unstaged: path };
  }

  async commit(workspaceId: string, message: string) {
    const msg = message.trim();
    if (!msg) throw new Error('Informe a mensagem de commit.');
    await this.workspaceGit(workspaceId, ['commit', '-m', msg]);
    this.notifyChanged(workspaceId);
    return { committed: msg };
  }

  async pull(workspaceId: string) {
    const output = await this.workspaceGit(workspaceId, ['pull']);
    this.notifyChanged(workspaceId);
    return { output };
  }
  async push(workspaceId: string) {
    const output = await this.workspaceGit(workspaceId, ['push']);
    this.notifyChanged(workspaceId);
    return { output };
  }

  async checkout(workspaceId: string, branch: string) {
    const name = branch.trim();
    if (!name) throw new Error('Informe a branch.');
    await this.assertBranchExists(workspaceId, name);
    await this.workspaceGit(workspaceId, ['switch', name]);
    this.notifyChanged(workspaceId);
    return { checkedOut: name };
  }

  async createBranch(workspaceId: string, branch: string, checkout = true) {
    const name = branch.trim();
    if (!name) throw new Error('Informe o nome da branch.');
    await this.assertValidBranchName(workspaceId, name);
    await this.workspaceGit(workspaceId, checkout ? ['switch', '-c', name] : ['branch', name]);
    this.notifyChanged(workspaceId);
    return { created: name };
  }

  async listBranches(workspaceId: string) {
    const output = await this.workspaceGit(workspaceId, ['branch', '--list', '--format=%(refname:short)']);
    return output.split('\n').map((line) => line.trim()).filter(Boolean);
  }

  async stash(workspaceId: string, pop = false) {
    const output = await this.workspaceGit(workspaceId, pop ? ['stash', 'pop'] : ['stash', 'push', '-u']);
    this.notifyChanged(workspaceId);
    return { output };
  }

  async discard(workspaceId: string, path: string) {
    const cwd = await this.root(workspaceId);
    const change = (await this.status(workspaceId)).changes.find((item) => item.path === path && !item.staged);
    if (change?.status === '?') throw new Error('Arquivos novos devem ser removidos manualmente para evitar perda irreversivel.');
    await this.workspaceGit(workspaceId, ['restore', '--', path]);
    this.notifyChanged(workspaceId);
    return { discarded: path };
  }

  async workspaceSnapshot(workspaceId: string, limit = 100): Promise<GitWorkspaceSnapshot> {
    const status = await this.status(workspaceId);
    if (!status.isRepo) {
      return { status, commits: [], branches: [], tags: [], remotes: [], worktrees: [], stashes: [], operation: null };
    }
    const boundedLimit = Number.isFinite(limit) ? Math.max(1, Math.min(200, Math.trunc(limit))) : 100;
    const [commitOutput, branchOutput, tagOutput, remoteNames, worktreeOutput, stashOutput, operation] = await Promise.all([
      this.workspaceGit(workspaceId, [
        'log', `-n${boundedLimit}`, '--date=iso-strict',
        '--format=%x1e%H%x1f%h%x1f%P%x1f%an%x1f%ae%x1f%aI%x1f%s%x1f%D',
      ]).catch(() => ''),
      this.workspaceGit(workspaceId, [
        'for-each-ref', '--format=%(refname:short)%00%(refname)%00%(HEAD)%00%(upstream:short)%00%(upstream:track)%00%(objectname)',
        'refs/heads', 'refs/remotes',
      ]).catch(() => ''),
      this.workspaceGit(workspaceId, ['for-each-ref', '--format=%(refname:short)%00%(objectname)', 'refs/tags']).catch(() => ''),
      this.workspaceGit(workspaceId, ['remote']).catch(() => ''),
      this.workspaceGit(workspaceId, ['worktree', 'list', '--porcelain']).catch(() => ''),
      this.workspaceGit(workspaceId, ['stash', 'list', '--date=iso-strict', '--format=%gd%x00%aI%x00%s']).catch(() => ''),
      this.operationState(workspaceId),
    ]);
    const commits = commitOutput.split('\x1e').filter(Boolean).map((record) => {
      const [hash = '', shortHash = '', parents = '', author = '', email = '', authoredAt = '', subject = '', decorations = ''] = record.trim().split('\x1f');
      return {
        hash,
        shortHash,
        parents: parents.split(' ').filter(Boolean),
        author,
        email,
        authoredAt,
        subject,
        decorations: decorations.split(',').map((value) => value.trim()).filter(Boolean),
      };
    }).filter((commit) => /^[0-9a-f]{40,64}$/i.test(commit.hash));
    const branches = branchOutput.split('\n').filter(Boolean).map((record): GitBranchInfo | null => {
      const [name = '', fullName = '', current = '', upstream = '', track = '', head = ''] = record.split('\0');
      if (!name || !/^[0-9a-f]{40,64}$/i.test(head)) return null;
      const ahead = Number(track.match(/ahead\s+(\d+)/)?.[1] ?? 0);
      const behind = Number(track.match(/behind\s+(\d+)/)?.[1] ?? 0);
      return { name, current: current.trim() === '*', remote: fullName.startsWith('refs/remotes/'), upstream: upstream || null, ahead, behind, head };
    }).filter((branch): branch is GitBranchInfo => branch !== null);
    const tags = tagOutput.split('\n').filter(Boolean).flatMap((record) => {
      const [name = '', target = ''] = record.split('\0');
      return name && /^[0-9a-f]{40,64}$/i.test(target) ? [{ name, target }] : [];
    });
    const remotes = await Promise.all(remoteNames.split('\n').map((name) => name.trim()).filter(Boolean).slice(0, 50).map(async (name) => ({
      name,
      fetchUrl: this.redactRemoteUrl((await this.workspaceGit(workspaceId, ['remote', 'get-url', name]).catch(() => '')).trim()),
      pushUrl: this.redactRemoteUrl((await this.workspaceGit(workspaceId, ['remote', 'get-url', '--push', name]).catch(() => '')).trim()),
    })));
    return {
      status,
      commits,
      branches,
      tags,
      remotes,
      worktrees: this.parseWorktrees(worktreeOutput),
      stashes: stashOutput.split('\n').filter(Boolean).flatMap((record) => {
        const [ref = '', createdAt = '', subject = ''] = record.split('\0');
        return ref ? [{ ref, createdAt, subject }] : [];
      }),
      operation,
    };
  }

  async previewOperation(workspaceId: string, input: GitOperationInput): Promise<GitOperationPreview> {
    const status = await this.status(workspaceId);
    if (!status.isRepo) throw new Error('Este workspace não é um repositório Git.');
    const { args, summary, destructive } = await this.operationArgs(workspaceId, input);
    return {
      operation: input.operation,
      summary,
      command: ['git', ...args],
      destructive,
      confirmationRequired: destructive,
      revision: status.revision,
    };
  }

  async executeOperation(workspaceId: string, input: ExecuteGitOperationInput): Promise<{ output: string; snapshot: GitWorkspaceSnapshot }> {
    const status = await this.status(workspaceId);
    if (!status.isRepo) throw new Error('Este workspace não é um repositório Git.');
    if (status.revision !== input.expectedRevision) throw new Error('O repositório mudou desde a prévia. Atualize e revise a operação novamente.');
    const preview = await this.previewOperation(workspaceId, input);
    if (preview.confirmationRequired && !input.confirmed) throw new Error('Confirme explicitamente esta operação antes de executar.');
    const output = await this.workspaceGit(workspaceId, preview.command.slice(1));
    this.notifyChanged(workspaceId);
    return { output, snapshot: await this.workspaceSnapshot(workspaceId) };
  }

  private async operationArgs(workspaceId: string, input: GitOperationInput): Promise<{ args: string[]; summary: string; destructive: boolean }> {
    const requireRef = () => {
      if (!input.ref) throw new Error('Informe a referência Git.');
      return input.ref;
    };
    const requireName = async () => {
      if (!input.name) throw new Error('Informe o nome Git.');
      await this.assertValidBranchName(workspaceId, input.name);
      return input.name;
    };
    const commit = async () => this.resolveWorkspaceCommit(workspaceId, requireRef());
    switch (input.operation) {
      case 'fetch': {
        const remote = await this.validRemote(workspaceId, input.remote);
        return { args: remote ? ['fetch', '--prune', remote] : ['fetch', '--all', '--prune'], summary: remote ? `Fetch ${remote}` : 'Fetch all remotes', destructive: false };
      }
      case 'pull': return { args: ['pull', '--ff-only'], summary: 'Pull with fast-forward only', destructive: false };
      case 'push': {
        const remote = await this.validRemote(workspaceId, input.remote);
        const args = ['push'];
        if (input.setUpstream) args.push('-u', remote ?? 'origin', 'HEAD');
        else if (remote) args.push(remote);
        return { args, summary: input.setUpstream ? `Publish current branch to ${remote ?? 'origin'}` : 'Push current branch', destructive: false };
      }
      case 'checkout': {
        const branch = requireRef();
        await this.assertBranchExists(workspaceId, branch);
        return { args: ['switch', branch], summary: `Switch to ${branch}`, destructive: false };
      }
      case 'createBranch': {
        const name = await requireName();
        return { args: ['switch', '-c', name], summary: `Create and switch to ${name}`, destructive: false };
      }
      case 'renameBranch': {
        const source = requireRef();
        await this.assertBranchExists(workspaceId, source);
        const name = await requireName();
        return { args: ['branch', '-m', source, name], summary: `Rename ${source} to ${name}`, destructive: false };
      }
      case 'deleteBranch': {
        const branch = requireRef();
        await this.assertBranchExists(workspaceId, branch);
        return { args: ['branch', input.force ? '-D' : '-d', branch], summary: `Delete branch ${branch}`, destructive: true };
      }
      case 'merge': return { args: ['merge', '--no-edit', await commit()], summary: `Merge ${input.ref}`, destructive: false };
      case 'rebase': return { args: ['rebase', await commit()], summary: `Rebase onto ${input.ref}`, destructive: true };
      case 'cherryPick': return { args: ['cherry-pick', await commit()], summary: `Cherry-pick ${input.ref}`, destructive: false };
      case 'revert': return { args: ['revert', '--no-edit', await commit()], summary: `Revert ${input.ref}`, destructive: false };
      case 'createTag': {
        if (!input.name) throw new Error('Informe o nome Git.');
        const name = input.name;
        await this.assertValidTagName(workspaceId, name);
        const target = input.ref ? await commit() : 'HEAD';
        const args = input.message ? ['tag', '-a', name, target, '-m', input.message] : ['tag', name, target];
        return { args, summary: `Create tag ${name}`, destructive: false };
      }
      case 'deleteTag': {
        const name = requireRef();
        await this.assertValidTagName(workspaceId, name);
        return { args: ['tag', '-d', name], summary: `Delete tag ${name}`, destructive: true };
      }
      case 'stash': return { args: ['stash', 'push', '-u', ...(input.message ? ['-m', input.message] : [])], summary: 'Stash tracked and untracked changes', destructive: false };
      case 'stashPop': {
        const ref = input.ref?.trim();
        if (ref && !/^stash@\{\d+\}$/.test(ref)) throw new Error('Referência de stash inválida.');
        return { args: ['stash', 'pop', ...(ref ? [ref] : [])], summary: `Apply and remove ${ref ?? 'latest stash'}`, destructive: true };
      }
      case 'abortMerge': return { args: ['merge', '--abort'], summary: 'Abort the current merge', destructive: true };
      case 'abortRebase': return { args: ['rebase', '--abort'], summary: 'Abort the current rebase', destructive: true };
    }
  }

  private async operationState(workspaceId: string): Promise<GitWorkspaceSnapshot['operation']> {
    if (await this.workspaceGit(workspaceId, ['rev-parse', '-q', '--verify', 'MERGE_HEAD']).then(() => true).catch(() => false)) return 'merge';
    if (await this.workspaceGit(workspaceId, ['rev-parse', '-q', '--verify', 'CHERRY_PICK_HEAD']).then(() => true).catch(() => false)) return 'cherry-pick';
    if (await this.workspaceGit(workspaceId, ['rev-parse', '-q', '--verify', 'REVERT_HEAD']).then(() => true).catch(() => false)) return 'revert';
    if (await this.workspaceGit(workspaceId, ['rebase', '--show-current-patch']).then(() => true).catch(() => false)) return 'rebase';
    return null;
  }

  private parseWorktrees(output: string): GitWorktreeInfo[] {
    return output.trim().split(/\n\n+/).filter(Boolean).flatMap((block) => {
      const lines = block.split('\n');
      const path = lines.find((line) => line.startsWith('worktree '))?.slice(9) ?? '';
      if (!path) return [];
      const value = (prefix: string) => lines.find((line) => line.startsWith(prefix))?.slice(prefix.length) ?? null;
      const branchRef = value('branch ');
      return [{
        path,
        head: value('HEAD '),
        branch: branchRef?.replace(/^refs\/heads\//, '') ?? null,
        bare: lines.includes('bare'),
        detached: lines.includes('detached'),
        locked: value('locked '),
      }];
    });
  }

  private redactRemoteUrl(value: string): string | null {
    if (!value) return null;
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
      try {
        const url = new URL(value);
        url.username = url.username ? '***' : '';
        url.password = url.password ? '***' : '';
        url.search = '';
        url.hash = '';
        return url.toString();
      } catch {
        return null;
      }
    }
    return value.replace(/^([^@\s]+)@/, '***@').slice(0, 2_000);
  }

  private async assertValidBranchName(workspaceId: string, name: string): Promise<void> {
    if (name.startsWith('-') || name.includes('\0')) throw new Error('Nome de referência Git inválido.');
    await this.workspaceGit(workspaceId, ['check-ref-format', '--branch', name]).catch(() => {
      throw new Error('Nome de referência Git inválido.');
    });
  }

  private async assertValidTagName(workspaceId: string, name: string): Promise<void> {
    const value = name.trim();
    if (!value || value.length > 300 || value.startsWith('-') || value.includes('\0')) throw new Error('Nome de tag Git inválido.');
    await this.workspaceGit(workspaceId, ['check-ref-format', `refs/tags/${value}`]).catch(() => {
      throw new Error('Nome de tag Git inválido.');
    });
  }

  private async assertBranchExists(workspaceId: string, name: string): Promise<void> {
    if (name.startsWith('-') || name.includes('\0')) throw new Error('Branch Git inválida.');
    const branches = await this.listBranches(workspaceId);
    if (!branches.includes(name)) throw new Error(`Branch Git não encontrada: ${name}`);
  }

  private async validRemote(workspaceId: string, name?: string): Promise<string | null> {
    if (!name) return null;
    const remotes = (await this.workspaceGit(workspaceId, ['remote'])).split('\n').map((value) => value.trim()).filter(Boolean);
    if (!remotes.includes(name)) throw new Error(`Remote Git não encontrado: ${name}`);
    return name;
  }

  private async resolveWorkspaceCommit(workspaceId: string, ref: string): Promise<string> {
    const value = ref.trim();
    if (!value || value.length > 300 || value.includes('\0') || value.startsWith('-')) throw new Error('Referência Git inválida.');
    const resolved = (await this.workspaceGit(workspaceId, ['rev-parse', '--verify', '--end-of-options', `${value}^{commit}`])).trim();
    if (!/^[0-9a-f]{40,64}$/i.test(resolved)) throw new Error('Referência Git inválida.');
    return resolved;
  }

  private async resolveCommitWith(run: (args: string[]) => Promise<string>, ref: string): Promise<string> {
    const value = ref.trim();
    if (!value || value.length > 300 || value.includes('\0')) throw new Error('Referência Git inválida.');
    const resolved = (await run(['rev-parse', '--verify', '--end-of-options', `${value}^{commit}`])).trim();
    if (!/^[0-9a-f]{40,64}$/i.test(resolved)) throw new Error('Referência Git inválida.');
    return resolved;
  }
}

export const gitService = new GitService();
