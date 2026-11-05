import { execFile, fork } from 'node:child_process';
import { createRequire } from 'node:module';
import { readlink } from 'node:fs/promises';
import { promisify } from 'node:util';
import type { WorkspaceExecutionRuntime } from '../../domain/types.ts';

const execute = promisify(execFile);
const require = createRequire(import.meta.url);
const limits = { encoding: 'utf8' as const, timeout: 2500, maxBuffer: 2 * 1024 * 1024, windowsHide: true, env: { ...process.env, LC_ALL: 'C' } };
export type ShellProcess = { pid: number; parent: number; group: number; foreground: number; started: string; executable: string };
export type ShellForegroundProcess = { pid: number; parent: number; key: string; executable: string; argv: string[]; cwd: string };

export function parseShellProcesses(text: string): ShellProcess[] {
  return text.split(/\r?\n/).flatMap(line => {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(-?\d+)\s+(\w{3}\s+\w{3}\s+\d+\s+[\d:]+\s+\d{4})\s+(.+)$/);
    return match ? [{ pid: +match[1], parent: +match[2], group: +match[3], foreground: +match[4], started: match[5], executable: match[6] }] : [];
  });
}

/** Only this PTY's foreground descendants, never background jobs or sibling terminals. */
export function foregroundDescendants(rows: ShellProcess[], root: number, windows = false): ShellProcess[] {
  const byId = new Map(rows.map(row => [row.pid, row]));
  const terminal = byId.get(root);
  if (!terminal) throw new Error('Shell process is no longer available.');
  if (!windows && terminal.foreground <= 0) throw new Error('Shell foreground process could not be confirmed.');
  const belongs = (row: ShellProcess) => {
    const seen = new Set<number>();
    let current: ShellProcess | undefined = row;
    while (current && !seen.has(current.pid)) {
      if (current.pid === root) return true;
      seen.add(current.pid);
      current = byId.get(current.parent);
    }
    return false;
  };
  return rows.filter(row => belongs(row) && (windows || row.group === terminal.foreground));
}

/** Keep only the executable and possible Node entrypoint; discard remaining arguments. */
export function launcherArguments(line: string): string[] {
  const words = line.trim().match(/"[^"]*"|'[^']*'|[^\s]+/g) ?? [];
  return words.slice(0, 2).map(word => word.replace(/^(["'])(.*)\1$/, '$2'));
}

export function windowsConsoleForeground(value: unknown, consoleIds: number[], root: number, cwd: string): ShellForegroundProcess[] {
  const records = Array.isArray(value) ? value : [value];
  if (records.length > 4096) throw new Error('Shell console process list exceeds the inspection limit.');
  const allowed = new Set(consoleIds);
  const rows: ShellProcess[] = [];
  const argumentsByPid = new Map<number, string[]>();
  for (const value of records) {
    if (!value || typeof value !== 'object') throw new Error('Invalid shell process record.');
    const row = value as Record<string, unknown>;
    if (!Number.isSafeInteger(row.ProcessId) || !Number.isSafeInteger(row.ParentProcessId)
      || typeof row.CreationDate !== 'string' || !row.CreationDate || row.CreationDate.length > 100) throw new Error('Invalid shell process identity.');
    const pid = Number(row.ProcessId);
    if (!allowed.has(pid)) continue;
    const executable = row.ExecutablePath || row.Name;
    if (typeof executable !== 'string' || executable.length > 4096) throw new Error('Invalid shell executable identity.');
    if (row.CommandLine != null && (typeof row.CommandLine !== 'string' || row.CommandLine.length > 65536)) throw new Error('Invalid shell launcher identity.');
    rows.push({ pid, parent: Number(row.ParentProcessId), group: 0, foreground: 0, started: row.CreationDate, executable });
    argumentsByPid.set(pid, launcherArguments(typeof row.CommandLine === 'string' ? row.CommandLine : ''));
  }
  const owned = foregroundDescendants(rows, root, true);
  if (owned.length > 32) throw new Error('Shell foreground process tree is ambiguous.');
  return owned.map(row => ({ pid: row.pid, parent: row.parent, key: row.pid + ':' + row.started,
    executable: row.executable, cwd, argv: argumentsByPid.get(row.pid) ?? [] }));
}

function consoleProcesses(pid: number): Promise<number[]> {
  return new Promise((resolve, reject) => {
    // The pinned node-pty helper attaches from a separate process. The Core
    // must never change its own console, nor adopt a CLI in another window.
    const child = fork(require.resolve('node-pty/lib/conpty_console_list_agent.js'), [String(pid)], { silent: true, windowsHide: true });
    const timer = setTimeout(() => finish(new Error('Shell console inspection timed out.')), 2500);
    const finish = (error?: Error, ids?: number[]) => {
      clearTimeout(timer);
      child.removeAllListeners();
      child.kill();
      error ? reject(error) : resolve(ids!);
    };
    child.once('error', error => finish(error));
    child.once('exit', () => finish(new Error('Shell console inspection failed.')));
    child.once('message', message => {
      const ids = (message as { consoleProcessList?: unknown }).consoleProcessList;
      if (!Array.isArray(ids) || ids.length > 4096 || !ids.includes(pid) || ids.some(id => !Number.isSafeInteger(id) || id <= 0)) {
        finish(new Error('Invalid shell console process list.'));
      } else finish(undefined, ids);
    });
  });
}

export async function inspectShellForeground(input: { pid: number; runtime: WorkspaceExecutionRuntime; guestPid?: number; cwd: string; accepts?: (process: ShellForegroundProcess) => boolean }): Promise<ShellForegroundProcess[]> {
  if (input.runtime.kind === 'native' && process.platform === 'win32') {
    const ids = await consoleProcesses(input.pid);
    const filter = ids.map(pid => 'ProcessId=' + pid).join(' OR ');
    const script = `Get-CimInstance Win32_Process -Filter '${filter}' | Select-Object ProcessId,ParentProcessId,CreationDate,ExecutablePath,Name,CommandLine | ConvertTo-Json -Compress`;
    const { stdout } = await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], limits);
    return windowsConsoleForeground(JSON.parse(stdout.replace(/^\uFEFF/, '')), ids, input.pid, input.cwd);
  }
  const runtime = input.runtime;
  const root = runtime.kind === 'wsl' ? input.guestPid : input.pid;
  if (!root) throw new Error('The WSL shell has no confirmed process identity. Reopen this Shell.');
  const run = (command: string, args: string[]) => runtime.kind === 'wsl'
    ? execute('wsl.exe', ['--distribution', runtime.distribution, '--exec', command, ...args], limits)
    : execute(command, args, limits);
  const { stdout } = await run('/bin/ps', ['-ax', '-o', 'pid=,ppid=,pgid=,tpgid=,lstart=,comm=']);
  const rows = foregroundDescendants(parseShellProcesses(stdout), root);
  // Foreground command trees are small. Bound inspection even for a malicious
  // fork tree; never perform per-process reads for every process on the host.
  if (rows.length > 32) throw new Error('Shell foreground process tree is ambiguous.');
  if (!rows.length) return [];
  const { stdout: argumentsText } = await run('/bin/ps', ['-p', rows.map(row => row.pid).join(','), '-o', 'pid=,args=']);
  const argumentsByPid = new Map(argumentsText.split(/\r?\n/).flatMap(line => {
    const match = line.match(/^\s*(\d+)\s+(.*)$/);
    return match ? [[Number(match[1]), launcherArguments(match[2])] as const] : [];
  }));
  return Promise.all(rows.map(async row => {
    const identity = { pid: row.pid, parent: row.parent, key: row.pid + ':' + row.started, executable: row.executable, argv: argumentsByPid.get(row.pid) ?? [], cwd: '' };
    if (input.accepts && !input.accepts(identity)) return identity;
    let cwd = '';
    if (runtime.kind === 'wsl') cwd = (await run('/bin/readlink', [`/proc/${row.pid}/cwd`])).stdout.trim();
    else if (process.platform === 'linux') cwd = await readlink(`/proc/${row.pid}/cwd`);
    else {
      const result = await run('/usr/sbin/lsof', ['-a', '-p', String(row.pid), '-d', 'cwd', '-Fn']);
      cwd = result.stdout.split(/\r?\n/).find(line => line.startsWith('n'))?.slice(1) ?? '';
    }
    return { ...identity, cwd };
  }));
}
