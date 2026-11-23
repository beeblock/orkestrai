import { mkdtemp, mkdir, readFile, stat, writeFile, rm, access } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join, resolve, posix } from 'node:path';
import { randomBytes } from 'node:crypto';
import { parse as parseToml } from 'smol-toml';
import { spawnStructuredAgent, stopStructuredAgent } from './structured-launch.js';
import { guestWorkingDirectoryAsync, wslHostPath } from '../../infrastructure/WslRuntime.js';
import type { StructuredAgentOptions } from './structured-types.js';

const allowedEnvironment = /^(?:PATH|HOME|USERPROFILE|USER|LOGNAME|SYSTEMROOT|WINDIR|COMSPEC|PATHEXT|LANG|LC_ALL|TMPDIR|TEMP|TMP|SSL_CERT_FILE|SSL_CERT_DIR|HTTPS?_PROXY|NO_PROXY|CLAUDE_CONFIG_DIR|CODEX_HOME|ANTHROPIC_(?:API_KEY|AUTH_TOKEN|BASE_URL)|OPENAI_API_KEY)$/i;

/** Never inherit workspace bridge credentials, NODE_OPTIONS or private launch flags. */
export function publicWorkerEnvironment(env: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(env).filter(([name]) => allowedEnvironment.test(name)));
}

export async function publicWorkerProbe(command: string, args: string[], options: StructuredAgentOptions): Promise<string> {
  const child = spawnStructuredAgent(command, args, options);
  let output = '', failed = false;
  const collect = (chunk: Buffer) => {
    if (Buffer.byteLength(output) + chunk.length > 8 * 1024 * 1024) { failed = true; child.kill(); return; }
    output += chunk.toString();
  };
  child.stdout.on('data', collect); child.stderr.resume();
  const timeout = setTimeout(() => { failed = true; void stopStructuredAgent(child).catch(() => undefined); }, 12_000);
  try {
    const code = await new Promise<number | null>((yes, no) => { child.once('error', no); child.once('exit', yes); });
    if (code !== 0 || failed) throw new Error('BOT_PUBLIC_RUNTIME_UNVERIFIED');
    return output.trim();
  } finally { clearTimeout(timeout); await stopStructuredAgent(child); }
}

export async function preparePublicWorker(provider: 'claude' | 'codex', original: StructuredAgentOptions,
  proxy: { url: string; token: string }, instructions: string, capabilities: { webSearch?: boolean } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'orkestrai-public-bot-'));
  try {
    const guest = async (path: string) => original.runtime.kind === 'wsl'
      ? guestWorkingDirectoryAsync(original.runtime, path) : path;
    const cwd = await guest(directory);
    const env = publicWorkerEnvironment(original.env);
    const home = original.runtime.kind === 'wsl'
      ? await publicWorkerProbe('sh', ['-c', 'printf %s "$HOME"'], original) : original.env.HOME ?? original.env.USERPROFILE ?? homedir();
    // CLI authentication remains in its selected account. Its config is never
    // copied or edited, and no host context becomes a model input.
    env.CODEX_HOME = original.env.CODEX_HOME ?? (original.runtime.kind === 'wsl' ? posix.join(home, '.codex') : join(home, '.codex'));
    if (original.env.CLAUDE_CONFIG_DIR) env.CLAUDE_CONFIG_DIR = original.env.CLAUDE_CONFIG_DIR;
    else delete env.CLAUDE_CONFIG_DIR;
    env.HOME = cwd; env.USERPROFILE = cwd;
    // Claude's default account identity is different from an explicitly set
    // CLAUDE_CONFIG_DIR, even when both resolve to ~/.claude. Keep its native
    // authentication scope; context/tools remain disabled independently.
    if (provider === 'claude') {
      env.HOME = home; env.USERPROFILE = original.env.USERPROFILE ?? home;
      delete env.CODEX_HOME; delete env.OPENAI_API_KEY;
    } else {
      delete env.CLAUDE_CONFIG_DIR;
      for (const name of Object.keys(env)) if (name.startsWith('ANTHROPIC_')) delete env[name];
    }
    if (original.runtime.kind === 'wsl') {
      env.ORKESTRAI_PUBLIC_HOME = provider === 'claude' ? home : cwd;
      env.ORKESTRAI_PUBLIC_PATH = await publicWorkerProbe('sh', ['-c', 'printf %s "$PATH"'], original);
    }
    env.ORKESTRAI_INFERENCE_PROXY_URL = proxy.url; env.ORKESTRAI_INFERENCE_PROXY_TOKEN = proxy.token;
    env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1';
    env.ENABLE_TOOL_SEARCH = 'false';
    if (original.runtime.kind === 'wsl') env.WSLENV = 'ORKESTRAI_INFERENCE_PROXY_URL:ORKESTRAI_INFERENCE_PROXY_TOKEN:ELECTRON_RUN_AS_NODE';
    if (process.versions.electron) env.ELECTRON_RUN_AS_NODE = '1';
    const serverName = `p_${randomBytes(6).toString('hex')}`;
    const options: StructuredAgentOptions = { ...original, hostCwd: directory, cwd, workspaceRoot: directory, env,
      instructions, launchArgs: [], session: () => null, saveSession: async () => {},
      bridgeMcp: { command: await guest(process.execPath), args: [await guest(resolve('packages/orkestrai-cli/src/inference-proxy.mjs'))],
        env: process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {} }, publicWorker: { serverName, webSearch: capabilities.webSearch === true } };
    if (provider === 'codex') {
      const version = await publicWorkerProbe('codex', ['--version'], options);
      // A new CLI contract must be verified before it can handle public input.
      if (!/^codex-cli 0\.171\.\d+\s*$/.test(version)) throw new Error('BOT_PUBLIC_RUNTIME_UNVERIFIED');
      const localConfig = original.runtime.kind === 'wsl'
        ? wslHostPath(original.runtime.distribution, posix.join(env.CODEX_HOME, 'config.toml')) : join(env.CODEX_HOME, 'config.toml');
      let config: Record<string, unknown> = {};
      try {
        if ((await stat(localConfig)).size > 1024 * 1024) throw new Error('BOT_PUBLIC_RUNTIME_UNVERIFIED');
        config = parseToml(await readFile(localConfig, 'utf8'));
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('BOT_PUBLIC_RUNTIME_UNVERIFIED'); }
      const servers = config.mcp_servers;
      if (servers && (typeof servers !== 'object' || Array.isArray(servers))) throw new Error('BOT_PUBLIC_RUNTIME_UNVERIFIED');
      const disabledServers = Object.keys(servers ?? {});
      if (disabledServers.length > 100 || disabledServers.some(name => !/^[A-Za-z0-9_-]{1,80}$/.test(name))) throw new Error('BOT_PUBLIC_RUNTIME_UNVERIFIED');
      const disabledFeatures = (await publicWorkerProbe('codex', ['features', 'list'], options)).split('\n')
        .flatMap(line => { const match = /^([a-z][a-z0-9_]*)\s+(.*?)\s+(?:true|false)$/.exec(line); return match && match[2].trim() !== 'removed' ? [match[1]] : []; });
      if (!disabledFeatures.includes('shell_tool') || !disabledFeatures.includes('hooks')) throw new Error('BOT_PUBLIC_RUNTIME_UNVERIFIED');
      const catalog = JSON.parse(await publicWorkerProbe('codex', ['debug', 'models', '--bundled'], options));
      const selected = catalog.models?.find((model: Record<string, unknown>) => model.slug === original.model) ?? (!original.model ? catalog.models?.find((model: Record<string, unknown>) => model.visibility === 'list') : null);
      if (!selected) throw new Error('BOT_PUBLIC_RUNTIME_UNVERIFIED');
      const file = join(directory, 'models.json');
      await writeFile(file, JSON.stringify({ models: [{ ...(await import('./delegated-inference.js')).inferenceOnlyModel(selected), base_instructions: instructions }] }), { mode: 0o600 });
      await mkdir(join(directory, 'state')); await mkdir(join(directory, 'logs'));
      const catalogPath = await guest(file);
      options.publicWorker = { serverName, webSearch: capabilities.webSearch === true, codexCatalog: catalogPath, disabledServers, disabledFeatures };
      options.model = selected.slug;
      options.launchArgs = ['--strict-config', '-c', `web_search=${JSON.stringify(capabilities.webSearch ? 'live' : 'disabled')}`, '-c', 'project_doc_max_bytes=0',
        '-c', 'include_environment_context=false', '-c', 'developer_instructions=""', '-c', 'history.persistence="none"',
        '-c', `sqlite_home=${JSON.stringify(await guest(join(directory, 'state')))}`, '-c', `log_dir=${JSON.stringify(await guest(join(directory, 'logs')))}`,
        '-c', `model_catalog_json=${JSON.stringify(catalogPath)}`,
        ...disabledServers.flatMap(name => ['-c', `mcp_servers.${name}.enabled=false`]),
        '-c', `mcp_servers.${serverName}.command=${JSON.stringify(options.bridgeMcp.command)}`,
        '-c', `mcp_servers.${serverName}.args=${JSON.stringify(options.bridgeMcp.args)}`,
        '-c', `mcp_servers.${serverName}.env_vars=["ORKESTRAI_INFERENCE_PROXY_URL","ORKESTRAI_INFERENCE_PROXY_TOKEN"]`,
        '-c', `mcp_servers.${serverName}.required=true`,
        ...(process.versions.electron ? ['-c', `mcp_servers.${serverName}.env.ELECTRON_RUN_AS_NODE="1"`] : []),
        ...disabledFeatures.flatMap(feature => ['--disable', feature])];
    } else {
      const managedRoot = process.platform === 'darwin' ? '/Library/Application Support/ClaudeCode'
        : process.platform === 'win32' ? join(process.env.ProgramFiles ?? 'C:\\Program Files', 'ClaudeCode') : '/etc/claude-code';
      for (const path of [join(managedRoot, 'CLAUDE.md'), join(managedRoot, 'managed-settings.json'), join(managedRoot, 'managed-settings.d'),
        ...(process.platform === 'darwin' ? ['/Library/Managed Preferences/com.anthropic.claudecode.plist'] : [])]) {
        if (await access(path).then(() => true, () => false)) throw new Error('BOT_PUBLIC_MANAGED_SETTINGS_UNSUPPORTED');
      }
      if (original.runtime.kind === 'wsl') {
        const present = await publicWorkerProbe('sh', ['-c', 'for p in /etc/claude-code/CLAUDE.md /etc/claude-code/managed-settings.json /etc/claude-code/managed-settings.d; do if test -e "$p"; then printf present; fi; done'], options);
        if (present) throw new Error('BOT_PUBLIC_MANAGED_SETTINGS_UNSUPPORTED');
      }
    }
    return { options, close: () => rm(directory, { recursive: true, force: true }) };
  } catch (error) { await rm(directory, { recursive: true, force: true }); throw error; }
}
