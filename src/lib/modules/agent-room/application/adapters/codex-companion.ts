import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cliInvocation } from '../../infrastructure/agent-path.js';
import { parseJsonLinesOutput } from './json-lines.js';

export function companionModel(model: Record<string, unknown>) {
  return { ...model, shell_type: 'disabled', apply_patch_tool_type: null, experimental_supported_tools: [],
    supports_search_tool: false, node_repl_disabled: true, tool_mode: 'direct', multi_agent_version: null,
    include_skills_usage_instructions: false, include_plugin_usage_instructions: false, include_apps_usage_instructions: false,
    model_messages: null, base_instructions: 'You are a conversational assistant. Follow the owner policy. Return only the requested JSON. You have no tools or filesystem access.' };
}

export function companionReply(raw: string): string {
  let result: unknown;
  // JSON parser errors include input excerpts. Never propagate provider output
  // into routine failures or audit logs, including malformed secret material.
  try { result = JSON.parse(raw); } catch { throw new Error('Invalid restricted companion response.'); }
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('Invalid restricted companion response.');
  const value = result as Record<string, unknown>;
  if (typeof value.text !== 'string' || !value.text.trim() || value.text.length > 4000 || Object.keys(value).some(key => key !== 'text')) throw new Error('Invalid restricted companion response.');
  return value.text;
}

function invoke(args: string[], cwd: string, signal?: AbortSignal, input?: string, profileEnv?: Record<string, string>): Promise<string> {
  return new Promise((resolve, reject) => {
    const invocation = cliInvocation('codex', args);
    const allowed = new Set(['PATH','HOME','USER','LOGNAME','SYSTEMROOT','COMSPEC','USERPROFILE','APPDATA','LOCALAPPDATA','TMPDIR','TEMP','TMP','LANG','LC_ALL','CODEX_HOME','PATHEXT']);
    const env = Object.fromEntries(Object.entries(invocation.env ?? process.env).filter(([key]) => allowed.has(key.toUpperCase())));
    if (profileEnv?.CODEX_HOME) env.CODEX_HOME = profileEnv.CODEX_HOME;
    const child = execFile(invocation.command, invocation.args, { cwd, env, signal, timeout: input ? 90_000 : 10_000, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8', windowsHide: true }, (error, stdout) => {
      // Provider errors can contain prompts, paths or account details.
      if (error) reject(new Error('Restricted companion inference failed. Check Codex login/version locally; no external message was submitted.'));
      else resolve(stdout);
    });
    child.stdin?.end(input ?? '');
  });
}

/** Fail closed for versions not covered by our native-tool exclusion tests. */
export async function codexCompanion(input: { instructions: string; content: string; model?: string | null; launchArgs?: string[]; signal?: AbortSignal; profileEnv?: Record<string, string> }): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'orkestrai-companion-'));
  try {
    const version = await invoke(['--version'], directory, input.signal);
    if (!/^codex-cli 0\.154\.\d+\s*$/.test(version)) throw new Error('Restricted companion requires a verified Codex CLI 0.154.x. It will not fall back to an unrestricted terminal.');
    const raw = JSON.parse(await invoke(['debug', 'models'], directory, input.signal, undefined, input.profileEnv));
    const modelFlag = input.launchArgs?.findIndex(arg => arg === '--model' || arg === '-m') ?? -1;
    const selectedModel = input.model ?? (modelFlag >= 0 ? input.launchArgs?.[modelFlag + 1] : input.launchArgs?.find(arg => arg.startsWith('--model='))?.slice(8));
    const model = raw.models?.find((candidate: Record<string, unknown>) => candidate.slug === selectedModel);
    if (!model) throw new Error('Select an available Codex model for the restricted companion.');
    const featureList = await invoke(['features', 'list'], directory, input.signal);
    const features = featureList.split('\n').map(line => line.match(/^([a-z][a-z0-9_]*)\s+.+\s+(?:true|false)$/)?.[1]).filter(Boolean);
    if (!features.includes('shell_tool') || !features.includes('plugins') || !features.includes('code_mode_host')) throw new Error('Codex tool exclusion cannot be verified.');
    const catalog = join(directory, 'models.json'), policy = join(directory, 'policy.txt'), schema = join(directory, 'response.json');
    await writeFile(catalog, JSON.stringify({ models: [companionModel(model)] }), { mode: 0o600 });
    await writeFile(policy, input.instructions, { mode: 0o600 });
    await writeFile(schema, JSON.stringify({ type: 'object', additionalProperties: false, properties: { text: { type: 'string' } }, required: ['text'] }), { mode: 0o600 });
    const args = ['exec', '--json', '--ephemeral', '--skip-git-repo-check', '--ignore-user-config', '--ignore-rules', '--strict-config', '--sandbox', 'read-only',
      '-c', 'approval_policy="never"', '-c', 'mcp_servers={}', '-c', 'plugins={}', '-c', 'web_search="disabled"',
      '-c', 'project_doc_max_bytes=0', '-c', 'include_environment_context=false', '-c', 'skills.include_instructions=false',
      '-c', 'shell_environment_policy.inherit="none"', '-c', `model_catalog_json=${JSON.stringify(catalog)}`,
      '-c', `model_instructions_file=${JSON.stringify(policy)}`, '-c', 'model_reasoning_effort="low"',
      ...features.flatMap(feature => ['--disable', feature!]), '--enable', 'skip_host_skill_discovery',
      '--model', String(model.slug), '--output-schema', schema, '-'];
    const rawOutput = await invoke(args, directory, input.signal, input.content, input.profileEnv);
    const output = parseJsonLinesOutput(rawOutput);
    const events = rawOutput.split('\n').filter(Boolean).map(line => { try { return JSON.parse(line); } catch { return null; } });
    if (events.some(event => ['command_execution', 'mcp_tool_call', 'file_change', 'web_search'].includes(event?.item?.type))) throw new Error('Unexpected tool activity in restricted companion. Publication blocked.');
    return companionReply(output.content);
  } finally { await rm(directory, { recursive: true, force: true }); }
}
