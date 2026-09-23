import { getCsrfToken } from '@beeblock/svelar/http';

export async function knowledgeApi<T>(workspaceId: string, path = 'knowledge', body?: unknown): Promise<T> {
  const response = await fetch(`/api/agent-room/workspaces/${encodeURIComponent(workspaceId)}/${path}`, {
    method: body ? 'POST' : 'GET', cache: 'no-store',
    headers: body ? { 'content-type': 'application/json', 'X-CSRF-Token': getCsrfToken() ?? '' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const result = await response.json();
  if (!response.ok || result.error) throw new Error(result.error ?? 'knowledge_request_failed');
  return result.data as T;
}

export async function uploadKnowledgeFile(workspaceId: string, file: File, placement: { x?: number; y?: number; floorId?: string | null } = {}) {
  const body = new FormData();
  body.set('file', file);
  for (const [key, value] of Object.entries(placement)) if (value != null) body.set(key, String(value));
  const response = await fetch(`/api/agent-room/workspaces/${encodeURIComponent(workspaceId)}/knowledge/files`, { method: 'POST', headers: { 'X-CSRF-Token': getCsrfToken() ?? '' }, body });
  const result = await response.json();
  if (!response.ok || result.error) throw new Error(result.error ?? 'knowledge_request_failed');
  return result.data as import('$lib/modules/agent-room/domain/types.js').CanvasNode;
}
