import { getCsrfToken } from '@beeblock/svelar/http';

/** Agents the owner paused (process tree stopped); shared by nodes, the map and the chips. */
export const agentPause = $state<{ workspaceId: string | null; ids: string[] }>({ workspaceId: null, ids: [] });

export async function refreshPausedAgents(workspaceId: string | null): Promise<void> {
  agentPause.workspaceId = workspaceId;
  if (!workspaceId) {
    agentPause.ids = [];
    return;
  }
  const response = await fetch(`/api/agent-room/workspaces/${encodeURIComponent(workspaceId)}/terminals/pause`, { cache: 'no-store' }).catch(() => null);
  const body = response?.ok ? await response.json().catch(() => null) as { data?: { nodeIds?: string[] } } | null : null;
  if (agentPause.workspaceId === workspaceId) agentPause.ids = Array.isArray(body?.data?.nodeIds) ? body.data.nodeIds : [];
}

/** Pauses or resumes the workspace's agents; returns the ids changed, or null when unsupported or failed. */
export async function setAgentsPaused(workspaceId: string, paused: boolean, nodeIds?: string[]): Promise<string[] | null> {
  const csrf = getCsrfToken();
  const response = await fetch(`/api/agent-room/workspaces/${encodeURIComponent(workspaceId)}/terminals/pause`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(csrf ? { 'X-CSRF-Token': csrf } : {}) },
    body: JSON.stringify({ paused, ...(nodeIds ? { nodeIds } : {}) }),
  }).catch(() => null);
  const body = response?.ok ? await response.json().catch(() => null) as { data?: { nodeIds?: string[]; supported?: boolean } } | null : null;
  if (!body?.data || body.data.supported === false) return null;
  await refreshPausedAgents(workspaceId);
  return body.data.nodeIds ?? [];
}
