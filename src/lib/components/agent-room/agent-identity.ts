import type { AgentActivityState } from '$lib/modules/agent-room/domain/types.js';

/**
 * Teammate colors. Each one is a chip background with its own ink, so the
 * pair stays readable on every built-in theme (light and dark) instead of
 * depending on the surface behind it.
 */
export const AGENT_COLORS = [
  { bg: '#e8b84a', ink: '#1a1405' },
  { bg: '#b6a2ff', ink: '#1b1433' },
  { bg: '#5fd2c2', ink: '#052420' },
  { bg: '#f19a76', ink: '#2b1208' },
  { bg: '#7cbff0', ink: '#07192a' },
  { bg: '#a8d672', ink: '#142306' },
  { bg: '#f29bc0', ink: '#2e0c1c' },
  { bg: '#d9c08a', ink: '#261d08' },
] as const;

export type AgentColor = (typeof AGENT_COLORS)[number];

/** Stable color for a teammate: the same node keeps its color across screens and restarts. */
export function agentColor(nodeId: string): AgentColor {
  let hash = 2166136261;
  for (let index = 0; index < nodeId.length; index += 1) {
    hash ^= nodeId.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return AGENT_COLORS[(hash >>> 0) % AGENT_COLORS.length];
}

/** Two-letter monogram from the agent title ("Codex Lider" → "CL", "QA Upload" → "QU"). */
export function agentInitials(title: string): string {
  const words = title.normalize('NFKC').split(/[\s\-_/·.]+/u).filter((word) => /\p{L}|\p{N}/u.test(word));
  if (words.length === 0) return '?';
  if (words.length === 1) return Array.from(words[0]).slice(0, 2).join('').toUpperCase();
  return (Array.from(words[0])[0] + Array.from(words[words.length - 1])[0]).toUpperCase();
}

/** Visual state shared by status glyphs everywhere (canvas headers, lists, phone). */
export type AgentTone = 'working' | 'attention' | 'blocked' | 'review' | 'done' | 'idle' | 'offline';

export function agentTone(state: AgentActivityState | null | undefined): AgentTone {
  if (state === 'working' || state === 'starting') return 'working';
  if (state === 'waiting_input' || state === 'waiting_permission') return 'attention';
  if (state === 'blocked' || state === 'error') return 'blocked';
  if (state === 'done') return 'done';
  if (state === 'disconnected') return 'offline';
  return 'idle';
}

export const ATTENTION_STATES: ReadonlySet<AgentActivityState> = new Set(['waiting_input', 'waiting_permission', 'blocked', 'error']);

/** Compact elapsed time, in whole units, for "since" labels. */
export function elapsedParts(since: string | null | undefined, now: number): { unit: 'seconds' | 'minutes' | 'hours' | 'days'; count: number } | null {
  if (!since) return null;
  const start = Date.parse(since);
  if (!Number.isFinite(start)) return null;
  const seconds = Math.max(0, Math.floor((now - start) / 1000));
  if (seconds < 60) return { unit: 'seconds', count: seconds };
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return { unit: 'minutes', count: minutes };
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return { unit: 'hours', count: hours };
  return { unit: 'days', count: Math.floor(hours / 24) };
}

/** Model chosen at launch, read from CLI args (`--model x`, `-m x`, `--model=x`). */
export function modelFromArgs(args: readonly unknown[] | null | undefined): string | null {
  if (!Array.isArray(args)) return null;
  for (let index = 0; index < args.length; index += 1) {
    const value = String(args[index] ?? '');
    if (value.startsWith('--model=')) return value.slice(8).trim() || null;
    if ((value === '--model' || value === '-m') && typeof args[index + 1] === 'string') {
      const next = String(args[index + 1]).trim();
      return next && !next.startsWith('-') ? next : null;
    }
  }
  return null;
}
