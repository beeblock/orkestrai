import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { workspaceRepository } from '$lib/modules/agent-room/infrastructure/repositories/WorkspaceRepository.js';
import type { TerminalNodePayload } from '$lib/modules/agent-room/domain/types.js';

export type TokenProvider = 'claude' | 'codex';
export type TokenCounts = { input: number; output: number; cached: number };
export type TokenDay = TokenCounts & { date: string; provider: TokenProvider };
export type TokenAgent = TokenCounts & { nodeId: string; title: string; provider: TokenProvider };
export type TokenAnalytics = { days: TokenDay[]; agents: TokenAgent[]; totals: Record<TokenProvider, TokenCounts>; scannedFiles: number; scannedAt: string };

type FileContribution = { provider: TokenProvider; sessionId: string | null; byDay: Record<string, TokenCounts> };
type CacheEntry = { mtimeMs: number; size: number; contribution: FileContribution };

const MAX_DAYS = 90;
const MAX_FILES = 600;
const cacheRef = globalThis as typeof globalThis & { __orkestraiTokenFileCache?: Map<string, CacheEntry> };
const fileCache = (cacheRef.__orkestraiTokenFileCache ??= new Map());

function emptyCounts(): TokenCounts {
  return { input: 0, output: 0, cached: 0 };
}

function dayOf(timestamp: unknown): string | null {
  const date = new Date(String(timestamp ?? ''));
  if (!Number.isFinite(date.getTime())) return null;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function add(target: Record<string, TokenCounts>, day: string, counts: Partial<TokenCounts>): void {
  const bucket = (target[day] ??= emptyCounts());
  bucket.input += Math.max(0, Number(counts.input) || 0);
  bucket.output += Math.max(0, Number(counts.output) || 0);
  bucket.cached += Math.max(0, Number(counts.cached) || 0);
}

/** Claude Code transcript: one usage per assistant message id (streamed blocks repeat it). */
export async function readClaudeTranscript(lines: AsyncIterable<string>): Promise<FileContribution> {
  const byMessage = new Map<string, { day: string; counts: TokenCounts }>();
  let sessionId: string | null = null;
  for await (const line of lines) {
    if (!line.includes('"usage"')) continue;
    let record: { type?: string; timestamp?: string; sessionId?: string; message?: { id?: string; usage?: Record<string, unknown> } };
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    const usage = record.message?.usage;
    const day = dayOf(record.timestamp);
    if (record.type !== 'assistant' || !usage || !day) continue;
    sessionId ??= record.sessionId ?? null;
    const key = record.message?.id ?? `${record.timestamp}:${byMessage.size}`;
    byMessage.set(key, {
      day,
      counts: {
        input: Number(usage.input_tokens ?? 0) + Number(usage.cache_creation_input_tokens ?? 0),
        output: Number(usage.output_tokens ?? 0),
        cached: Number(usage.cache_read_input_tokens ?? 0),
      },
    });
  }
  const byDay: Record<string, TokenCounts> = {};
  for (const { day, counts } of byMessage.values()) add(byDay, day, counts);
  return { provider: 'claude', sessionId, byDay };
}

/** Codex rollout: totals only grow, so each token_count adds what changed since the last one. */
export async function readCodexRollout(lines: AsyncIterable<string>): Promise<FileContribution> {
  let sessionId: string | null = null;
  let previous = { input: 0, output: 0, cached: 0 };
  const byDay: Record<string, TokenCounts> = {};
  for await (const line of lines) {
    if (!sessionId && line.includes('"session_meta"')) {
      try {
        const meta = JSON.parse(line) as { payload?: { session_id?: string; id?: string } };
        sessionId = meta.payload?.session_id ?? meta.payload?.id ?? null;
      } catch {
        // A truncated header only loses the attribution, not the counts.
      }
      continue;
    }
    if (!line.includes('"token_count"')) continue;
    let record: { timestamp?: string; payload?: { type?: string; info?: { total_token_usage?: Record<string, number> } | null } };
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    const total = record.payload?.info?.total_token_usage;
    const day = dayOf(record.timestamp);
    if (record.payload?.type !== 'token_count' || !total || !day) continue;
    const cached = Number(total.cached_input_tokens ?? 0);
    const current = { input: Math.max(0, Number(total.input_tokens ?? 0) - cached), output: Number(total.output_tokens ?? 0), cached };
    add(byDay, day, { input: current.input - previous.input, output: current.output - previous.output, cached: current.cached - previous.cached });
    previous = { input: Math.max(previous.input, current.input), output: Math.max(previous.output, current.output), cached: Math.max(previous.cached, current.cached) };
  }
  return { provider: 'codex', sessionId, byDay };
}

async function* fileLines(path: string): AsyncIterable<string> {
  const lines = createInterface({ input: createReadStream(path, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of lines) yield line;
}

async function recentFiles(root: string, since: number, depth: number): Promise<string[]> {
  const found: string[] = [];
  const visit = async (dir: string, level: number): Promise<void> => {
    if (found.length >= MAX_FILES) return;
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory() && level < depth) await visit(path, level + 1);
      else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        const info = await stat(path).catch(() => null);
        if (info && info.mtimeMs >= since) found.push(path);
      }
      if (found.length >= MAX_FILES) return;
    }
  };
  await visit(root, 0);
  return found;
}

/**
 * Tokens by day and by agent, read straight from each CLI's own session logs
 * on this computer. Only counts are kept; message content never leaves the files.
 */
export class TokenAnalyticsService {
  async analytics(input: { days?: number; workspaceId?: string | null } = {}): Promise<TokenAnalytics> {
    const days = Math.max(1, Math.min(MAX_DAYS, Math.round(input.days ?? 30)));
    const since = Date.now() - days * 86_400_000;
    const home = process.env.HOME || homedir();
    const codexHome = process.env.CODEX_HOME || join(home, '.codex');
    const [claudeFiles, codexFiles] = await Promise.all([
      recentFiles(join(home, '.claude', 'projects'), since, 1),
      recentFiles(join(codexHome, 'sessions'), since, 3),
    ]);
    const contributions: FileContribution[] = [];
    for (const [path, provider] of [...claudeFiles.map((file) => [file, 'claude'] as const), ...codexFiles.map((file) => [file, 'codex'] as const)]) {
      const info = await stat(path).catch(() => null);
      if (!info) continue;
      const cached = fileCache.get(path);
      if (cached && cached.mtimeMs === info.mtimeMs && cached.size === info.size) {
        contributions.push(cached.contribution);
        continue;
      }
      const contribution = provider === 'claude' ? await readClaudeTranscript(fileLines(path)) : await readCodexRollout(fileLines(path));
      fileCache.set(path, { mtimeMs: info.mtimeMs, size: info.size, contribution });
      contributions.push(contribution);
    }

    const firstDay = dayOf(new Date(since).toISOString()) ?? '';
    const dayMap = new Map<string, TokenDay>();
    const totals: Record<TokenProvider, TokenCounts> = { claude: emptyCounts(), codex: emptyCounts() };
    for (const contribution of contributions) {
      for (const [day, counts] of Object.entries(contribution.byDay)) {
        if (day < firstDay) continue;
        const key = `${day}:${contribution.provider}`;
        const bucket = dayMap.get(key) ?? { date: day, provider: contribution.provider, ...emptyCounts() };
        bucket.input += counts.input;
        bucket.output += counts.output;
        bucket.cached += counts.cached;
        dayMap.set(key, bucket);
        totals[contribution.provider].input += counts.input;
        totals[contribution.provider].output += counts.output;
        totals[contribution.provider].cached += counts.cached;
      }
    }

    const agents: TokenAgent[] = [];
    if (input.workspaceId) {
      const nodes = await workspaceRepository.listNodes(input.workspaceId, undefined, false, true);
      for (const node of nodes) {
        const payload = node.payload as TerminalNodePayload;
        if (node.type !== 'terminal' || !payload.agentSessionId || (payload.provider !== 'claude' && payload.provider !== 'codex')) continue;
        const counts = emptyCounts();
        for (const contribution of contributions) {
          if (contribution.sessionId !== payload.agentSessionId) continue;
          for (const [day, value] of Object.entries(contribution.byDay)) {
            if (day < firstDay) continue;
            counts.input += value.input;
            counts.output += value.output;
            counts.cached += value.cached;
          }
        }
        if (counts.input + counts.output + counts.cached > 0) agents.push({ nodeId: node.id, title: node.title ?? '', provider: payload.provider as TokenProvider, ...counts });
      }
      agents.sort((a, b) => (b.input + b.output) - (a.input + a.output));
    }

    return {
      days: [...dayMap.values()].sort((a, b) => a.date.localeCompare(b.date) || a.provider.localeCompare(b.provider)),
      agents,
      totals,
      scannedFiles: contributions.length,
      scannedAt: new Date().toISOString(),
    };
  }
}

export const tokenAnalyticsService = new TokenAnalyticsService();
