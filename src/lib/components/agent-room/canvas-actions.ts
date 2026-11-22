import { goto } from '$app/navigation';

/**
 * Runs a Canvas action (open a panel, the team map, a dialog) from anywhere:
 * the Canvas handles it at once, other pages hand it over and open the Canvas.
 * Usage is also available as an app-wide drawer without changing the route.
 */
export function runCanvasAction(action: string, workspaceId: string | null = null): void {
  if (action === 'usage' && typeof location !== 'undefined' && location.pathname !== '/canvas') {
    if (sessionStorage.getItem('orkestrai.menu-action') === 'usage') sessionStorage.removeItem('orkestrai.menu-action');
    window.dispatchEvent(new CustomEvent('orkestrai:open-usage', { detail: { workspaceId } }));
    return;
  }
  if (typeof location !== 'undefined' && location.pathname === '/canvas') {
    window.dispatchEvent(new CustomEvent('orkestrai:menu-action', { detail: action }));
    return;
  }
  sessionStorage.setItem('orkestrai.menu-action', action);
  void goto(workspaceId ? `/canvas?workspace=${encodeURIComponent(workspaceId)}` : '/canvas');
}
