export type WorkspaceMode = 'canvas' | 'terminals' | 'chat';

/**
 * The workspace and node the current page is showing. Pages publish it so the
 * app-wide top bar can keep the mode switch and attention bell in context
 * without each page rendering its own copy.
 */
export const workspaceContext = $state<{
  mode: WorkspaceMode | null;
  workspaceId: string | null;
  nodeId: string | null;
}>({ mode: null, workspaceId: null, nodeId: null });

/** Publishes the page context. Writing equal values does not notify readers. */
export function publishWorkspaceContext(mode: WorkspaceMode, workspaceId: string | null, nodeId: string | null): void {
  if (workspaceContext.mode !== mode) workspaceContext.mode = mode;
  if (workspaceContext.workspaceId !== workspaceId) workspaceContext.workspaceId = workspaceId;
  if (workspaceContext.nodeId !== nodeId) workspaceContext.nodeId = nodeId;
}

/** Clears the context when the page that owns it unmounts. */
export function clearWorkspaceContext(mode: WorkspaceMode): void {
  if (workspaceContext.mode !== mode) return;
  workspaceContext.mode = null;
  workspaceContext.workspaceId = null;
  workspaceContext.nodeId = null;
}
