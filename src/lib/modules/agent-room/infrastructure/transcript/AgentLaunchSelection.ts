import { homedir } from 'node:os';
import { join } from 'node:path';
import { findTranscriptFile, transcriptCwd, transcriptTail } from './TranscriptFiles.js';

export type AgentLaunchSelection = { model?: string; effort?: string | null };
const EFFORTS = new Set(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
const validModel = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/.test(value);

/** Only provider-owned settings records, never assistant/user/tool prose. */
export function parseCodexLaunchSelection(jsonl: string): AgentLaunchSelection | null {
  for (const line of jsonl.split('\n').reverse()) {
    try {
      const event = JSON.parse(line);
      const explicit = event.type === 'event_msg' && event.payload?.type === 'thread_settings_applied';
      if (!explicit && event.type !== 'turn_context') continue;
      const settings = explicit ? event.payload.thread_settings : event.payload;
      if (!settings || typeof settings !== 'object') continue;
      const selection: AgentLaunchSelection = {};
      if (validModel(settings.model)) selection.model = settings.model;
      const effort = explicit ? settings.reasoning_effort : settings.effort;
      if (effort === null || (typeof effort === 'string' && EFFORTS.has(effort))) selection.effort = effort;
      if (!Object.keys(selection).length) continue;
      // The newest provider record wins, including /model confirmed without
      // another turn. An older settings event must not undo a later resume.
      return selection;
    } catch { /* partial/unknown records are not launch settings */ }
  }
  return null;
}

export function applyCodexLaunchSelection(args: string[], selection: AgentLaunchSelection): string[] {
  const result: string[] = [];
  const replacedConfig = (value: string) => (selection.effort !== undefined && /^model_reasoning_effort\s*=/.test(value))
    || (selection.model !== undefined && /^model\s*=/.test(value));
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (selection.model !== undefined && ['--model', '-m'].includes(arg)) { index += 1; continue; }
    if (selection.model !== undefined && /^(--model|-m)=/.test(arg)) continue;
    if (['-c', '--config'].includes(arg) && args[index + 1] && replacedConfig(args[index + 1])) { index += 1; continue; }
    if (arg.startsWith('--config=') && replacedConfig(arg.slice(9))) continue;
    if (arg.startsWith('-c') && arg.length > 2 && replacedConfig(arg.slice(2))) continue;
    result.push(arg);
  }
  if (selection.model !== undefined) result.push('--model', selection.model);
  if (selection.effort !== undefined && selection.effort !== null) result.push('-c', `model_reasoning_effort=${JSON.stringify(selection.effort)}`);
  return result;
}

/** Read the exact saved conversation, asynchronously and with a bounded tail. */
export async function restoreAgentLaunchSelection(payload: Record<string, unknown>, cwd: string,
  options: { homeDir?: string; posixCwd?: boolean; codexHome?: string } = {}): Promise<Record<string, unknown>> {
  if (payload.provider !== 'codex' || typeof payload.agentSessionId !== 'string'
    || !/^[a-f0-9-]{36}$/i.test(payload.agentSessionId)) return payload;
  try {
    const path = await findTranscriptFile(join(options.codexHome ?? join(options.homeDir ?? homedir(), '.codex'), 'sessions'), payload.agentSessionId, 4);
    if (!path) return payload;
    const head = await transcriptTail(path, 64 * 1024, true);
    const meta = head?.split('\n').flatMap(line => {
      try { const event = JSON.parse(line); return event.type === 'session_meta' ? [event.payload] : []; }
      catch { return []; }
    }).find(item => item?.id === payload.agentSessionId);
    if (!meta || typeof meta.cwd !== 'string' || await transcriptCwd(meta.cwd, options.posixCwd) !== await transcriptCwd(cwd, options.posixCwd)) return payload;
    const tail = await transcriptTail(path, 1024 * 1024);
    const selection = tail ? parseCodexLaunchSelection(tail) : null;
    if (!selection) return payload;
    const args = applyCodexLaunchSelection(Array.isArray(payload.args) ? payload.args.filter((arg): arg is string => typeof arg === 'string') : [], selection);
    return JSON.stringify(args) === JSON.stringify(payload.args) ? payload : { ...payload, args };
  } catch { return payload; }
}
