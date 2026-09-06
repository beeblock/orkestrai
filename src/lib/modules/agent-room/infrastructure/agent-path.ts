/**
 * Resolucao de PATH e de comandos das CLIs de agente registradas,
 * compartilhada por todos os caminhos de spawn:
 *   - canvas/PTY (PtySessionManager, node-pty)
 *   - Modo Maestro one-shot (application/agents.ts, child_process.spawn)
 *   - deteccao "installed" e listagem de modelos (adapters, child_process.execFile)
 *
 * Dois problemas so no Windows que este modulo resolve:
 *  1) PATH defasado: um app aberto pelo Explorer herda o PATH de quando o
 *     Explorer subiu; CLIs instaladas depois (winget/npm gravam no PATH do
 *     usuario no registro) so aparecem numa shell nova. Lemos o registro
 *     (HKCU/HKLM) para enxergar o mesmo PATH de uma shell recem-aberta —
 *     analogo Windows do login-shell PATH que resolvemos no macOS.
 *  2) node-pty/conpty e o child_process nao aplicam PATHEXT nem executam
 *     .cmd/.bat direto: spawnar o nome nu `claude`/`codex` falha. Resolvemos o
 *     nome para o executavel real (caminho absoluto p/ .exe; embrulho em
 *     `cmd.exe /c` p/ scripts).
 *
 * Em macOS/Linux tudo isto e no-op (guardado por IS_WIN): o comportamento
 * anterior — EXTRA_PATH_DIRS de Homebrew/nvm etc. — e preservado.
 */
import { execFile, execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, extname, join, resolve, sep } from 'node:path';
import { buildWslLaunch, currentWorkspaceExecutionRuntime, wslHostPath } from './WslRuntime.ts';

export const IS_WIN = process.platform === 'win32';

export function fallbackCliLauncher(
  platform: NodeJS.Platform,
  env: Record<string, string>,
  cliJs: string
): string | undefined {
  const launcherName = platform === 'win32' ? 'orkestrai.cmd' : 'orkestrai';
  const searchDirs = [env.ORKESTRAI_SHIM_DIR, ...(env.PATH ?? '').split(delimiter)].filter(Boolean) as string[];
  const launcher = searchDirs.map((dir) => join(dir, launcherName)).find((path) => existsSync(path));
  if (launcher) return launcher;
  // POSIX executa o .js pelo shebang. No Windows isso abriria o Windows Script
  // Host; sem launcher e mais seguro deixar a variavel ausente.
  return platform === 'win32' ? undefined : cliJs;
}

// Locais comuns de instalacao de CLIs. App aberto pelo Finder/Explorer recebe um
// PATH minimo — sem isto os agentes falham com ENOENT mesmo instalados.
const EXTRA_PATH_DIRS = IS_WIN
  ? [
      process.env.APPDATA ? `${process.env.APPDATA}\\npm` : '', // CLIs via npm -g (ex.: codex, opencode)
      process.env.LOCALAPPDATA ? `${process.env.LOCALAPPDATA}\\Microsoft\\WinGet\\Links` : '', // via winget
      process.env.LOCALAPPDATA ? `${process.env.LOCALAPPDATA}\\Microsoft\\WindowsApps` : '',
      process.env.LOCALAPPDATA ? `${process.env.LOCALAPPDATA}\\agy\\bin` : '', // Antigravity CLI
      `${homedir()}\\.cursor\\bin`, // Cursor Agent CLI
      `${homedir()}\\.kimi-code\\bin`, // kimi (instalador proprio, fora do PATH)
      `${homedir()}\\.local\\bin`,
      `${homedir()}\\.bun\\bin`,
      `${homedir()}\\.cargo\\bin`,
    ].filter(Boolean)
  : [
      '/opt/homebrew/bin',
      '/opt/homebrew/sbin',
      '/usr/local/bin',
      '/usr/local/sbin',
      `${homedir()}/.local/bin`,
      `${homedir()}/.bun/bin`,
      `${homedir()}/.volta/bin`,
      `${homedir()}/.deno/bin`,
      `${homedir()}/.cargo/bin`,
      `${homedir()}/.npm-global/bin`,
      `${homedir()}/.cursor/bin`,
      `${homedir()}/.kimi-code/bin`,
      `${homedir()}/bin`,
    ];

function nvmBins(): string[] {
  if (IS_WIN) return [];
  try {
    const root = `${homedir()}/.nvm/versions/node`;
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => `${root}/${entry.name}/bin`);
  } catch {
    return [];
  }
}

let cachedRegistryPathDirs: string[] | null = null;
function windowsRegistryPathDirs(): string[] {
  if (!IS_WIN) return [];
  if (cachedRegistryPathDirs) return cachedRegistryPathDirs;
  const readKey = (root: string): string => {
    try {
      const out = execFileSync('reg', ['query', root, '/v', 'Path'], {
        encoding: 'utf8',
        timeout: 5_000,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      const match = out.match(/\bPath\b\s+REG(?:_EXPAND)?_SZ\s+([^\r\n]*)/i);
      return match ? match[1].trim() : '';
    } catch {
      return '';
    }
  };
  const raw = [
    readKey('HKCU\\Environment'),
    readKey('HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment'),
  ]
    .filter(Boolean)
    .join(';');
  const expanded = raw.replace(/%([^%]+)%/g, (whole, name) => process.env[name] ?? whole);
  cachedRegistryPathDirs = expanded.split(';').map((entry) => entry.trim()).filter(Boolean);
  return cachedRegistryPathDirs;
}

const ALWAYS_PRIVATE_CHILD_ENV_KEYS = [
  'APP_KEY',
  'INTERNAL_SECRET',
  'ELECTRON_RUN_AS_NODE',
  'HOST',
  'PORT',
  'ORIGIN',
  'BODY_SIZE_LIMIT',
  'DB_PATH',
  'ORKESTRAI_DATA_DIR',
  'ORKESTRAI_PTY_MODULE',
  'ORKESTRAI_PRIVATE_ENV_KEYS',
] as const;

const REQUIRED_AGENT_ENV_KEYS = new Set([
  'ORKESTRAI_API_URL',
  'ORKESTRAI_SHIM_DIR',
  'ORKESTRAI_CLI',
  'ORKESTRAI_CLI_JS',
  'ORKESTRAI_CLI_RUNTIME',
  'ORKESTRAI_CLI_RUNTIME_IS_ELECTRON',
  'ORKESTRAI_CLI_CONSOLE_RUNTIME',
]);

/**
 * Impede que a configuracao do servidor desktop vaze para projetos abertos em
 * PTYs. Frameworks como Laravel tratam variaveis ja exportadas como imutaveis;
 * uma APP_KEY herdada venceria o .env do projeto e invalidaria dados cifrados.
 */
export function sanitizeAgentEnvironment(
  source: NodeJS.ProcessEnv | Record<string, string | undefined>
): Record<string, string> {
  const env = Object.fromEntries(
    Object.entries(source).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
  );
  const privateKeys = new Set([
    ...ALWAYS_PRIVATE_CHILD_ENV_KEYS,
    ...(source.ORKESTRAI_PRIVATE_ENV_KEYS ?? '').split(',').map((key) => key.trim()).filter(Boolean),
  ]);
  for (const key of privateKeys) {
    if (!REQUIRED_AGENT_ENV_KEYS.has(key)) delete env[key];
  }
  return env;
}

/**
 * Copia de process.env com o PATH aumentado: shim -> PATH herdado -> PATH do
 * registro (shell nova, so Win) -> dirs conhecidos -> nvm. O Set dedup mantendo
 * a primeira ocorrencia (preserva a prioridade herdada).
 */
export function agentEnv(): Record<string, string> {
  const env = sanitizeAgentEnvironment(process.env);
  const current = (env.PATH ?? '').split(delimiter).filter(Boolean);
  const shimDir = env.ORKESTRAI_SHIM_DIR ? [env.ORKESTRAI_SHIM_DIR] : [];
  const merged = [...shimDir, ...current, ...windowsRegistryPathDirs(), ...EXTRA_PATH_DIRS, ...nvmBins()];
  env.PATH = [...new Set(merged.filter(Boolean))].join(delimiter);
  // ORKESTRAI_CLI_JS e argumento do runtime nos configs MCP. ORKESTRAI_CLI e
  // executado diretamente pelos agentes e nunca pode apontar ao .js no Windows.
  const cliJs = resolve(process.cwd(), 'packages', 'orkestrai-cli', 'bin', 'orkestrai.js');
  if (!env.ORKESTRAI_CLI_JS) env.ORKESTRAI_CLI_JS = cliJs;
  if (!env.ORKESTRAI_CLI) {
    const launcher = fallbackCliLauncher(process.platform, env, cliJs);
    if (launcher) env.ORKESTRAI_CLI = launcher;
  }
  return env;
}

/**
 * No Windows resolve um nome "nu" (claude/codex) para algo spawnavel: varre
 * PATH + PATHEXT; .exe/.com -> caminho absoluto; script (.cmd/.bat/.ps1) ->
 * `cmd.exe /c <nome>` (o cmd resolve via PATHEXT, como um shell). Comandos ja
 * com .exe, caminho, espaco ou aspas (shells) passam intactos. macOS/Linux:
 * no-op.
 */
export function resolveCommand(
  command: string,
  args: string[],
  env: Record<string, string>
): { command: string; args: string[] } {
  if (!IS_WIN) return { command, args };
  if (!/^[A-Za-z0-9._-]+$/.test(command) || /\.(exe|com)$/i.test(command)) return { command, args };

  const pathext = (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').map((entry) => entry.trim()).filter(Boolean);
  const dirs = (env.PATH ?? '').split(delimiter).filter(Boolean);
  const candidates = extname(command) ? [command] : [...pathext.map((ext) => command + ext), command];

  let resolved: string | null = null;
  for (const dir of dirs) {
    for (const candidate of candidates) {
      const full = dir.endsWith(sep) ? `${dir}${candidate}` : `${dir}${sep}${candidate}`;
      if (existsSync(full)) {
        resolved = full;
        break;
      }
    }
    if (resolved) break;
  }
  if (!resolved) return { command, args };

  const rext = extname(resolved).toLowerCase();
  if (rext === '.exe' || rext === '.com') return { command: resolved, args };
  const comspec = env.ComSpec ?? env.COMSPEC ?? 'cmd.exe';
  return { command: comspec, args: ['/d', '/s', '/c', command, ...args] };
}

/** Env + comando resolvido prontos para child_process.spawn/execFile. */
export function cliInvocation(
  command: string,
  args: string[]
): { command: string; args: string[]; env: Record<string, string> } {
  const env = agentEnv();
  const runtime = currentWorkspaceExecutionRuntime();
  if (runtime.kind === 'wsl') {
    const target = buildWslLaunch({
      runtime,
      command,
      args,
      hostCwd: wslHostPath(runtime.distribution, runtime.linuxWorkingDir),
      hostEnv: env,
    });
    return { command: target.command, args: target.args, env: target.env };
  }
  const target = resolveCommand(command, args, env);
  return { command: target.command, args: target.args, env };
}

/** Deteccao "installed" de uma CLI, com PATH/resolucao corretos por plataforma. */
export function probeCliVersion(
  command: string,
  args: string[] = ['--version']
): Promise<{ installed: boolean; detail?: string }> {
  return new Promise((resolve) => {
    const inv = cliInvocation(command, args);
    execFile(
      inv.command,
      inv.args,
      { timeout: 8_000, encoding: 'utf8', env: inv.env, windowsHide: true },
      (error, stdout, stderr) => {
        resolve({
          installed: !error,
          detail: error ? String(error.message).split('\n')[0] : String(stdout || stderr).trim(),
        });
      }
    );
  });
}
