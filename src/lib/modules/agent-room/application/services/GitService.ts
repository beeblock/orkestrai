import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { open, readFile, stat } from 'node:fs/promises';
import { extname, isAbsolute, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { workspaceRepository } from '../../infrastructure/repositories/WorkspaceRepository.js';
import { agentEnv } from '../../infrastructure/agent-path.js';

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
  private async root(workspaceId: string): Promise<string> {
    const workspace = await workspaceRepository.getWorkspace(workspaceId);
    if (!workspace) throw new Error('Workspace nao encontrado.');
    return workspace.workingDir;
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
    return new Promise((resolvePromise, reject) => {
      const child = spawn('git', args, { cwd, env: agentEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
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
    return this.statusDirectory(await this.root(workspaceId));
  }

  /** Internal read-only status for an already authorized repository or Floor. */
  async statusDirectory(cwd: string): Promise<GitStatusResult> {
    try {
      await this.git(cwd, ['rev-parse', '--is-inside-work-tree']);
    } catch {
      return { isRepo: false, branch: null, upstream: null, ahead: 0, behind: 0, head: null, revision: '', changes: [] };
    }

    const [branchOutput, headOutput, upstreamOutput, porcelain] = await Promise.all([
      this.git(cwd, ['branch', '--show-current']).catch(() => ''),
      this.git(cwd, ['rev-parse', 'HEAD']).catch(() => ''),
      this.git(cwd, ['rev-parse', '--abbrev-ref', '@{upstream}']).catch(() => ''),
      this.git(cwd, ['status', '--porcelain=v1', '-z', '-uall']),
    ]);
    const branch = branchOutput.trim() || null;
    const head = headOutput.trim() || null;
    const upstream = upstreamOutput.trim() || null;
    let ahead = 0;
    let behind = 0;
    if (upstream) {
      const counts = (await this.git(cwd, ['rev-list', '--left-right', '--count', '@{upstream}...HEAD']).catch(() => '')).trim().split(/\s+/);
      behind = Number(counts[0]) || 0;
      ahead = Number(counts[1]) || 0;
    }
    const changes = parsePorcelain(porcelain);
    const contentHashes = await Promise.all(changes.map(async (change) => {
      if (change.status === 'D') return `${change.id}:deleted`;
      const args = change.staged ? ['rev-parse', `:${change.path}`] : ['hash-object', '--', change.path];
      return `${change.id}:${(await this.git(cwd, args).catch(() => '')).trim()}`;
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
    const [base, head] = await Promise.all([
      this.resolveCommit(cwd, baseRef),
      this.resolveCommit(cwd, headRef),
    ]);
    const mergeBase = (await this.git(cwd, ['merge-base', base, head])).trim();
    if (!mergeBase) return [];
    const output = await this.git(cwd, [
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
        this.gitBufferLimited(cwd, ['show', `HEAD:${originalPath}`]).catch(() => ({ data: Buffer.alloc(0), truncated: false })),
        this.gitBufferLimited(cwd, ['show', `:${path}`]).catch(() => ({ data: Buffer.alloc(0), truncated: false })),
      ]);
      original = before.data;
      modified = after.data;
      truncated = before.truncated || after.truncated;
    } else {
      const before = await this.gitBufferLimited(cwd, ['show', `:${originalPath}`])
        .catch(() => this.gitBufferLimited(cwd, ['show', `HEAD:${originalPath}`]))
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
    const args = ['diff'];
    if (staged) args.push('--cached');
    if (path) args.push('--', path);
    return { diff: await this.git(cwd, args) };
  }

  async logGraph(workspaceId: string, limit = 25): Promise<{ graph: string }> {
    const graph = await this.git(await this.root(workspaceId), ['log', '--oneline', '--graph', '--decorate', '-n', String(limit)]).catch(() => '');
    return { graph };
  }

  async stage(workspaceId: string, path: string) {
    await this.git(await this.root(workspaceId), ['add', '--', path]);
    return { staged: path };
  }

  async unstage(workspaceId: string, path: string) {
    const cwd = await this.root(workspaceId);
    await this.git(cwd, ['restore', '--staged', '--', path]).catch(() => this.git(cwd, ['reset', 'HEAD', '--', path]));
    return { unstaged: path };
  }

  async commit(workspaceId: string, message: string) {
    const msg = message.trim();
    if (!msg) throw new Error('Informe a mensagem de commit.');
    await this.git(await this.root(workspaceId), ['commit', '-m', msg]);
    return { committed: msg };
  }

  async pull(workspaceId: string) { return { output: await this.git(await this.root(workspaceId), ['pull']) }; }
  async push(workspaceId: string) { return { output: await this.git(await this.root(workspaceId), ['push']) }; }

  async checkout(workspaceId: string, branch: string) {
    const name = branch.trim();
    if (!name) throw new Error('Informe a branch.');
    await this.git(await this.root(workspaceId), ['checkout', name]);
    return { checkedOut: name };
  }

  async createBranch(workspaceId: string, branch: string, checkout = true) {
    const name = branch.trim();
    if (!name) throw new Error('Informe o nome da branch.');
    await this.git(await this.root(workspaceId), ['branch', name]);
    if (checkout) await this.git(await this.root(workspaceId), ['checkout', name]);
    return { created: name };
  }

  async listBranches(workspaceId: string) {
    const output = await this.git(await this.root(workspaceId), ['branch', '--list', '--format=%(refname:short)']);
    return output.split('\n').map((line) => line.trim()).filter(Boolean);
  }

  async stash(workspaceId: string, pop = false) {
    return { output: await this.git(await this.root(workspaceId), pop ? ['stash', 'pop'] : ['stash', 'push', '-u']) };
  }

  async discard(workspaceId: string, path: string) {
    const cwd = await this.root(workspaceId);
    const change = (await this.status(workspaceId)).changes.find((item) => item.path === path && !item.staged);
    if (change?.status === '?') throw new Error('Arquivos novos devem ser removidos manualmente para evitar perda irreversivel.');
    await this.git(cwd, ['restore', '--', path]);
    return { discarded: path };
  }

  private async resolveCommit(cwd: string, ref: string): Promise<string> {
    const value = ref.trim();
    if (!value || value.length > 300 || value.includes('\0')) throw new Error('Referência Git inválida.');
    const resolved = (await this.git(cwd, ['rev-parse', '--verify', '--end-of-options', `${value}^{commit}`])).trim();
    if (!/^[0-9a-f]{40,64}$/i.test(resolved)) throw new Error('Referência Git inválida.');
    return resolved;
  }
}

export const gitService = new GitService();
