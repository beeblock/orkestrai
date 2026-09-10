import type { PortalWebviewElement } from './portal-design-inspector.js';

type State = { url: string; webContentsId: number; tabs: Array<{ id: string; url: string; title: string }>; activeTabId: string };
type SurfaceInput = { workspaceId: string; nodeId: string; ready: (frame: PortalWebviewElement | null) => void; state?: (value: State) => void };
type Desktop = {
  portalSurface: (input: Record<string, unknown>) => Promise<any>;
  portalLayout: (input: Record<string, unknown>) => void;
  onPortalState: (callback: (event: { workspaceId: string; nodeId: string; state: State }) => void) => () => void;
};

export function managedPortalSurface(host: HTMLElement, input: SurfaceInput) {
  const desktop = (window as unknown as { orkestraiDesktop: Desktop }).orkestraiDesktop;
  const identity = { workspaceId: input.workspaceId, nodeId: input.nodeId, lease: crypto.randomUUID() };
  let disposed = false;
  let current: State | undefined;
  let lastGeometry = '';
  const call = (method: string, args: Record<string, unknown> = {}) => desktop.portalSurface({ ...identity, method, args });
  const updateState = (state: State) => {
    if (disposed) return;
    const changed = state.url !== current?.url;
    current = state; input.state?.(state);
    if (changed) {
      Object.assign(host, { src: state.url });
      const event = new Event('did-navigate'); Object.assign(event, { url: state.url, isMainFrame: true }); host.dispatchEvent(event);
    }
    host.dispatchEvent(new Event('did-finish-load'));
  };
  const ready = call('attach').then((state: State) => { updateState(state); lastGeometry = ''; position(); });
  const frame = Object.assign(host, {
    src: '', getWebContentsId: () => current?.webContentsId ?? 0,
    loadURL: async (url: string) => { await ready; updateState(await call('navigate', { url })); },
    executeJavaScript: async (code: string) => { await ready; return call('inspectScript', { code }); },
    capturePage: async (rect?: { x: number; y: number; width: number; height: number }) => {
      await ready; const url = await call('capture', { rect }); return { toDataURL: () => url, isEmpty: () => !url };
    },
  }) as PortalWebviewElement;
  input.ready(frame);
  void ready.catch(() => {
    if (disposed) return;
    const event = new Event('did-fail-load'); Object.assign(event, { isMainFrame: true, errorDescription: 'Portal could not be opened.' }); host.dispatchEvent(event);
  });
  const unsubscribe = desktop.onPortalState((event) => {
    if (event.workspaceId === input.workspaceId && event.nodeId === input.nodeId) updateState(event.state);
  });

  function position() {
    if (disposed || !host.isConnected) return;
    const rect = host.getBoundingClientRect();
    let left = Math.max(0, rect.left), top = Math.max(0, rect.top), right = Math.min(innerWidth, rect.right), bottom = Math.min(innerHeight, rect.bottom);
    for (let parent = host.parentElement; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent);
      if (/(hidden|auto|scroll|clip)/.test(style.overflow + style.overflowX + style.overflowY)) {
        const bounds = parent.getBoundingClientRect();
        left = Math.max(left, bounds.left); top = Math.max(top, bounds.top); right = Math.min(right, bounds.right); bottom = Math.min(bottom, bounds.bottom);
      }
    }
    const blocker = document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [role="menu"][data-state="open"], [data-popover-content][data-state="open"]');
    const owner = host.closest('.svelte-flow__node');
    const covered = owner && [[left + 2, top + 2], [right - 2, bottom - 2], [(left + right) / 2, (top + bottom) / 2]].some(([x, y]) => {
      const topNode = document.elementFromPoint(x, y)?.closest('.svelte-flow__node');
      return topNode && topNode !== owner;
    });
    const geometry = {
      bounds: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.max(1, Math.round(rect.width)), height: Math.max(1, Math.round(rect.height)) },
      clip: { x: Math.round(left), y: Math.round(top), width: Math.max(0, Math.floor(right - left)), height: Math.max(0, Math.floor(bottom - top)) },
      zoom: Math.min(5, Math.max(0.1, rect.width / (host.offsetWidth || rect.width || 1))),
      visible: !blocker && !covered && document.visibilityState === 'visible' && getComputedStyle(host).visibility !== 'hidden' && right > left && bottom > top,
    };
    const serialized = JSON.stringify(geometry);
    if (serialized !== lastGeometry) { lastGeometry = serialized; desktop.portalLayout({ ...identity, geometry }); }
  }
  // Observe the actual transformed ancestors before paint. Polling trails the
  // Canvas by several frames and native views do not inherit DOM transforms.
  const observer = new ResizeObserver(position); observer.observe(host);
  const mutations = new MutationObserver(position);
  for (let element: HTMLElement | null = host; element; element = element.parentElement) {
    mutations.observe(element, { attributes: true, attributeFilter: ['style', 'class', 'hidden'] });
  }
  mutations.observe(document.body, { childList: true });
  let interactionFrame = 0;
  let interacting = false;
  const tick = () => {
    position();
    interactionFrame = interacting ? requestAnimationFrame(tick) : 0;
  };
  const startInteraction = () => {
    interacting = true;
    if (!interactionFrame) interactionFrame = requestAnimationFrame(tick);
  };
  const endInteraction = () => { interacting = false; position(); };
  document.addEventListener('pointerdown', startInteraction, true);
  window.addEventListener('pointerup', endInteraction, true);
  window.addEventListener('pointercancel', endInteraction, true);
  window.addEventListener('blur', endInteraction);
  window.addEventListener('resize', position);
  document.addEventListener('visibilitychange', position);
  window.addEventListener('scroll', position, true);
  return { destroy() {
    disposed = true; interacting = false; cancelAnimationFrame(interactionFrame);
    observer.disconnect(); mutations.disconnect(); unsubscribe(); window.removeEventListener('scroll', position, true);
    document.removeEventListener('pointerdown', startInteraction, true);
    window.removeEventListener('pointerup', endInteraction, true);
    window.removeEventListener('pointercancel', endInteraction, true);
    window.removeEventListener('blur', endInteraction);
    window.removeEventListener('resize', position);
    document.removeEventListener('visibilitychange', position);
    input.ready(null);
    void ready.finally(() => call('detach')).catch(() => {});
  } };
}
