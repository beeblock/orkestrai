import { getCsrfToken } from '@beeblock/svelar/http';
import type { AdventureOutcome, AdventureSnapshot } from '$lib/modules/agent-room/application/services/AdventureService.js';
import type { AdventureAction, AdventureReportInput } from '$lib/modules/agent-room/contracts/schemas/adventure.schema.js';

export type { AdventureOutcome, AdventureSnapshot, AdventureAction };
export type SnapshotHero = AdventureSnapshot['heroes'][number];

/** A refusal from the Adventure's rules, with the code the catalogs translate. */
export class AdventureRequestError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

function base(workspaceId: string): string {
  return `/api/agent-room/workspaces/${encodeURIComponent(workspaceId)}/adventure`;
}

async function call(url: string, init?: RequestInit): Promise<AdventureOutcome> {
  const csrf = getCsrfToken();
  const response = await fetch(url, {
    ...init,
    headers: { 'content-type': 'application/json', ...(csrf ? { 'X-CSRF-Token': csrf } : {}), ...(init?.headers ?? {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new AdventureRequestError(String(body.code ?? body.error ?? 'request'));
  return body.data as AdventureOutcome;
}

export function loadAdventure(workspaceId: string): Promise<AdventureOutcome> {
  return call(base(workspaceId));
}

export function reportBattle(workspaceId: string, report: AdventureReportInput): Promise<AdventureOutcome> {
  return call(`${base(workspaceId)}/report`, { method: 'POST', body: JSON.stringify(report) });
}

export async function adventureAction(workspaceId: string, action: AdventureAction): Promise<AdventureOutcome> {
  const outcome = await call(`${base(workspaceId)}/actions`, { method: 'POST', body: JSON.stringify(action) });
  announceChange(workspaceId);
  return outcome;
}

// The strip and the camp live in different windows: they tell each other
// when the save changed so both show the same gear, levels and position.
const CHANNEL = 'orkestrai.adventure';

export function announceChange(workspaceId: string): void {
  try {
    const channel = new BroadcastChannel(CHANNEL);
    channel.postMessage({ workspaceId, at: Date.now() });
    channel.close();
  } catch {
    // BroadcastChannel is unavailable in very old webviews; the timers still catch up.
  }
}

export function onAdventureChange(callback: (workspaceId: string) => void): () => void {
  try {
    const channel = new BroadcastChannel(CHANNEL);
    channel.onmessage = (event) => { if (typeof event.data?.workspaceId === 'string') callback(event.data.workspaceId); };
    return () => channel.close();
  } catch {
    return () => {};
  }
}
