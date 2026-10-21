import type { AgentAttentionItem } from '$lib/modules/agent-room/domain/types.js';

/**
 * Open attention items of the workspace on screen, shared by the canvas
 * summary, node banners and the Conversation view. `scheduleAttentionRefresh`
 * is called by the page that already receives `attentionChanged` frames.
 */
export const attentionFeed = $state<{
  workspaceId: string | null;
  items: AgentAttentionItem[];
  byNode: Record<string, AgentAttentionItem[]>;
  loaded: boolean;
}>({ workspaceId: null, items: [], byNode: {}, loaded: false });

export function isActiveAttention(item: AgentAttentionItem, now = Date.now()): boolean {
  if (item.status === 'open' || item.status === 'read') return true;
  return item.status === 'snoozed' && new Date(item.snoozedUntil ?? 0).getTime() <= now;
}

let consumers = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
let inFlight = false;
let dirty = false;
let generation = 0;

async function load(workspaceId: string, ticket: number): Promise<void> {
  try {
    const response = await fetch(`/api/agent-room/attention?workspaceId=${encodeURIComponent(workspaceId)}&limit=300`, { cache: 'no-store' });
    const payload = await response.json().catch(() => null) as { data?: AgentAttentionItem[] } | null;
    if (!response.ok || !Array.isArray(payload?.data) || ticket !== generation) return;
    const now = Date.now();
    const items = payload.data.filter((item) => item.workspaceId === workspaceId && isActiveAttention(item, now));
    const byNode: Record<string, AgentAttentionItem[]> = {};
    for (const item of items) {
      const nodeId = item.nodeId ?? (typeof item.action?.nodeId === 'string' ? item.action.nodeId : null);
      if (!nodeId) continue;
      (byNode[nodeId] ||= []).push(item);
    }
    attentionFeed.items = items;
    attentionFeed.byNode = byNode;
    attentionFeed.loaded = true;
  } catch {
    // Keep the last known items; the next change event retries.
  }
}

function run(): void {
  const workspaceId = attentionFeed.workspaceId;
  if (!workspaceId) return;
  if (inFlight) { dirty = true; return; }
  inFlight = true;
  dirty = false;
  void load(workspaceId, generation).finally(() => {
    inFlight = false;
    if (dirty) scheduleAttentionRefresh();
  });
}

export function scheduleAttentionRefresh(delay = 200): void {
  if (!attentionFeed.workspaceId || timer) return;
  timer = setTimeout(() => { timer = null; run(); }, delay);
}

/** Starts (or retargets) the feed; returns a release function. */
export function retainAttentionFeed(workspaceId: string | null): () => void {
  consumers += 1;
  if (workspaceId !== attentionFeed.workspaceId) {
    generation += 1;
    attentionFeed.workspaceId = workspaceId;
    attentionFeed.items = [];
    attentionFeed.byNode = {};
    attentionFeed.loaded = false;
  }
  if (workspaceId) run();
  return () => {
    consumers = Math.max(0, consumers - 1);
    if (consumers > 0) return;
    if (timer) clearTimeout(timer);
    timer = null;
  };
}

/** Marks an item handled (or snoozed) and updates the feed right away. */
export async function updateAttentionItem(item: AgentAttentionItem, status: 'read' | 'resolved' | 'snoozed', csrf: string | null, snoozedUntil?: string): Promise<boolean> {
  const response = await fetch(`/api/agent-room/attention/${encodeURIComponent(item.id)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', ...(csrf ? { 'X-CSRF-Token': csrf } : {}) },
    body: JSON.stringify({ workspaceId: item.workspaceId, status, snoozedUntil }),
  }).catch(() => null);
  if (!response?.ok) return false;
  if (status === 'resolved' || status === 'snoozed') {
    attentionFeed.items = attentionFeed.items.filter((candidate) => candidate.id !== item.id);
    const byNode: Record<string, AgentAttentionItem[]> = {};
    for (const [nodeId, list] of Object.entries(attentionFeed.byNode)) {
      const kept = list.filter((candidate) => candidate.id !== item.id);
      if (kept.length) byNode[nodeId] = kept;
    }
    attentionFeed.byNode = byNode;
  }
  window.dispatchEvent(new CustomEvent('orkestrai:attention-updated'));
  return true;
}

export type AttentionDecisionKind = 'gate' | 'flow' | 'tool' | 'learning' | 'review';
const DECISION_KINDS = new Set<AttentionDecisionKind>(['gate', 'flow', 'tool', 'learning', 'review']);

/** The in-place decision an item offers, if any. */
export function attentionDecisionKind(item: AgentAttentionItem): AttentionDecisionKind | null {
  const kind = item.action?.decision;
  return typeof kind === 'string' && DECISION_KINDS.has(kind as AttentionDecisionKind) ? kind as AttentionDecisionKind : null;
}

/** Answer choices of a question an agent asked the owner. */
export function ownerQuestionOptions(item: AgentAttentionItem): string[] {
  if (item.sourceType !== 'owner_question' || !Array.isArray(item.action?.options)) return [];
  return (item.action.options as unknown[]).filter((option): option is string => typeof option === 'string');
}

function dropItem(id: string): void {
  attentionFeed.items = attentionFeed.items.filter((candidate) => candidate.id !== id);
  const byNode: Record<string, AgentAttentionItem[]> = {};
  for (const [nodeId, list] of Object.entries(attentionFeed.byNode)) {
    const kept = list.filter((candidate) => candidate.id !== id);
    if (kept.length) byNode[nodeId] = kept;
  }
  attentionFeed.byNode = byNode;
  window.dispatchEvent(new CustomEvent('orkestrai:attention-updated'));
}

/** Approves or rejects the request behind an item; returns the server error, if any. */
export async function decideAttentionItem(item: AgentAttentionItem, decision: 'approve' | 'reject', csrf: string | null): Promise<string | null> {
  const response = await fetch(`/api/agent-room/attention/${encodeURIComponent(item.id)}/decide`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(csrf ? { 'X-CSRF-Token': csrf } : {}) },
    body: JSON.stringify({ workspaceId: item.workspaceId, decision }),
  }).catch(() => null);
  if (!response) return '';
  if (!response.ok) return String((await response.json().catch(() => ({})))?.error ?? '');
  dropItem(item.id);
  return null;
}

/** Answers a question an agent asked the owner; false when it did not reach the agent. */
export async function answerOwnerQuestion(item: AgentAttentionItem, text: string, csrf: string | null): Promise<boolean> {
  const channel = item.action?.channel;
  if (item.sourceType !== 'owner_question' || !item.sourceId || typeof channel !== 'string') return false;
  const response = await fetch(`/api/agent-room/workspaces/${encodeURIComponent(item.workspaceId)}/channels/${encodeURIComponent(channel)}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(csrf ? { 'X-CSRF-Token': csrf } : {}) },
    body: JSON.stringify({ body: text, replyToId: item.sourceId }),
  }).catch(() => null);
  const result = response?.ok ? await response.json().catch(() => null) as { data?: { delivered?: Array<{ ok: boolean }> } } | null : null;
  if (!result) return false;
  dropItem(item.id);
  return !(result.data?.delivered ?? []).some((entry) => !entry.ok);
}
