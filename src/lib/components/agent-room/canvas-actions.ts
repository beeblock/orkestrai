import { goto } from '$app/navigation';

/**
 * Runs a Canvas action (open a panel, the team map, a dialog) from anywhere:
 * the Canvas handles it at once, other pages hand it over and open the Canvas.
 */
export function runCanvasAction(action: string, workspaceId: string | null = null): void {
  if (typeof location !== 'undefined' && location.pathname === '/canvas') {
    window.dispatchEvent(new CustomEvent('orkestrai:menu-action', { detail: action }));
    return;
  }
  sessionStorage.setItem('orkestrai.menu-action', action);
  void goto(workspaceId ? `/canvas?workspace=${encodeURIComponent(workspaceId)}` : '/canvas');
}
