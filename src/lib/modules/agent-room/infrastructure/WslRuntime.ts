import { AsyncLocalStorage } from 'node:async_hooks';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { win32, posix, resolve } from 'node:path';
import type { WorkspaceExecutionRuntime } from '../domain/types.js';

export { terminalExecutionRuntime, workspaceExecutionRuntime } from '../domain/runtime.ts';

const execFileAsync = promisify(execFile);
const runtimeContext = new AsyncLocalStorage<WorkspaceExecutionRuntime>();

export type WslDistribution = { name: string };

export type WslLaunchErrorCode =
  | 'WSL_DISTRIBUTION_UNAVAILABLE'
  | 'WSL_DIRECTORY_NOT_FOUND'
  | 'WSL_COMMAND_NOT_FOUND'
  | 'WSL_SPAWN_FAILED';

export class WslLaunchError extends Error {
  readonly code: WslLaunchErrorCode;

  constructor(code: WslLaunchErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'WslLaunchError';
  }
}

export type WslTrackingContext = {
  homeHostPath: string;
  linuxHomePath: string;
  linuxWorkingDir: string;
};

export function parseWslDistributionList(output: string): WslDistribution[] {
  const names = output
    .replace(/\u0000/g, '')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((name) => name.trim())
    .filter(Boolean);
  return [...new Set(names)].map((name) => ({ name }));
}

export function inferWslRuntimeFromPath(path: string): { distribution: string; linuxWorkingDir: string } | null {
  const match = path.trim().match(/^\\\\(?:wsl\$|wsl\.localhost)\\([^\\]+)(?:\\(.*))?$/i);
  if (!match) return null;
  const tail = (match[2] ?? '').split('\\').filter(Boolean).join('/');
  return {
    distribution: match[1],
    linuxWorkingDir: tail ? `/${tail}` : '/',
  };
}

export function wslHostPath(distribution: string, linuxPath: string): string {
  const tail = linuxPath.replace(/^\/+/, '').split('/').filter(Boolean).join('\\');
  return `\\\\wsl.localhost\\${distribution}${tail ? `\\${tail}` : ''}`;
}

export function currentWorkspaceExecutionRuntime(): WorkspaceExecutionRuntime {
  return runtimeContext.getStore() ?? { kind: 'native' };
}

export function withWorkspaceExecutionRuntime<T>(runtime: WorkspaceExecutionRuntime, callback: () => T): T {
  return runtimeContext.run(runtime, callback);
}

export async function listWslDistributions(): Promise<WslDistribution[]> {
  if (process.platform !== 'win32') return [];
  const { stdout } = await execFileAsync('wsl.exe', ['--list', '--quiet'], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 10_000,
  });
  return parseWslDistributionList(stdout);
}

async function assertDistribution(distribution: string): Promise<void> {
  const installed = await listWslDistributions();
  if (!installed.some((item) => item.name === distribution)) {
    throw new Error(`A distribuição WSL "${distribution}" não está instalada.`);
  }
}

async function windowsPathToWsl(distribution: string, hostPath: string): Promise<string> {
  const { stdout } = await execFileAsync(
    'wsl.exe',
    ['--distribution', distribution, '--exec', 'wslpath', '-u', hostPath],
    { encoding: 'utf8', windowsHide: true, timeout: 10_000 }
  );
  return stdout.trim();
}

async function linuxPathToWindows(distribution: string, linuxPath: string): Promise<string> {
  const { stdout } = await execFileAsync(
    'wsl.exe',
    ['--distribution', distribution, '--exec', 'wslpath', '-w', linuxPath],
    { encoding: 'utf8', windowsHide: true, timeout: 10_000 },
  );
  return stdout.trim();
}

function canonicalHostPath(path: string): string {
  return win32.normalize(path.trim())
    .replace(/^\\\\wsl\$\\/i, '\\\\wsl.localhost\\')
    .replace(/[\\/]+$/, '')
    .toLowerCase();
}

export type ResolvedWorkspaceRuntime = {
  workingDir: string;
  runtime: WorkspaceExecutionRuntime;
};

export async function resolveTerminalRuntimeOverride(input: {
  mode: 'default' | 'native' | 'wsl';
  workingDir: string;
  wslDistribution?: string | null;
  wslWorkingDir?: string | null;
}): Promise<WorkspaceExecutionRuntime | null> {
  if (input.mode === 'default') return null;
  if (input.mode === 'native') return { kind: 'native' };
  const resolved = await resolveWorkspaceRuntime({
    runtimeKind: 'wsl',
    workingDir: input.workingDir,
    wslDistribution: input.wslDistribution,
    wslWorkingDir: input.wslWorkingDir,
  });
  return resolved.runtime;
}

export async function resolveWorkspaceRuntime(input: {
  runtimeKind?: 'native' | 'wsl';
  workingDir: string;
  wslDistribution?: string | null;
  wslWorkingDir?: string | null;
}): Promise<ResolvedWorkspaceRuntime> {
  if (input.runtimeKind !== 'wsl') {
    return { workingDir: input.workingDir.trim(), runtime: { kind: 'native' } };
  }
  if (process.platform !== 'win32') throw new Error('WSL só está disponível no Windows.');

  const inferred = inferWslRuntimeFromPath(input.workingDir);
  const distribution = input.wslDistribution?.trim() || inferred?.distribution;
  if (!distribution) throw new Error('Selecione uma distribuição WSL.');
  await assertDistribution(distribution);

  let linuxWorkingDir = input.wslWorkingDir?.trim() || inferred?.linuxWorkingDir;
  if (!linuxWorkingDir && /^[A-Za-z]:[\\/]/.test(input.workingDir.trim())) {
    linuxWorkingDir = await windowsPathToWsl(distribution, input.workingDir.trim());
  }
  if (!linuxWorkingDir?.startsWith('/')) {
    throw new Error('Informe um caminho Linux absoluto para o workspace WSL.');
  }

  await execFileAsync(
    'wsl.exe',
    ['--distribution', distribution, '--exec', 'test', '-d', linuxWorkingDir],
    { windowsHide: true, timeout: 15_000 }
  ).catch(() => {
    throw new Error(`O diretório não existe em ${distribution}: ${linuxWorkingDir}`);
  });

  const rawHostPath = input.workingDir.trim();
  const mappedHostPath = await linuxPathToWindows(distribution, linuxWorkingDir);
  // O diretório host é sempre derivado do caminho Linux. Só validamos quando o
  // chamador envia um caminho Windows explícito (não vazio e não-Linux), que
  // precisa apontar para a mesma pasta; um host vazio nós derivamos.
  const hasExplicitHostPath = rawHostPath.length > 0 && !rawHostPath.startsWith('/');
  if (hasExplicitHostPath && canonicalHostPath(rawHostPath) !== canonicalHostPath(mappedHostPath)) {
    throw new Error(`O caminho Linux não corresponde à pasta do workspace: ${mappedHostPath}`);
  }
  const workingDir = hasExplicitHostPath ? rawHostPath : mappedHostPath;
  return {
    workingDir,
    runtime: { kind: 'wsl', distribution, linuxWorkingDir },
  };
}

export function guestWorkingDirectory(
  runtime: Extract<WorkspaceExecutionRuntime, { kind: 'wsl' }>,
  hostCwd: string,
  workspaceRoot?: string
): string {
  const inferred = inferWslRuntimeFromPath(hostCwd);
  if (inferred?.distribution === runtime.distribution) return inferred.linuxWorkingDir;

  if (workspaceRoot) {
    const relative = win32.relative(workspaceRoot, hostCwd);
    if (relative && relative !== '..' && !relative.startsWith(`..${win32.sep}`) && !win32.isAbsolute(relative)) {
      return posix.join(runtime.linuxWorkingDir, relative.split(win32.sep).join('/'));
    }
    if (!relative) return runtime.linuxWorkingDir;
  }

  if (process.platform === 'win32') {
    try {
      return execFileSync(
        'wsl.exe',
        ['--distribution', runtime.distribution, '--exec', 'wslpath', '-u', hostCwd],
        { encoding: 'utf8', windowsHide: true, timeout: 10_000 }
      ).trim();
    } catch {
      // The workspace root remains the safest valid fallback for a stale floor path.
    }
  }
  return runtime.linuxWorkingDir;
}

function wslFailure(error: unknown, runtime: Extract<WorkspaceExecutionRuntime, { kind: 'wsl' }>, command?: string): WslLaunchError {
  const candidate = error as NodeJS.ErrnoException & { stderr?: string; stdout?: string };
  const detail = `${candidate.message ?? ''}\n${candidate.stderr ?? ''}\n${candidate.stdout ?? ''}`.trim();
  if (/distribution|distro|WSL_E_DISTRO_NOT_FOUND|there is no distribution/i.test(detail)) {
    return new WslLaunchError('WSL_DISTRIBUTION_UNAVAILABLE', `WSL distribution is unavailable: ${runtime.distribution}`);
  }
  if (/chdir|directory|no such file|WSL_E_PATH_NOT_FOUND/i.test(detail)) {
    return new WslLaunchError('WSL_DIRECTORY_NOT_FOUND', `WSL working directory is unavailable: ${runtime.linuxWorkingDir}`);
  }
  if (command) return new WslLaunchError('WSL_COMMAND_NOT_FOUND', `Command is not installed in ${runtime.distribution}: ${command}`);
  return new WslLaunchError('WSL_SPAWN_FAILED', detail || `WSL failed to start: ${runtime.distribution}`);
}

export async function resolveWslTrackingContext(input: {
  runtime: Extract<WorkspaceExecutionRuntime, { kind: 'wsl' }>;
  hostCwd: string;
  workspaceRoot?: string;
}): Promise<WslTrackingContext> {
  const linuxWorkingDir = guestWorkingDirectory(input.runtime, input.hostCwd, input.workspaceRoot);
  try {
    const { stdout } = await execFileAsync('wsl.exe', [
      '--distribution', input.runtime.distribution,
      '--cd', linuxWorkingDir,
      '--exec', '/bin/sh', '-lc', 'printf "__ORKESTRAI_HOME__%s\\n" "$HOME"',
    ], { encoding: 'utf8', windowsHide: true, timeout: 15_000 });
    const home = stdout.split(/\r?\n/).find((line) => line.startsWith('__ORKESTRAI_HOME__'))?.slice('__ORKESTRAI_HOME__'.length).trim();
    if (!home?.startsWith('/')) throw new Error('WSL did not report its home directory.');
    return { homeHostPath: wslHostPath(input.runtime.distribution, home), linuxHomePath: home, linuxWorkingDir };
  } catch (error) {
    throw wslFailure(error, input.runtime);
  }
}

export async function preflightWslLaunch(input: {
  runtime: Extract<WorkspaceExecutionRuntime, { kind: 'wsl' }>;
  command: string;
  hostCwd: string;
  workspaceRoot?: string;
}): Promise<WslTrackingContext> {
  const context = await resolveWslTrackingContext(input);
  const originalCommand = input.command.trim();
  const command = /^(?:wsl(?:\.exe)?|cmd(?:\.exe)?|powershell(?:\.exe)?|pwsh(?:\.exe)?)$/i.test(originalCommand)
    ? '/bin/bash'
    : originalCommand;
  try {
    await execFileAsync('wsl.exe', [
      '--distribution', input.runtime.distribution,
      '--cd', context.linuxWorkingDir,
      '--exec', '/bin/bash', '-lic', 'command -v -- "$1" >/dev/null', 'orkestrai-preflight', command,
    ], { encoding: 'utf8', windowsHide: true, timeout: 15_000 });
    return context;
  } catch (error) {
    throw wslFailure(error, input.runtime, command);
  }
}

function guestArgument(
  runtime: Extract<WorkspaceExecutionRuntime, { kind: 'wsl' }>,
  argument: string,
  workspaceRoot?: string
): string {
  const inferred = inferWslRuntimeFromPath(argument);
  if (inferred?.distribution === runtime.distribution) return inferred.linuxWorkingDir;
  if (!workspaceRoot) return argument;

  const relative = win32.relative(workspaceRoot, argument);
  if (relative === '') return runtime.linuxWorkingDir;
  if (relative === '..' || relative.startsWith(`..${win32.sep}`) || win32.isAbsolute(relative)) return argument;
  return posix.join(runtime.linuxWorkingDir, relative.split(win32.sep).join('/'));
}

function appendWslEnv(current: string | undefined, names: string[]): string {
  const entries = (current ?? '').split(':').filter(Boolean);
  return [...new Set([...entries, ...names])].join(':');
}

export function buildWslLaunch(input: {
  runtime: Extract<WorkspaceExecutionRuntime, { kind: 'wsl' }>;
  command: string;
  args: string[];
  hostCwd: string;
  workspaceRoot?: string;
  hostEnv: Record<string, string>;
  /** Names resolved from a server-side Provider Profile. Values stay in the
      child environment; WSLENV forwards only these explicit names. */
  forwardEnvToWsl?: string[];
}): { command: string; args: string[]; cwd: string; env: Record<string, string> } {
  const { runtime } = input;
  const linuxRoot = runtime.linuxWorkingDir.replace(/\/$/, '') || '/';
  const workspaceBin = posix.join(linuxRoot, '.orkestrai', 'bin');
  const cliJs = input.hostEnv.ORKESTRAI_CLI_JS ?? resolve(process.cwd(), 'packages', 'orkestrai-cli', 'bin', 'orkestrai.js');
  const originalCommand = input.command.trim();
  const command = /^(?:wsl(?:\.exe)?|cmd(?:\.exe)?|powershell(?:\.exe)?|pwsh(?:\.exe)?)$/i.test(originalCommand)
    ? '/bin/bash'
    : originalCommand;
  const env: Record<string, string> = {
    ...input.hostEnv,
    ORKESTRAI_ROOT_PATH: linuxRoot,
    ORKESTRAI_WORKSPACE_BIN: workspaceBin,
    ORKESTRAI_CLI: posix.join(workspaceBin, 'orkestrai'),
    ORKESTRAI_RUNTIME_WIN: process.execPath,
    ORKESTRAI_CLI_JS_WIN: cliJs,
  };
  const forwarded = [
    'ORKESTRAI_API_URL',
    'ORKESTRAI_NODE_ID',
    'ORKESTRAI_AGENT_TITLE',
    'ORKESTRAI_AGENT_TOKEN',
    'ORKESTRAI_WORKSPACE_CONFIG',
    'ORKESTRAI_ROOT_PATH',
    'ORKESTRAI_WORKSPACE_BIN',
    'ORKESTRAI_CLI',
    'ORKESTRAI_RUNTIME_WIN',
    'ORKESTRAI_CLI_JS_WIN',
    ...(input.forwardEnvToWsl ?? []).filter((name) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(name)),
  ];
  env.WSLENV = appendWslEnv(env.WSLENV, forwarded);

  return {
    command: 'wsl.exe',
    args: [
      '--distribution',
      runtime.distribution,
      '--cd',
      guestWorkingDirectory(runtime, input.hostCwd, input.workspaceRoot),
      '--exec',
      '/bin/bash',
      '-lic',
      'export PATH="$ORKESTRAI_WORKSPACE_BIN:$PATH"; exec "$@"',
      'orkestrai-runtime',
      command,
      ...input.args.map((argument) => guestArgument(runtime, argument, input.workspaceRoot)),
    ],
    cwd: process.env.SystemRoot ?? process.env.USERPROFILE ?? process.cwd(),
    env,
  };
}
