import type { PortalWebviewElement } from './portal-design-inspector.js';
import { unobstructedPortalRect } from './portal-surface-geometry.js';

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
  let lastBounds = '';
  let moving = false;
  let settleTimer: ReturnType<typeof setTimeout> | undefined;
  let previewPending = false;
  let previewTimer: ReturnType<typeof setTimeout> | undefined;
  const preview = document.createElement('img');
  preview.alt = '';
  preview.draggable = false;
  preview.setAttribute('aria-hidden', 'true');
  preview.dataset.portalPreview = '';
  Object.assign(preview.style, { width: '100%', height: '100%', objectFit: 'fill', pointerEvents: 'none', display: 'block' });
  preview.style.visibility = 'hidden';
  host.append(preview);
  const call = (method: string, args: Record<string, unknown> = {}) => desktop.portalSurface({ ...identity, method, args });
  async function refreshPreview() {
    if (disposed || previewPending || !current?.webContentsId || document.visibilityState !== 'visible') return;
    const rect = host.getBoundingClientRect();
    if (rect.right <= 0 || rect.bottom <= 0 || rect.left >= innerWidth || rect.top >= innerHeight) return;
    previewPending = true;
    const tabId = current.activeTabId;
    try {
      const url = await call('preview');
      if (!disposed && current?.activeTabId === tabId && typeof url === 'string' && url.startsWith('data:image/')) {
        preview.src = url;
        preview.style.visibility = 'visible';
      }
    } catch { /* A loading page can be captured after it finishes. */ }
    finally { previewPending = false; }
  }
  function settle() {
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      if (interacting) return;
      moving = false;
      position();
      void refreshPreview();
    }, 120);
  }
  const updateState = (state: State) => {
    if (disposed) return;
    const changed = state.url !== current?.url;
    current = state; input.state?.(state);
    if (changed) {
      preview.style.visibility = 'hidden';
      Object.assign(host, { src: state.url });
      const event = new Event('did-navigate'); Object.assign(event, { url: state.url, isMainFrame: true }); host.dispatchEvent(event);
    }
    host.dispatchEvent(new Event('did-finish-load'));
    // Native navigation can finish before Chromium has composited a frame.
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => void refreshPreview(), 250);
  };
  const ready = call('attach').then((state: State) => {
    updateState(state); lastGeometry = ''; position();
  });
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
    const boundsKey = [rect.x, rect.y, rect.width, rect.height].map(value => Math.round(value * 100) / 100).join(':');
    if (lastBounds && boundsKey !== lastBounds) { moving = true; settle(); }
    lastBounds = boundsKey;
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
    const clip = unobstructedPortalRect({ x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) },
      Array.from(document.querySelectorAll<HTMLElement>('.svelte-flow__panel, [data-portal-occluder]'))
        .filter(element => !element.contains(host) && getComputedStyle(element).visibility !== 'hidden')
        .map(element => element.getBoundingClientRect()));
    const geometry = {
      bounds: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.max(1, Math.round(rect.width)), height: Math.max(1, Math.round(rect.height)) },
      clip: { x: Math.ceil(clip.x), y: Math.ceil(clip.y), width: Math.max(0, Math.floor(clip.x + clip.width) - Math.ceil(clip.x)), height: Math.max(0, Math.floor(clip.y + clip.height) - Math.ceil(clip.y)) },
      moving,
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
  const startInteraction = (event: PointerEvent) => {
    interacting = true;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('.svelte-flow') && !target.closest('.nodrag, .svelte-flow__panel, input, button, textarea')) {
      void refreshPreview();
      moving = true;
      position();
    }
    if (!interactionFrame) interactionFrame = requestAnimationFrame(tick);
  };
  const endInteraction = () => { interacting = false; if (moving) settle(); position(); };
  const wheelInteraction = (event: WheelEvent) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target?.closest('.svelte-flow') || target.closest('.nowheel, .svelte-flow__panel')) return;
    if (!moving) void refreshPreview();
    moving = true; settle(); position();
  };
  document.addEventListener('pointerdown', startInteraction, true);
  window.addEventListener('pointerup', endInteraction, true);
  window.addEventListener('pointercancel', endInteraction, true);
  window.addEventListener('blur', endInteraction);
  window.addEventListener('resize', position);
  document.addEventListener('visibilitychange', position);
  window.addEventListener('scroll', position, true);
  document.addEventListener('wheel', wheelInteraction, { capture: true, passive: true });
  return { destroy() {
    disposed = true; interacting = false; cancelAnimationFrame(interactionFrame);
    clearTimeout(settleTimer); clearTimeout(previewTimer); preview.remove();
    observer.disconnect(); mutations.disconnect(); unsubscribe(); window.removeEventListener('scroll', position, true);
    document.removeEventListener('pointerdown', startInteraction, true);
    document.removeEventListener('wheel', wheelInteraction, true);
    window.removeEventListener('pointerup', endInteraction, true);
    window.removeEventListener('pointercancel', endInteraction, true);
    window.removeEventListener('blur', endInteraction);
    window.removeEventListener('resize', position);
    document.removeEventListener('visibilitychange', position);
    input.ready(null);
    void ready.finally(() => call('detach')).catch(() => {});
  } };
}
