import { delegatedImageTools } from './delegated-image-tools.js';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile, access, readFile, stat } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { agentEnv, resolveCommand } from '$lib/modules/agent-room/infrastructure/agent-path.js';
import { providerProfileService } from '$lib/modules/agent-room/application/services/ProviderProfileService.js';
import { JsonLineProcess } from './delegated-process.js';
import { guestToolProxy } from '$lib/modules/model-access/infrastructure/providers/GuestToolProxy.js';
import type { InferenceProvider, InferenceProviderRun } from '$lib/modules/model-access/infrastructure/providers/InferenceProvider.js';

const MAX_OUTPUT = 16 * 1024 * 1024;
const allowed = new Set(['PATH','HOME','USERPROFILE','USER','LOGNAME','SYSTEMROOT','COMSPEC','PATHEXT','LANG','LC_ALL','TMPDIR','TEMP','TMP']);
function environment() { return Object.fromEntries(Object.entries(agentEnv()).filter(([key, value]) => allowed.has(key.toUpperCase()) && typeof value === 'string')) as Record<string, string>; }
function probe(provider: string, args: string[], env: Record<string, string>, cwd: string): Promise<string> {
  const invocation = resolveCommand(provider, args, env);
  return new Promise((resolve, reject) => execFile(invocation.command, invocation.args, { cwd, env, timeout: 10000, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8', windowsHide: true }, (error, stdout, stderr) => error ? reject(new Error('INFERENCE_CLI_UNAVAILABLE')) : resolve(stdout || stderr)));
}
async function assertNoManagedHostContext() {
  const root = process.platform === 'darwin' ? '/Library/Application Support/ClaudeCode' : process.platform === 'win32' ? join(process.env.ProgramFiles ?? 'C:\\Program Files', 'ClaudeCode') : '/etc/claude-code';
  const paths = [join(root, 'CLAUDE.md'), join(root, 'managed-settings.json'), join(root, 'managed-settings.d'), ...(process.platform === 'darwin' ? ['/Library/Managed Preferences/com.anthropic.claudecode.plist'] : [])];
  for (const path of paths) { let present = false; try { await access(path); present = true; } catch {} if (present) throw new Error('INFERENCE_MANAGED_SETTINGS_UNSUPPORTED'); }
}
async function verifyAccount(provider: 'claude' | 'codex', env: Record<string,string>, profile: Record<string,string>, directory: string, images: boolean) {
  if (provider === 'claude') {
    await assertNoManagedHostContext();
    let account: any; try { account = JSON.parse(await probe('claude', ['auth','status','--json'], { ...env, ...profile }, directory)); } catch { throw new Error('INFERENCE_ACCOUNT_NOT_READY'); }
    if (!account.loggedIn || account.authMethod !== 'claude.ai' || !['pro','max'].includes(account.subscriptionType)) throw new Error('INFERENCE_PERSONAL_SUBSCRIPTION_REQUIRED');
  } else {
    const profileEnv = { ...env, CODEX_HOME: profile.CODEX_HOME ?? join(homedir(), '.codex') };
    if (!/ChatGPT/i.test(await probe('codex', ['login','status'], profileEnv, directory))) throw new Error('INFERENCE_PERSONAL_SUBSCRIPTION_REQUIRED');
    if (images) {
      try {
        const file = join(profileEnv.CODEX_HOME, 'auth.json'); if ((await stat(file)).size > 128 * 1024) throw new Error();
        const auth = JSON.parse(await readFile(file,'utf8')); if (!auth.tokens?.access_token || !auth.tokens?.account_id) throw new Error();
      } catch { throw new Error('INFERENCE_IMAGE_AUTH_UNAVAILABLE'); }
    }
  }
}
export async function verifyDelegatedAccount(provider: 'claude' | 'codex', profileId: string | null, images: boolean) {
  const directory = await mkdtemp(join(tmpdir(), 'orkestrai-account-check-'));
  try {
    const env = environment(), profile = profileId ? await providerProfileService.resolveEnv(profileId, provider) : {};
    const version = await probe(provider,['--version'],env,directory);
    if (provider === 'codex' && !/^codex-cli 0\.165\.\d+\s*$/.test(version) || provider === 'claude' && !/^2\.1\.(31[2-9]|3[2-9]\d)\b/.test(version)) throw new Error('INFERENCE_CLI_VERSION_UNVERIFIED');
    await verifyAccount(provider,env,profile,directory,images);
  } finally { await rm(directory,{recursive:true,force:true}); }
}
/** Only custom catalog tools and the authenticated guest MCP exist in this worker. */
export function inferenceOnlyModel(model: Record<string, unknown>) {
  return { ...model, shell_type: 'disabled', apply_patch_tool_type: null, experimental_supported_tools: [],
    supports_search_tool: false, node_repl_disabled: true, tool_mode: 'direct', multi_agent_version: null,
    include_skills_usage_instructions: false, include_plugin_usage_instructions: false, include_apps_usage_instructions: false,
    model_messages: null, use_responses_lite: false, base_instructions: 'You are an agent operating exclusively through the guest tools. All tools execute on the guest computer. You have no host tools, files or terminal.' };
}
export class NativeInferenceProvider implements InferenceProvider {
  constructor(private options: { process?: (...args: ConstructorParameters<typeof JsonLineProcess>) => JsonLineProcess; verifyAccount?: typeof verifyAccount } = {}) {}
  async run(input: InferenceProviderRun) {
    const directory = await mkdtemp(join(tmpdir(), 'orkestrai-inference-'));
    let proxy: Awaited<ReturnType<typeof guestToolProxy>> | undefined, child: JsonLineProcess | undefined;
    try {
      const provider = input.offering.providerId;
      const env = environment();
      const profile = input.offering.profileId ? await providerProfileService.resolveEnv(input.offering.profileId, provider) : {};
      input.signal.throwIfAborted();
      if (provider === 'claude') await assertNoManagedHostContext();
      const version = await probe(provider, ['--version'], env, directory);
      if (provider === 'codex' && !/^codex-cli 0\.165\.\d+\s*$/.test(version)) throw new Error('INFERENCE_CLI_VERSION_UNVERIFIED');
      if (provider === 'claude' && !/^2\.1\.(31[2-9]|3[2-9]\d)\b/.test(version)) throw new Error('INFERENCE_CLI_VERSION_UNVERIFIED');
      await (this.options.verifyAccount ?? verifyAccount)(provider, env, profile, directory, input.offering.images);
      proxy = await guestToolProxy({ ...input, callTool: delegatedImageTools(input,profile) });
      const proxyScript = resolve(process.cwd(), 'packages/orkestrai-cli/src/inference-proxy.mjs');
      env.ORKESTRAI_INFERENCE_PROXY_URL = proxy.url; env.ORKESTRAI_INFERENCE_PROXY_TOKEN = proxy.token;
      // A real Node or Electron RUN_AS_NODE starts only our proxy. Nothing is resolved from a guest command.
      const mcpRuntime = process.execPath;
      const proxyContext = join(directory, 'guest-context.json');
      await writeFile(proxyContext, JSON.stringify({ url: proxy.url, token: proxy.token }), { mode: 0o600 });
      const mcpEnv = { ELECTRON_RUN_AS_NODE: '1' };
      let args: string[];
      if (provider === 'codex') {
        const catalog = JSON.parse(await probe('codex', ['debug','models','--bundled'], env, directory));
        const model = catalog.models?.find((m: Record<string, unknown>) => m.slug === input.request.model);
        if (!model) throw new Error('INFERENCE_MODEL_UNAVAILABLE');
        const efforts = model.supported_reasoning_levels?.map((level: { effort: string }) => level.effort) ?? [];
        if (!efforts.includes(input.request.effort)) throw new Error('INFERENCE_EFFORT_UNAVAILABLE');
        const features = (await probe('codex', ['features','list'], env, directory)).split('\n').map(line => line.match(/^([a-z][a-z0-9_]*)\s+.+\s+(?:true|false)$/)?.[1]).filter(Boolean) as string[];
        if (!features.includes('shell_tool') || !features.includes('plugins') || !features.includes('code_mode_host')) throw new Error('INFERENCE_CLI_VERSION_UNVERIFIED');
        await mkdir(join(directory,'state'),{mode:0o700}); await mkdir(join(directory,'logs'),{mode:0o700});
        const catalogFile = join(directory, 'models.json'); await writeFile(catalogFile, JSON.stringify({ models: [inferenceOnlyModel(model)] }), { mode: 0o600 });
        const policyFile = join(directory, 'instructions.txt'); await writeFile(policyFile, input.request.system, { mode: 0o600 });
        env.CODEX_HOME = profile.CODEX_HOME ?? join(homedir(), '.codex');
        env.HOME = directory; env.USERPROFILE = directory;
        args = ['exec','--json','--ephemeral','--skip-git-repo-check','--ignore-user-config','--ignore-rules','--strict-config','--sandbox','read-only',
          '-c',`sqlite_home=${JSON.stringify(join(directory,'state'))}`,'-c',`log_dir=${JSON.stringify(join(directory,'logs'))}`,'-c','history.persistence="none"','-c','approval_policy="never"','-c',`projects.${JSON.stringify(directory)}.trust_level="trusted"`,'-c','plugins={}','-c','web_search="disabled"','-c','project_doc_max_bytes=0',
          '-c','include_environment_context=false','-c','developer_instructions=""','-c','mcp_servers={}','-c','skills.include_instructions=false','-c','shell_environment_policy.inherit="none"',
          '-c',`model_catalog_json=${JSON.stringify(catalogFile)}`,'-c',`model_instructions_file=${JSON.stringify(policyFile)}`,
          '-c',`model_reasoning_effort=${JSON.stringify(input.request.effort)}`,
          '-c',`mcp_servers.guest.command=${JSON.stringify(mcpRuntime)}`,'-c',`mcp_servers.guest.args=${JSON.stringify([proxyScript, proxyContext])}`,
          '-c','mcp_servers.guest.env.ELECTRON_RUN_AS_NODE="1"','-c','mcp_servers.guest.required=true','-c','mcp_servers.guest.default_tools_approval_mode="approve"','-c','mcp_servers.guest.tool_input_schema_max_bytes=131072','-c','mcp_servers.guest.tool_timeout_sec=600',
          ...features.filter(feature => !['incremental_tools','skip_host_skill_discovery'].includes(feature)).flatMap(feature => ['--disable', feature]), '--enable','incremental_tools','--enable','skip_host_skill_discovery','--model', input.request.model];
        if (process.versions.electron) env.ELECTRON_RUN_AS_NODE = '1';
        const images = input.request.messages.flatMap(message => message.content.filter(part => part.type === 'image'));
        for (let i = 0; i < images.length; i++) {
          const image = images[i]; if (image.type !== 'image') continue;
          const path = join(directory, `input-${i}.${image.mime === 'image/png' ? 'png' : image.mime === 'image/webp' ? 'webp' : 'jpg'}`);
          await writeFile(path, Buffer.from(image.data, 'base64'), { mode: 0o600 }); args.push('--image', path);
        }
        args.push('-');
      } else {
        Object.assign(env, profile);
        const configFile = join(directory, 'mcp.json');
        // Secret values are private worker configuration, never argv, a workspace or a persisted payload.
        await writeFile(configFile, JSON.stringify({ mcpServers: { guest: { command: mcpRuntime, args: [proxyScript, proxyContext], env: mcpEnv } } }), { mode: 0o600 });
        const policyFile = join(directory, 'instructions.txt'); await writeFile(policyFile, input.request.system, { mode: 0o600 });
        args = ['-p','--debug-file',process.platform === 'win32' ? 'NUL' : '/dev/null','--restricted','--tools','','--strict-mcp-config','--mcp-config',configFile,'--setting-sources','',
          '--disable-slash-commands','--settings',JSON.stringify({ disableAllHooks: true, enabledPlugins: {}, autoMemoryEnabled: false, claudeMdExcludes: ['/**','**'] }),'--no-session-persistence','--permission-mode','dontAsk','--allowedTools','mcp__guest__*', '--model',input.request.model,'--effort',input.request.effort,
          '--system-prompt-file',policyFile,'--input-format','stream-json','--output-format','stream-json','--verbose','--include-partial-messages'];
      }
      child = this.options.process ? this.options.process(provider, args, directory, env, input.signal) : new JsonLineProcess(provider, args, directory, env, input.signal);
      let received = 0, complete = false; const itemText = new Map<string, string>(); let providerFailure = false;
      let outputLane = Promise.resolve();
      const emit = (text: string) => {
        received += Buffer.byteLength(text); if (received > MAX_OUTPUT) { providerFailure = true; void child?.stop(); return; }
        // Serial writes enforce backpressure all the way to the guest.
        outputLane = outputLane.then(() => input.emit('text', text)); void outputLane.catch(() => child?.stop());
      };
      child.onMessage = async message => {
        if (provider === 'codex') {
          if (['command_execution','file_change','web_search'].includes(message.item?.type)) { providerFailure = true; await child?.stop(); return; }
          if (message.item?.type === 'mcp_tool_call' && message.item.server !== 'guest') { providerFailure = true; await child?.stop(); return; }
          if (['item.started','item.updated','item.completed'].includes(message.type) && message.item?.type === 'agent_message') {
            const text = String(message.item.text ?? ''), previous = itemText.get(message.item.id) ?? '';
            if (text.startsWith(previous)) emit(text.slice(previous.length));
            itemText.set(message.item.id, text);
          }
          if (message.type === 'turn.completed') complete = true;
          if (['error','turn.failed'].includes(message.type)) providerFailure = true;
        } else {
          if (message.type === 'stream_event' && message.event?.type === 'content_block_delta' && message.event.delta?.type === 'text_delta') emit(message.event.delta.text);
          if (message.type === 'result') { complete = !message.is_error; providerFailure = Boolean(message.is_error); }
        }
      };
      if (provider === 'codex') {
        const text = input.request.messages.map(message => `${message.role.toUpperCase()}:\n${message.content.filter(part => part.type === 'text').map(part => part.text).join('\n')}`).join('\n\n');
        child.child.stdin.end(text);
      } else {
        // One native Claude turn; prior guest history is explicit and stays out of owner session storage.
        const messages = input.request.messages;
        const context = messages.slice(0, -1).map(message => `${message.role.toUpperCase()}:\n${message.content.filter(part => part.type === 'text').map(part => part.text).join('\n')}`).join('\n\n');
        const current = messages.at(-1)!;
        const content: unknown[] = [...(context ? [{ type: 'text', text: `<prior-conversation>\n${context}\n</prior-conversation>` }] : []), ...current.content.map(part => part.type === 'text' ? part : { type: 'image', source: { type: 'base64', media_type: part.mime, data: part.data } })];
        child.child.stdin.end(JSON.stringify({ type: 'user', message: { role: 'user', content } }) + '\n');
      }
      await child.closed; await outputLane;
      input.signal.throwIfAborted();
      if (!complete || providerFailure) throw new Error('INFERENCE_PROVIDER_FAILED');
    } catch (error) {
      if (input.signal.aborted) throw new Error('INFERENCE_CANCELLED');
      const code = error instanceof Error && /^INFERENCE_[A-Z_]+$/.test(error.message) ? error.message : 'INFERENCE_PROVIDER_FAILED';
      throw new Error(code);
    } finally { await child?.stop(); proxy?.close(); await rm(directory, { recursive: true, force: true }); }
  }
}
