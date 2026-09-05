import { closeSync, existsSync, openSync, readFileSync, readSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { basename, dirname, join, posix, resolve } from 'node:path';
import { getAgentAdapter, hasAgentAdapter } from '../../application/adapters/registry.js';
import { agentSessionTracker } from '../pty/AgentSessionTracker.js';

/**
 * Le a ULTIMA resposta do agente direto do transcrito da CLI (JSONL em disco)
 * — fonte limpa, sem ANSI/TUI, com a resposta COMPLETA. Substitui a raspagem
 * da tela do terminal (que quebrava em redraws, molduras e caracteres de
 * controle) para a fala de resposta no ciclo de ditado.
 *
 * Formatos:
 * - claude: ~/.claude/projects/<slug>/<sessionId>.jsonl
 *   {type:'assistant', message:{content:[{type:'text',text}|{type:'tool_use'}]}}
 *   {type:'user', message:{content: string | [{type:'tool_result'}]}}
 * - codex: ~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<uuid>.jsonl
 *   {type:'response_item', payload:{type:'message', role, content:[{type:'output_text',text}]}}
 * - kimi: ~/.kimi-code/sessions/<wd_*>/session_<uuid>/*.jsonl (melhor esforco,
 *   mesmo contrato role/content; fallback null -> raspagem de tela)
 */

/** Lida a cauda do arquivo (transcritos longos nao cabem inteiros na memoria). */
const TAIL_BYTES = 512 * 1024;
const MATCH_TAIL_BYTES = 4 * 1024 * 1024;

export type MatchedTranscriptReply = {
  sessionId: string;
  text: string;
  complete: boolean;
};

export type MatchedTranscriptPrompt = {
  sessionId: string;
};

export type TranscriptLookupOptions = {
  /** Host-visible provider home, such as \\wsl.localhost\Ubuntu\home\user. */
  homeDir?: string;
  /** WSL transcripts store Linux cwd values even when read through a UNC path. */
  posixCwd?: boolean;
};

type ParsedTranscriptTurn = {
  prompt: string | null;
  reply: string | null;
  complete: boolean;
};

type ReadonlySqliteDatabase = {
  prepare(sql: string): { all(...params: unknown[]): unknown[] };
  close(): void;
};

const require = createRequire(import.meta.url);

function openReadonlySqlite(path: string): ReadonlySqliteDatabase {
  try {
    const BetterSqlite = require('better-sqlite3') as new (
      filename: string,
      options: { readonly: boolean; fileMustExist: boolean }
    ) => ReadonlySqliteDatabase;
    return new BetterSqlite(path, { readonly: true, fileMustExist: true });
  } catch {
    const { DatabaseSync } = require('node:sqlite') as {
      DatabaseSync: new (filename: string, options: { readOnly: boolean }) => ReadonlySqliteDatabase;
    };
    return new DatabaseSync(path, { readOnly: true });
  }
}

function readTail(path: string, maxBytes = TAIL_BYTES): string | null {
  let fd: number | null = null;
  try {
    const size = statSync(path).size;
    const start = Math.max(0, size - maxBytes);
    const buffer = Buffer.allocUnsafe(size - start);
    fd = openSync(path, 'r');
    const bytesRead = readSync(fd, buffer, 0, buffer.length, start);
    const tail = buffer.toString('utf8', 0, bytesRead);
    // Se cortou no meio, joga fora a primeira linha parcial.
    return start > 0 ? tail.slice(tail.indexOf('\n') + 1) : tail;
  } catch {
    return null;
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

/** Claude: textos do(s) bloco(s) assistant depois da ultima msg de usuario real. */
export function parseClaudeTranscriptReply(jsonl: string): string | null {
  const parts: string[] = [];
  for (const line of jsonl.trim().split('\n').reverse()) {
    let event: any;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (event.type === 'assistant') {
      const content = event.message?.content;
      if (!Array.isArray(content)) continue;
      const texts = content
        .filter((block: any) => block?.type === 'text' && typeof block.text === 'string')
        .map((block: any) => block.text.trim())
        .filter(Boolean);
      // Assistant com texto vira parte da resposta; so-tool_use segue subindo.
      if (texts.length) parts.unshift(texts.join('\n'));
      continue;
    }
    if (isClaudeUserPrompt(event)) break; // fronteira: a pergunta ditada — para aqui
  }
  const text = parts.join('\n\n').trim();
  return text || null;
}

/** Codex: response_item/message assistant (output_text) depois do ultimo user. */
export function parseCodexTranscriptReply(jsonl: string): string | null {
  const parts: string[] = [];
  for (const line of jsonl.trim().split('\n').reverse()) {
    let event: any;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    const payload = event.payload ?? event;
    if (payload?.type !== 'message' || !Array.isArray(payload.content)) continue;
    // output_text = assistant; input_text/text = fronteira do usuario.
    const texts = payload.content
      .filter((block: any) => ['output_text', 'text', 'input_text'].includes(block?.type) && typeof block.text === 'string')
      .map((block: any) => block.text.trim())
      .filter(Boolean);
    if (!texts.length) continue;
    if (payload.role === 'assistant') {
      parts.unshift(texts.join('\n'));
      continue;
    }
    if (payload.role === 'user') break;
  }
  const text = parts.join('\n\n').trim();
  return text || null;
}

/** Kimi/opencode: tentativa generica role/content (melhor esforco). */
export function parseGenericTranscriptReply(jsonl: string): string | null {
  const events: unknown[] = [];
  for (const line of jsonl.trim().split('\n')) {
    try {
      events.push(JSON.parse(line));
    } catch {
      // Ignora linhas parciais enquanto o agente grava o transcrito.
    }
  }
  return parseStructuredMessagesReply(events);
}

/** Cursor, Cline e Antigravity: formatos variam, mas preservam role + content. */
export function parseStructuredMessagesReply(messages: unknown[]): string | null {
  const parts: string[] = [];
  for (const raw of [...messages].reverse()) {
    if (!raw || typeof raw !== 'object') continue;
    const event = raw as Record<string, any>;
    const message = event.message && typeof event.message === 'object' ? event.message : event.payload ?? event;
    const role = String(message.role ?? message.author?.role ?? message.speaker ?? message.type ?? event.role ?? event.type ?? '').toLowerCase();
    const text = transcriptText(message.content ?? message.parts ?? message.text ?? message.output ?? message.response);
    if (!text) continue;
    if (['assistant', 'agent', 'model'].includes(role)) {
      parts.unshift(text);
      continue;
    }
    if (['user', 'human'].includes(role)) break;
  }
  const text = parts.join('\n\n').trim();
  return text || null;
}

/** Devin (ATIF JSON): passos agent depois do ultimo passo user. */
export function parseDevinTranscriptReply(json: string): string | null {
  let payload: { steps?: unknown };
  try {
    payload = JSON.parse(json) as { steps?: unknown };
  } catch {
    return null;
  }
  if (!Array.isArray(payload.steps)) return null;

  const parts: string[] = [];
  for (const raw of [...payload.steps].reverse()) {
    if (!raw || typeof raw !== 'object') continue;
    const step = raw as Record<string, unknown>;
    const source = String(step.source ?? '').toLowerCase();
    if (source === 'user') break;
    if (source !== 'agent') continue;
    const text = transcriptText(step.message) ?? transcriptText(step.reasoning_content);
    if (text) parts.unshift(text);
  }
  return parts.join('\n\n').trim() || null;
}

function transcriptText(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null;
  if (Array.isArray(value)) {
    const parts = value.map(transcriptText).filter((part): part is string => Boolean(part));
    return parts.length ? parts.join('\n') : null;
  }
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (record.type && !['text', 'output_text', 'message'].includes(String(record.type)) && !('text' in record)) return null;
  return transcriptText(record.text ?? record.content ?? record.value);
}

function normalizedPrompt(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function isClaudeUserPrompt(event: any): boolean {
  if (event?.type !== 'user' || event.isMeta === true) return false;
  const content = event.message?.content;
  return typeof content === 'string'
    ? content.trim().length > 0
    : Array.isArray(content) && content.some((block: any) => block?.type === 'text' && String(block.text ?? '').trim().length > 0);
}

function claudeTurnComplete(jsonl: string): boolean {
  let sawLifecycle = false;
  let complete = false;
  for (const line of jsonl.trim().split('\n').reverse()) {
    let event: any;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (isClaudeUserPrompt(event)) break;
    if (event.type !== 'assistant' || typeof event.message?.stop_reason !== 'string') continue;
    sawLifecycle = true;
    if (event.message.stop_reason === 'end_turn') complete = true;
  }
  // Older Claude transcripts did not persist stop_reason. Preserve their
  // previous behavior while current transcripts wait for the real end_turn.
  return !sawLifecycle || complete;
}

function claudePrompt(jsonl: string): string | null {
  for (const line of jsonl.trim().split('\n').reverse()) {
    let event: any;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isClaudeUserPrompt(event)) continue;
    const content = event.message?.content;
    if (typeof content === 'string' && content.trim()) return content.trim();
    if (!Array.isArray(content)) continue;
    const text = content
      .filter((block: any) => block?.type === 'text' && typeof block.text === 'string')
      .map((block: any) => block.text.trim())
      .filter(Boolean)
      .join('\n');
    if (text) return text;
  }
  return null;
}

function codexPrompt(jsonl: string): string | null {
  for (const line of jsonl.trim().split('\n').reverse()) {
    let event: any;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    const payload = event.payload ?? event;
    if (payload?.type !== 'message' || payload.role !== 'user' || !Array.isArray(payload.content)) continue;
    const text = payload.content
      .filter((block: any) => ['input_text', 'text'].includes(block?.type) && typeof block.text === 'string')
      .map((block: any) => block.text.trim())
      .filter(Boolean)
      .join('\n');
    if (text) return text;
  }
  return null;
}

function kimiPrompt(jsonl: string): string | null {
  for (const line of jsonl.trim().split('\n').reverse()) {
    let event: any;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (event.type !== 'turn.prompt' || !Array.isArray(event.input)) continue;
    const text = event.input
      .filter((part: any) => part?.type === 'text' && typeof part.text === 'string')
      .map((part: any) => part.text.trim())
      .filter(Boolean)
      .join('\n');
    if (text) return text;
  }
  return null;
}

function genericPrompt(jsonl: string): string | null {
  for (const line of jsonl.trim().split('\n').reverse()) {
    let raw: any;
    try {
      raw = JSON.parse(line);
    } catch {
      continue;
    }
    const message = raw?.message && typeof raw.message === 'object' ? raw.message : raw?.payload ?? raw;
    const role = String(message?.role ?? message?.author?.role ?? message?.speaker ?? raw?.role ?? '').toLowerCase();
    if (!['user', 'human'].includes(role)) continue;
    const text = transcriptText(message.content ?? message.parts ?? message.text);
    if (text) return text;
  }
  return null;
}

function structuredPrompt(messages: unknown[]): string | null {
  for (const raw of [...messages].reverse()) {
    if (!raw || typeof raw !== 'object') continue;
    const event = raw as Record<string, any>;
    const message = event.message && typeof event.message === 'object' ? event.message : event.payload ?? event;
    const role = String(message.role ?? message.author?.role ?? message.speaker ?? event.role ?? '').toLowerCase();
    if (!['user', 'human'].includes(role)) continue;
    const text = transcriptText(message.content ?? message.parts ?? message.text);
    if (text) return text;
  }
  return null;
}

function clineTurn(json: string): { prompt: string | null; reply: string | null } {
  try {
    const payload = JSON.parse(json) as unknown;
    const messages = Array.isArray(payload)
      ? payload
      : payload && typeof payload === 'object' && Array.isArray((payload as { messages?: unknown }).messages)
        ? (payload as { messages: unknown[] }).messages
        : [];
    return { prompt: structuredPrompt(messages), reply: parseStructuredMessagesReply(messages) };
  } catch {
    return { prompt: null, reply: null };
  }
}

function devinTurn(json: string): { prompt: string | null; reply: string | null } {
  try {
    const payload = JSON.parse(json) as { steps?: unknown };
    const steps = Array.isArray(payload.steps) ? payload.steps : [];
    const prompt = [...steps].reverse().find((raw) => (
      raw && typeof raw === 'object' && String((raw as { source?: unknown }).source).toLowerCase() === 'user'
    ));
    return {
      prompt: prompt && typeof prompt === 'object' ? transcriptText((prompt as { message?: unknown }).message) : null,
      reply: parseDevinTranscriptReply(json),
    };
  } catch {
    return { prompt: null, reply: null };
  }
}

function codexCompletion(jsonl: string): { reply: string | null; complete: boolean } {
  let turnId: string | null = null;
  let finalReply: string | null = null;
  for (const line of jsonl.trim().split('\n')) {
    let event: any;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    const payload = event.payload ?? event;
    if (payload?.type === 'message' && payload.role === 'user') {
      const candidate = payload.internal_chat_message_metadata_passthrough?.turn_id;
      if (typeof candidate === 'string') turnId = candidate;
      continue;
    }
    if (
      payload?.type === 'task_complete'
      && (!turnId || payload.turn_id === turnId)
      && typeof payload.last_agent_message === 'string'
      && payload.last_agent_message.trim()
    ) {
      finalReply = payload.last_agent_message.trim();
    }
  }
  return {
    reply: finalReply ?? parseCodexTranscriptReply(jsonl),
    complete: Boolean(finalReply),
  };
}

function kimiTurnComplete(jsonl: string): boolean {
  for (const line of jsonl.trim().split('\n').reverse()) {
    try {
      const event = JSON.parse(line) as { type?: unknown };
      if (event.type === 'turn.prompt') return false;
      if (event.type === 'turn.ended') return true;
    } catch {
      // Ignore a partially written line.
    }
  }
  return false;
}

function promptFromJsonlEvent(storage: string, event: any): string | null {
  if (storage === 'claude-project-jsonl') {
    if (!isClaudeUserPrompt(event)) return null;
    const content = event.message?.content;
    if (typeof content === 'string') return content.trim() || null;
    return Array.isArray(content)
      ? content
          .filter((block: any) => block?.type === 'text' && typeof block.text === 'string')
          .map((block: any) => block.text.trim())
          .filter(Boolean)
          .join('\n') || null
      : null;
  }
  if (storage === 'codex-rollout-jsonl') {
    const payload = event?.payload ?? event;
    if (payload?.type !== 'message' || payload.role !== 'user' || !Array.isArray(payload.content)) return null;
    return payload.content
      .filter((block: any) => ['input_text', 'text'].includes(block?.type) && typeof block.text === 'string')
      .map((block: any) => block.text.trim())
      .filter(Boolean)
      .join('\n') || null;
  }
  if (storage === 'kimi-session-dir') {
    if (event?.type !== 'turn.prompt' || !Array.isArray(event.input)) return null;
    return event.input
      .filter((part: any) => part?.type === 'text' && typeof part.text === 'string')
      .map((part: any) => part.text.trim())
      .filter(Boolean)
      .join('\n') || null;
  }
  const message = event?.message && typeof event.message === 'object' ? event.message : event?.payload ?? event;
  const role = String(message?.role ?? message?.author?.role ?? message?.speaker ?? event?.role ?? '').toLowerCase();
  return ['user', 'human'].includes(role)
    ? transcriptText(message.content ?? message.parts ?? message.text)
    : null;
}

function jsonlTurnForPrompt(storage: string, transcript: string, expectedPrompt: string): string | null {
  const lines = transcript.trim().split('\n');
  const expected = normalizedPrompt(expectedPrompt);
  let match = -1;
  for (let index = 0; index < lines.length; index += 1) {
    let event: any;
    try {
      event = JSON.parse(lines[index]);
    } catch {
      continue;
    }
    const prompt = promptFromJsonlEvent(storage, event);
    if (!prompt) continue;
    if (match >= 0) return lines.slice(match, index).join('\n');
    if (normalizedPrompt(prompt) === expected) match = index;
  }
  return match >= 0 ? lines.slice(match).join('\n') : null;
}

function structuredTurnForPrompt(messages: unknown[], expectedPrompt: string): unknown[] | null {
  const expected = normalizedPrompt(expectedPrompt);
  let match = -1;
  for (let index = 0; index < messages.length; index += 1) {
    const prompt = structuredPrompt([messages[index]]);
    if (!prompt) continue;
    if (match >= 0) return messages.slice(match, index);
    if (normalizedPrompt(prompt) === expected) match = index;
  }
  return match >= 0 ? messages.slice(match) : null;
}

function structuredReplyForPrompt(messages: unknown[], expectedPrompt: string): string | null {
  const turn = structuredTurnForPrompt(messages, expectedPrompt);
  return turn ? parseStructuredMessagesReply(turn) : null;
}

function transcriptTurnForPrompt(storage: string, transcript: string, expectedPrompt: string): string | null {
  if (storage === 'cline-session-manifest') {
    try {
      const payload = JSON.parse(transcript) as unknown;
      const messages = Array.isArray(payload)
        ? payload
        : payload && typeof payload === 'object' && Array.isArray((payload as { messages?: unknown }).messages)
          ? (payload as { messages: unknown[] }).messages
          : [];
      const turn = structuredTurnForPrompt(messages, expectedPrompt);
      return turn ? JSON.stringify(turn) : null;
    } catch {
      return null;
    }
  }
  if (storage === 'devin-session-db') {
    try {
      const payload = JSON.parse(transcript) as { steps?: unknown };
      const steps = Array.isArray(payload.steps) ? payload.steps : [];
      const expected = normalizedPrompt(expectedPrompt);
      let match = -1;
      for (let index = 0; index < steps.length; index += 1) {
        const step = steps[index] as { source?: unknown; message?: unknown };
        if (String(step?.source ?? '').toLowerCase() !== 'user') continue;
        const prompt = transcriptText(step.message);
        if (!prompt) continue;
        if (match >= 0) return JSON.stringify({ steps: steps.slice(match, index) });
        if (normalizedPrompt(prompt) === expected) match = index;
      }
      return match >= 0 ? JSON.stringify({ steps: steps.slice(match) }) : null;
    } catch {
      return null;
    }
  }
  return jsonlTurnForPrompt(storage, transcript, expectedPrompt);
}

export function transcriptContainsPrompt(storage: string, transcript: string, expectedPrompt: string): boolean {
  const parser = parserForStorage(storage);
  const prompt = parser?.(transcript).prompt;
  return Boolean(prompt && normalizedPrompt(prompt) === normalizedPrompt(expectedPrompt));
}

function parserForStorage(storage: string | undefined): ((jsonl: string) => ParsedTranscriptTurn) | null {
  if (storage === 'claude-project-jsonl') return (jsonl) => ({ prompt: claudePrompt(jsonl), reply: parseClaudeTranscriptReply(jsonl), complete: claudeTurnComplete(jsonl) });
  if (storage === 'codex-rollout-jsonl') return (jsonl) => ({ prompt: codexPrompt(jsonl), ...codexCompletion(jsonl) });
  if (storage === 'kimi-session-dir') return (jsonl) => ({ prompt: kimiPrompt(jsonl), reply: parseKimiTranscriptReply(jsonl), complete: kimiTurnComplete(jsonl) });
  if (['opencode-session-json', 'cursor-transcript-jsonl', 'antigravity-workspace-cache'].includes(storage ?? '')) {
    return (jsonl) => ({ prompt: genericPrompt(jsonl), reply: parseGenericTranscriptReply(jsonl), complete: true });
  }
  if (storage === 'cline-session-manifest') return (jsonl) => ({ ...clineTurn(jsonl), complete: true });
  if (storage === 'devin-session-db') return (jsonl) => ({ ...devinTurn(jsonl), complete: true });
  return null;
}

export function parseCodexTranscriptReplyForPrompt(jsonl: string, expectedPrompt: string): string | null {
  return parseTranscriptReplyForPrompt('codex-rollout-jsonl', jsonl, expectedPrompt);
}

export function parseTranscriptReplyForPrompt(storage: string, transcript: string, expectedPrompt: string): string | null {
  return parseTranscriptReplyStateForPrompt(storage, transcript, expectedPrompt)?.text ?? null;
}

export function parseTranscriptReplyStateForPrompt(
  storage: string,
  transcript: string,
  expectedPrompt: string,
): { text: string; complete: boolean } | null {
  const parser = parserForStorage(storage);
  if (!parser) return null;
  const scopedTranscript = transcriptTurnForPrompt(storage, transcript, expectedPrompt);
  if (!scopedTranscript) return null;
  const turn = parser(scopedTranscript);
  if (!turn.prompt || normalizedPrompt(turn.prompt) !== normalizedPrompt(expectedPrompt)) return null;
  const text = turn.reply?.trim();
  return text ? { text, complete: turn.complete } : null;
}

/**
 * Kimi (wire.jsonl): textos do assistente depois do ultimo turn.prompt.
 *   user:      {"type":"turn.prompt","input":[{"type":"text","text":...}]}
 *   assistant: {"type":"context.append_loop_event","event":{"type":"content.part","part":{"type":"text","text":...}}}
 */
export function parseKimiTranscriptReply(jsonl: string): string | null {
  const parts: string[] = [];
  for (const line of jsonl.trim().split('\n').reverse()) {
    let event: any;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (event.type === 'turn.prompt') break; // fronteira: a pergunta
    if (event.type === 'context.append_loop_event' && event.event?.type === 'content.part') {
      const part = event.event.part;
      if (part?.type === 'text' && typeof part.text === 'string' && part.text.trim()) {
        parts.unshift(part.text.trim());
      }
    }
  }
  const text = parts.join('\n\n').trim();
  return text || null;
}

function realCwd(cwd: string, posixCwd = false): string {
  if (posixCwd) return posix.normalize(cwd);
  try {
    return realpathSync(cwd);
  } catch {
    return resolve(cwd);
  }
}

function claudeTranscriptPath(cwd: string, sessionId: string, options: TranscriptLookupOptions = {}): string {
  const slug = realCwd(cwd, options.posixCwd).replace(/[^a-zA-Z0-9]/g, '-');
  return join(options.homeDir ?? homedir(), '.claude', 'projects', slug, `${sessionId}.jsonl`);
}

function findCodexTranscript(sessionId: string, options: TranscriptLookupOptions = {}): string | null {
  const root = join(options.homeDir ?? homedir(), '.codex', 'sessions');
  if (!existsSync(root)) return null;
  const walk = (dir: string, depth: number): string | null => {
    if (depth > 4) return null;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return null;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        const found = walk(full, depth + 1);
        if (found) return found;
      } else if (entry.name.startsWith('rollout-') && entry.name.endsWith('.jsonl') && entry.name.includes(sessionId)) {
        return full;
      }
    }
    return null;
  };
  return walk(root, 0);
}

function findKimiTranscript(sessionId: string, options: TranscriptLookupOptions = {}): string | null {
  const root = join(options.homeDir ?? homedir(), '.kimi-code', 'sessions');
  if (!existsSync(root)) return null;
  // sessionId vem como "session_<uuid>" (ver AgentSessionTracker).
  const walk = (dir: string, depth: number): string | null => {
    if (depth > 4) return null;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return null;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === sessionId) {
          // Formato real (0.33+): <sessao>/agents/main/wire.jsonl.
          const wire = join(full, 'agents', 'main', 'wire.jsonl');
          if (existsSync(wire)) return wire;
          // Fallback: o jsonl mais recente direto na sessao.
          try {
            const files = readdirSync(full)
              .filter((name) => name.endsWith('.jsonl'))
              .map((name) => ({ name, mtime: statSync(join(full, name)).mtimeMs }))
              .sort((a, b) => b.mtime - a.mtime);
            if (files[0]) return join(full, files[0].name);
          } catch {
            return null;
          }
        }
        const found = walk(full, depth + 1);
        if (found) return found;
      }
    }
    return null;
  };
  return walk(root, 0);
}

function cursorTranscriptPath(cwd: string, sessionId: string, options: TranscriptLookupOptions = {}): string | null {
  const slug = realCwd(cwd, options.posixCwd).replace(/^[\\/]+/, '').replace(/[^a-zA-Z0-9]/g, '-');
  for (const projectSlug of [slug, `-${slug}`]) {
    const path = join(options.homeDir ?? homedir(), '.cursor', 'projects', projectSlug, 'agent-transcripts', sessionId, `${sessionId}.jsonl`);
    if (existsSync(path)) return path;
  }
  return null;
}

function antigravityTranscriptPath(sessionId: string, options: TranscriptLookupOptions = {}): string | null {
  const path = join(options.homeDir ?? homedir(), '.gemini', 'antigravity-cli', 'brain', sessionId, '.system_generated', 'logs', 'transcript.jsonl');
  return existsSync(path) ? path : null;
}

function clineMessagesPath(sessionId: string, options: TranscriptLookupOptions = {}): string | null {
  const root = join(options.homeDir ?? homedir(), '.cline', 'data', 'sessions', sessionId);
  const manifestPath = join(root, `${sessionId}.json`);
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { messages_path?: unknown };
    const configured = typeof manifest.messages_path === 'string' ? manifest.messages_path : null;
    const path = configured || join(root, `${sessionId}.messages.json`);
    return existsSync(path) ? path : null;
  } catch {
    const fallback = join(root, `${sessionId}.messages.json`);
    return existsSync(fallback) ? fallback : null;
  }
}

function devinTranscriptPath(sessionId: string, options: TranscriptLookupOptions = {}): string | null {
  const home = options.homeDir ?? homedir();
  const candidates = [
    !options.homeDir && process.env.XDG_DATA_HOME ? join(process.env.XDG_DATA_HOME, 'devin', 'cli', 'transcripts', `${sessionId}.json`) : '',
    join(home, '.local', 'share', 'devin', 'cli', 'transcripts', `${sessionId}.json`),
    !options.homeDir && process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'devin', 'cli', 'transcripts', `${sessionId}.json`) : '',
    join(home, 'AppData', 'Local', 'devin', 'cli', 'transcripts', `${sessionId}.json`),
  ];
  return candidates.find((path) => Boolean(path) && existsSync(path)) ?? null;
}

type StoredTranscriptTurn = {
  prompt: string | null;
  reply: string | null;
  activity: number;
  messages: unknown[];
};

function openCodeDataRoots(options: TranscriptLookupOptions = {}): string[] {
  const home = options.homeDir ?? homedir();
  return [
    !options.homeDir && process.env.XDG_DATA_HOME ? join(process.env.XDG_DATA_HOME, 'opencode') : '',
    join(home, '.local', 'share', 'opencode'),
    !options.homeDir && process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'opencode') : '',
    !options.homeDir && process.env.APPDATA ? join(process.env.APPDATA, 'opencode') : '',
  ].filter((path, index, paths) => Boolean(path) && paths.indexOf(path) === index);
}

function storedJson(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object') return value as Record<string, unknown>;
  if (typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

/** OpenCode 1.x persists sessions, messages and parts in opencode.db. */
function openCodeSqliteTurn(sessionId: string, options: TranscriptLookupOptions = {}): StoredTranscriptTurn | null {
  for (const root of openCodeDataRoots(options)) {
    const path = join(root, 'opencode.db');
    if (!existsSync(path)) continue;
    let database: ReadonlySqliteDatabase | null = null;
    try {
      database = openReadonlySqlite(path);
      const rows = database.prepare(
        `WITH recent AS (
           SELECT id, time_created, time_updated, data
             FROM message
            WHERE session_id = ?
            ORDER BY time_created DESC, id DESC
            LIMIT 60
         )
         SELECT recent.id AS message_id,
                recent.time_created AS message_created,
                recent.time_updated AS message_updated,
                recent.data AS message_data,
                part.time_created AS part_created,
                part.time_updated AS part_updated,
                part.data AS part_data
           FROM recent
           LEFT JOIN part ON part.message_id = recent.id
          ORDER BY recent.time_created ASC, recent.id ASC, part.time_created ASC, part.id ASC`
      ).all(sessionId) as Array<Record<string, unknown>>;
      if (!rows.length) continue;

      const messages = new Map<string, { role: string; content: string[] }>();
      let activity = 0;
      for (const row of rows) {
        const id = typeof row.message_id === 'string' ? row.message_id : '';
        if (!id) continue;
        const message = storedJson(row.message_data);
        const role = typeof message.role === 'string' ? message.role : '';
        const entry = messages.get(id) ?? { role, content: [] };
        if (!entry.role) entry.role = role;
        const part = storedJson(row.part_data);
        if (part.type === 'text' && typeof part.text === 'string' && part.text.trim()) {
          entry.content.push(part.text.trim());
        }
        messages.set(id, entry);
        activity = Math.max(
          activity,
          Number(row.message_updated ?? 0),
          Number(row.message_created ?? 0),
          Number(row.part_updated ?? 0),
          Number(row.part_created ?? 0),
        );
      }
      const structured = [...messages.values()].map((message) => ({
        role: message.role,
        content: message.content.map((text) => ({ type: 'text', text })),
      }));
      return {
        prompt: structuredPrompt(structured),
        reply: parseStructuredMessagesReply(structured),
        activity,
        messages: structured,
      };
    } catch {
      // Banco em migracao, ocupado ou de uma versao com outro schema.
    } finally {
      database?.close();
    }
  }
  return null;
}

/** OpenCode anterior ao SQLite: storage/message + storage/part em JSON. */
function openCodeLegacyTurn(sessionId: string, options: TranscriptLookupOptions = {}): StoredTranscriptTurn | null {
  for (const root of openCodeDataRoots(options)) {
    const messagesDir = join(root, 'storage', 'message', sessionId);
    if (!existsSync(messagesDir)) continue;
    let messageFiles: Array<{ path: string; mtime: number }>;
    try {
      messageFiles = readdirSync(messagesDir)
        .filter((name) => name.endsWith('.json'))
        .map((name) => ({ path: join(messagesDir, name), mtime: statSync(join(messagesDir, name)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime)
        .slice(0, 60)
        .sort((a, b) => a.mtime - b.mtime);
    } catch {
      continue;
    }

    const structured: Array<{ role: string; content: Array<{ type: string; text: string }> }> = [];
    let activity = 0;
    for (const file of messageFiles) {
      const message = storedJson(readFileSync(file.path, 'utf8'));
      const id = typeof message.id === 'string' ? message.id : basename(file.path, '.json');
      const role = typeof message.role === 'string' ? message.role : '';
      const content: Array<{ type: string; text: string }> = [];
      const partsDir = join(root, 'storage', 'part', id);
      if (existsSync(partsDir)) {
        try {
          for (const name of readdirSync(partsDir).filter((entry) => entry.endsWith('.json')).sort()) {
            const path = join(partsDir, name);
            const part = storedJson(readFileSync(path, 'utf8'));
            if (part.type === 'text' && typeof part.text === 'string' && part.text.trim()) {
              content.push({ type: 'text', text: part.text.trim() });
            }
            activity = Math.max(activity, statSync(path).mtimeMs);
          }
        } catch {
          // Uma parte pode ser rotacionada enquanto a resposta e gravada.
        }
      }
      structured.push({ role, content });
      activity = Math.max(activity, file.mtime);
    }
    return {
      prompt: structuredPrompt(structured),
      reply: parseStructuredMessagesReply(structured),
      activity,
      messages: structured,
    };
  }
  return null;
}

function openCodeTurn(sessionId: string, options: TranscriptLookupOptions = {}): StoredTranscriptTurn | null {
  return openCodeSqliteTurn(sessionId, options) ?? openCodeLegacyTurn(sessionId, options);
}

function preferredTranscriptPath(storage: string | undefined, cwd: string, sessionId: string, options: TranscriptLookupOptions = {}): string | null {
  if (storage === 'claude-project-jsonl') {
    const path = claudeTranscriptPath(cwd, sessionId, options);
    return existsSync(path) ? path : null;
  }
  if (storage === 'codex-rollout-jsonl') return findCodexTranscript(sessionId, options);
  if (storage === 'kimi-session-dir') return findKimiTranscript(sessionId, options);
  if (storage === 'cursor-transcript-jsonl') return cursorTranscriptPath(cwd, sessionId, options);
  if (storage === 'antigravity-workspace-cache') return antigravityTranscriptPath(sessionId, options);
  if (storage === 'cline-session-manifest') return clineMessagesPath(sessionId, options);
  if (storage === 'devin-session-db') return devinTranscriptPath(sessionId, options);
  return null;
}

function recentFiles(
  root: string,
  since: number,
  maxDepth: number,
  match: (name: string, path: string) => boolean,
): string[] {
  if (!existsSync(root)) return [];
  const files: Array<{ path: string; mtime: number }> = [];
  const walk = (dir: string, depth: number) => {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(path, depth + 1);
        continue;
      }
      if (!match(entry.name, path)) continue;
      try {
        const mtime = statSync(path).mtimeMs;
        if (mtime >= since - 2_000) files.push({ path, mtime });
      } catch {
        // The provider may rotate a transcript while it is being inspected.
      }
    }
  };
  walk(root, 0);
  return files.sort((a, b) => b.mtime - a.mtime).map((entry) => entry.path);
}

function candidateTranscriptPaths(storage: string | undefined, cwd: string, since: number, options: TranscriptLookupOptions = {}): string[] {
  if (storage === 'claude-project-jsonl') {
    const dir = dirname(claudeTranscriptPath(cwd, 'placeholder', options));
    return recentFiles(dir, since, 0, (name) => name.endsWith('.jsonl'));
  }
  if (storage === 'codex-rollout-jsonl') {
    const targetCwd = realCwd(cwd, options.posixCwd);
    return recentFiles(join(options.homeDir ?? homedir(), '.codex', 'sessions'), since, 4, (name, path) => (
      name.startsWith('rollout-') && name.endsWith('.jsonl') && codexTranscriptCwd(path, options) === targetCwd
    ));
  }
  if (storage === 'kimi-session-dir') {
    const actualCwd = realCwd(cwd, options.posixCwd);
    const name = actualCwd.split(/[/\\]/).filter(Boolean).at(-1) ?? '';
    const hash = createHash('sha256').update(actualCwd).digest('hex').slice(0, 12);
    return recentFiles(join(options.homeDir ?? homedir(), '.kimi-code', 'sessions', `wd_${name}_${hash}`), since, 5, (entry) => entry.endsWith('.jsonl'));
  }
  return [];
}

function candidateSessionIds(storage: string | undefined, cwd: string, preferredSessionId: string | null): string[] {
  const ids: string[] = [];
  const exclude = new Set<string>(preferredSessionId ? [preferredSessionId] : []);
  for (let index = 0; index < 12; index += 1) {
    const id = agentSessionTracker.findLatestAgentSessionId(storage, cwd, exclude);
    if (!id) break;
    ids.push(id);
    exclude.add(id);
  }
  return ids;
}

function codexTranscriptCwd(path: string, options: TranscriptLookupOptions = {}): string | null {
  let fd: number | null = null;
  try {
    fd = openSync(path, 'r');
    const buffer = Buffer.allocUnsafe(64 * 1024);
    const bytesRead = readSync(fd, buffer, 0, buffer.length, 0);
    const firstLine = buffer.toString('utf8', 0, bytesRead).split('\n', 1)[0] ?? '';
    const entry = JSON.parse(firstLine) as { type?: unknown; payload?: { cwd?: unknown } };
    return entry.type === 'session_meta' && typeof entry.payload?.cwd === 'string'
      ? realCwd(entry.payload.cwd, options.posixCwd)
      : null;
  } catch {
    return null;
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

function sessionIdForPath(storage: string | undefined, path: string): string | null {
  if (storage === 'claude-project-jsonl') return basename(path, '.jsonl');
  if (storage === 'codex-rollout-jsonl') {
    return basename(path).match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/)?.[1] ?? null;
  }
  if (storage === 'kimi-session-dir') {
    return path.split(/[\\/]/).find((part) => part.startsWith('session_')) ?? null;
  }
  return basename(path, '.jsonl');
}

function replyAtPath(storage: string | undefined, path: string, expectedPrompt: string): { text: string; complete: boolean } | null {
  const transcript = ['cline-session-manifest', 'devin-session-db'].includes(storage ?? '')
    ? readFileSync(path, 'utf8')
    : readTail(path, MATCH_TAIL_BYTES);
  return transcript && storage ? parseTranscriptReplyStateForPrompt(storage, transcript, expectedPrompt) : null;
}

function promptAtPath(storage: string | undefined, path: string, expectedPrompt: string): boolean {
  const transcript = ['cline-session-manifest', 'devin-session-db'].includes(storage ?? '')
    ? readFileSync(path, 'utf8')
    : readTail(path, MATCH_TAIL_BYTES);
  return Boolean(transcript && storage && transcriptContainsPrompt(storage, transcript, expectedPrompt));
}

/**
 * Confirms that the provider persisted the exact injected prompt. Unlike a
 * terminal redraw, this is proof that Enter was accepted and a turn started.
 */
export async function findPromptInTranscript(
  provider: string,
  cwd: string,
  preferredSessionId: string | null,
  expectedPrompt: string,
  since: number,
  options: TranscriptLookupOptions = {},
): Promise<MatchedTranscriptPrompt | null> {
  try {
    const storage = hasAgentAdapter(provider) ? getAgentAdapter(provider).sessionStorage : undefined;
    if (storage === 'opencode-session-json') {
      const sessionIds = [preferredSessionId, ...candidateSessionIds(storage, cwd, preferredSessionId)]
        .filter((sessionId): sessionId is string => Boolean(sessionId));
      for (const sessionId of sessionIds) {
        const turn = openCodeTurn(sessionId, options);
        if (
          turn
          && turn.activity >= since - 2_000
          && structuredTurnForPrompt(turn.messages, expectedPrompt)
        ) return { sessionId };
      }
      return null;
    }

    const preferredPath = preferredSessionId
      ? preferredTranscriptPath(storage, cwd, preferredSessionId, options)
      : null;
    if (preferredPath && statSync(preferredPath).mtimeMs >= since - 2_000 && promptAtPath(storage, preferredPath, expectedPrompt)) {
      return { sessionId: preferredSessionId! };
    }
    for (const path of candidateTranscriptPaths(storage, cwd, since, options)) {
      if (path === preferredPath || !promptAtPath(storage, path, expectedPrompt)) continue;
      const sessionId = sessionIdForPath(storage, path);
      if (sessionId) return { sessionId };
    }
    for (const sessionId of candidateSessionIds(storage, cwd, preferredSessionId)) {
      const path = preferredTranscriptPath(storage, cwd, sessionId, options);
      if (!path || path === preferredPath || statSync(path).mtimeMs < since - 2_000) continue;
      if (promptAtPath(storage, path, expectedPrompt)) return { sessionId };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Resolves only the turn whose user prompt is the exact injected message.
 * Later turns cannot hide or contaminate that reply. Recent transcripts scoped
 * to the same cwd also repair a stale or not-yet-persisted session id.
 */
export async function findReplyToPrompt(
  provider: string,
  cwd: string,
  preferredSessionId: string | null,
  expectedPrompt: string,
  since: number,
  options: TranscriptLookupOptions = {},
): Promise<MatchedTranscriptReply | null> {
  try {
    const storage = hasAgentAdapter(provider) ? getAgentAdapter(provider).sessionStorage : undefined;
    if (storage === 'opencode-session-json') {
      const sessionIds = [preferredSessionId, ...candidateSessionIds(storage, cwd, preferredSessionId)]
        .filter((sessionId): sessionId is string => Boolean(sessionId));
      for (const sessionId of sessionIds) {
        const turn = openCodeTurn(sessionId, options);
        if (
          turn
          && turn.activity >= since - 2_000
        ) {
          const reply = structuredReplyForPrompt(turn.messages, expectedPrompt);
          if (reply) return { sessionId, text: reply, complete: true };
        }
      }
      return null;
    }
    const preferredPath = preferredSessionId ? preferredTranscriptPath(storage, cwd, preferredSessionId, options) : null;
    if (preferredPath && statSync(preferredPath).mtimeMs >= since - 2_000) {
      const reply = replyAtPath(storage, preferredPath, expectedPrompt);
      if (reply && preferredSessionId) return { sessionId: preferredSessionId, ...reply };
    }
    for (const path of candidateTranscriptPaths(storage, cwd, since, options)) {
      if (path === preferredPath) continue;
      const reply = replyAtPath(storage, path, expectedPrompt);
      const sessionId = reply ? sessionIdForPath(storage, path) : null;
      if (reply && sessionId) return { sessionId, ...reply };
    }
    for (const sessionId of candidateSessionIds(storage, cwd, preferredSessionId)) {
      const path = preferredTranscriptPath(storage, cwd, sessionId, options);
      if (!path || path === preferredPath || statSync(path).mtimeMs < since - 2_000) continue;
      const reply = replyAtPath(storage, path, expectedPrompt);
      if (reply) return { sessionId, ...reply };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Ultima resposta do agente pelo transcrito da CLI (null = indisponivel —
 * quem chama cai na raspagem de tela como fallback).
 */
export async function lastReplyText(provider: string, cwd: string, sessionId: string): Promise<string | null> {
  try {
    const storage = hasAgentAdapter(provider) ? getAgentAdapter(provider).sessionStorage : undefined;
    if (storage === 'claude-project-jsonl') {
      const path = claudeTranscriptPath(cwd, sessionId);
      if (!existsSync(path)) return null;
      const jsonl = readTail(path);
      return jsonl ? parseClaudeTranscriptReply(jsonl) : null;
    }
    if (storage === 'codex-rollout-jsonl') {
      const path = findCodexTranscript(sessionId);
      if (!path) return null;
      const jsonl = readTail(path);
      return jsonl ? parseCodexTranscriptReply(jsonl) : null;
    }
    if (storage === 'kimi-session-dir') {
      const path = findKimiTranscript(sessionId);
      if (!path) return null;
      const jsonl = readTail(path);
      return jsonl ? parseKimiTranscriptReply(jsonl) : null;
    }
    if (storage === 'opencode-session-json') {
      return openCodeTurn(sessionId)?.reply ?? null;
    }
    if (storage === 'cursor-transcript-jsonl') {
      const path = cursorTranscriptPath(cwd, sessionId);
      const jsonl = path ? readTail(path) : null;
      return jsonl ? parseGenericTranscriptReply(jsonl) : null;
    }
    if (storage === 'antigravity-workspace-cache') {
      const path = antigravityTranscriptPath(sessionId);
      const jsonl = path ? readTail(path) : null;
      return jsonl ? parseGenericTranscriptReply(jsonl) : null;
    }
    if (storage === 'cline-session-manifest') {
      const path = clineMessagesPath(sessionId);
      if (!path) return null;
      const payload = JSON.parse(readFileSync(path, 'utf8')) as unknown;
      if (Array.isArray(payload)) return parseStructuredMessagesReply(payload);
      const messages = payload && typeof payload === 'object'
        ? (payload as { messages?: unknown }).messages
        : null;
      return Array.isArray(messages) ? parseStructuredMessagesReply(messages) : null;
    }
    if (storage === 'devin-session-db') {
      const path = devinTranscriptPath(sessionId);
      return path ? parseDevinTranscriptReply(readFileSync(path, 'utf8')) : null;
    }
    return null;
  } catch {
    return null;
  }
}
