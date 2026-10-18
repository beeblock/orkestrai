import type { Workspace } from '$lib/modules/agent-room/domain/types.js';

const TABS_KEY = 'orkestrai.workspaceTabs';
const MAX_TABS = 6;

/**
 * Workspaces kept as tabs in the top bar, the full list for the switcher and
 * the open "needs you" count per workspace. One fetch serves the whole bar.
 */
export const workspaceTabs = $state<{
  workspaces: Workspace[];
  tabIds: string[];
  attention: Record<string, number>;
  loaded: boolean;
}>({ workspaces: [], tabIds: [], attention: {}, loaded: false });

function readTabs(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(TABS_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string').slice(0, MAX_TABS) : [];
  } catch {
    return [];
  }
}

function writeTabs(ids: string[]): void {
  workspaceTabs.tabIds = ids;
  try {
    localStorage.setItem(TABS_KEY, JSON.stringify(ids));
  } catch {
    // Tabs simply reset on the next launch.
  }
}

/** Keeps the open workspace among the tabs without reordering the others. */
export function ensureWorkspaceTab(workspaceId: string | null): void {
  if (!workspaceId) return;
  const ids = workspaceTabs.tabIds.length ? workspaceTabs.tabIds : readTabs();
  if (ids.includes(workspaceId)) {
    if (workspaceTabs.tabIds !== ids) workspaceTabs.tabIds = ids;
    return;
  }
  writeTabs([...ids, workspaceId].slice(-MAX_TABS));
}

export function closeWorkspaceTab(workspaceId: string): void {
  writeTabs(workspaceTabs.tabIds.filter((id) => id !== workspaceId));
}

let timer: ReturnType<typeof setInterval> | null = null;
let consumers = 0;

export async function refreshWorkspaceTabs(): Promise<void> {
  try {
    const [workspacesResponse, attentionResponse] = await Promise.all([
      fetch('/api/agent-room/workspaces', { cache: 'no-store' }),
      fetch('/api/agent-room/attention?limit=300', { cache: 'no-store' }),
    ]);
    const workspaces = await workspacesResponse.json().catch(() => null) as { data?: Workspace[] } | null;
    const attention = await attentionResponse.json().catch(() => null) as { data?: Array<{ workspaceId: string | null; status: string; snoozedUntil?: string | null }> } | null;
    if (Array.isArray(workspaces?.data)) {
      workspaceTabs.workspaces = workspaces.data;
      const known = new Set(workspaces.data.map((workspace) => workspace.id));
      const ids = (workspaceTabs.tabIds.length ? workspaceTabs.tabIds : readTabs()).filter((id) => known.has(id));
      if (ids.join() !== workspaceTabs.tabIds.join()) writeTabs(ids);
    }
    if (Array.isArray(attention?.data)) {
      const now = Date.now();
      const counts: Record<string, number> = {};
      for (const item of attention.data) {
        const active = item.status === 'open' || item.status === 'read' || (item.status === 'snoozed' && new Date(item.snoozedUntil ?? 0).getTime() <= now);
        if (active && item.workspaceId) counts[item.workspaceId] = (counts[item.workspaceId] ?? 0) + 1;
      }
      workspaceTabs.attention = counts;
    }
    workspaceTabs.loaded = true;
  } catch {
    // The bar keeps the last known list.
  }
}

function onRefresh(): void {
  void refreshWorkspaceTabs();
}

export function retainWorkspaceTabs(): () => void {
  consumers += 1;
  if (consumers === 1) {
    workspaceTabs.tabIds = readTabs();
    void refreshWorkspaceTabs();
    timer = setInterval(() => {
      if (document.visibilityState === 'visible') void refreshWorkspaceTabs();
    }, 20_000);
    window.addEventListener('orkestrai:workspaces-changed', onRefresh);
    window.addEventListener('orkestrai:attention-changed', onRefresh);
  }
  return () => {
    consumers = Math.max(0, consumers - 1);
    if (consumers > 0) return;
    if (timer) clearInterval(timer);
    timer = null;
    window.removeEventListener('orkestrai:workspaces-changed', onRefresh);
    window.removeEventListener('orkestrai:attention-changed', onRefresh);
  };
}
