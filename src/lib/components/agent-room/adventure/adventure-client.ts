import { getCsrfToken } from '@beeblock/svelar/http';
import type { AdventureOutcome, AdventureSnapshot } from '$lib/modules/agent-room/application/services/AdventureService.js';
import type { AdventureAction, AdventureReportInput } from '$lib/modules/agent-room/contracts/schemas/adventure.schema.js';

export type { AdventureOutcome, AdventureSnapshot, AdventureAction };
export type SnapshotHero = AdventureSnapshot['heroes'][number];

/** A refusal from the Adventure's rules, with the code the catalogs translate and the HTTP status. */
export class AdventureRequestError extends Error {
  constructor(readonly code: string, readonly status: number | null = null) {
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
  if (!response.ok) throw new AdventureRequestError(String(body.code ?? body.error ?? 'request'), response.status);
  return body.data as AdventureOutcome;
}

/** `offline: false` while the screen still holds battle fought during the gap: it reports that instead. */
export function loadAdventure(workspaceId: string, options: { offline?: boolean } = {}): Promise<AdventureOutcome> {
  return call(options.offline === false ? `${base(workspaceId)}?offline=0` : base(workspaceId));
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

/** The strip's look changed in Settings: the strip (another window) re-reads it now. */
export function notifyAdventureSettings(): void {
  try {
    const channel = new BroadcastChannel(CHANNEL);
    channel.postMessage({ settings: true, at: Date.now() });
    channel.close();
  } catch {
    // The strip re-reads its settings on a timer anyway.
  }
}

export function onAdventureSettings(callback: () => void): () => void {
  try {
    const channel = new BroadcastChannel(CHANNEL);
    channel.onmessage = (event) => { if (event.data?.settings === true) callback(); };
    return () => channel.close();
  } catch {
    return () => {};
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
