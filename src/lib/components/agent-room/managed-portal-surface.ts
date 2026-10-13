import type { PortalWebviewElement } from './portal-design-inspector.js';
import { unobstructedPortalRect } from './portal-surface-geometry.js';

type State = { url: string; webContentsId: number; tabs: Array<{ id: string; url: string; title: string }>; activeTabId: string; documentRevision?: number };
type SurfaceInput = { workspaceId: string; nodeId: string; ready: (frame: PortalWebviewElement | null) => void; state?: (value: State) => void };
type Desktop = {
  portalSurface: (input: Record<string, unknown>) => Promise<any>;
  portalLayout: (input: Record<string, unknown>) => void;
  onPortalState: (callback: (event: { workspaceId: string; nodeId: string; state: State }) => void) => () => void;
};

const overlays = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [data-popover-content], [data-slot="popover-content"], [role="tooltip"]';
const occluders = '.svelte-flow__panel, [data-portal-occluder]';
const presentationElements = `${overlays}, ${occluders}`;
const surfaceListeners = new Set<() => void>();
let overlayObserver: MutationObserver | undefined;
let overlayResize: ResizeObserver | undefined;

function observeOverlays(listener: () => void) {
  surfaceListeners.add(listener);
  if (!overlayObserver) {
    const notify = () => surfaceListeners.forEach(update => update());
    overlayResize = new ResizeObserver(notify);
    const refresh = () => {
      overlayResize!.disconnect();
      document.querySelectorAll(presentationElements).forEach(element => overlayResize!.observe(element));
      notify();
    };
    // Shared by all Portals. Ignore terminal output and other unrelated DOM churn.
    overlayObserver = new MutationObserver(records => {
      if (records.some(record => record.type === 'attributes'
        ? record.target instanceof Element && record.target.matches(presentationElements)
        : [...record.addedNodes, ...record.removedNodes].some(node => node instanceof Element
          && (node.matches(presentationElements) || node.querySelector(presentationElements))))) refresh();
    });
    overlayObserver.observe(document.body, { subtree: true, childList: true, attributes: true,
      attributeFilter: ['data-state', 'data-open', 'data-closed', 'hidden', 'aria-hidden'] });
    refresh();
  }
  return () => {
    surfaceListeners.delete(listener);
    if (!surfaceListeners.size) {
      overlayObserver?.disconnect(); overlayResize?.disconnect();
      overlayObserver = undefined; overlayResize = undefined;
    }
  };
}

function isPresented(element: Element) {
  return element.getClientRects().length > 0 && !element.hasAttribute('hidden')
    && element.getAttribute('data-state') !== 'closed' && !element.hasAttribute('data-closed')
    && getComputedStyle(element).visibility === 'visible';
}

export function managedPortalSurface(host: HTMLElement, input: SurfaceInput) {
  const desktop = (window as unknown as { orkestraiDesktop: Desktop }).orkestraiDesktop;
  const identity = { workspaceId: input.workspaceId, nodeId: input.nodeId, lease: crypto.randomUUID() };
  let disposed = false;
  let current: State | undefined;
  let lastGeometry = '';
  let restingGeometry: Record<string, unknown> | undefined;
  let moving = false;
  let settleTimer: ReturnType<typeof setTimeout> | undefined;
  let previewPending: Promise<void> | undefined;
  let previewTimer: ReturnType<typeof setTimeout> | undefined;
  let previewRequestedAt = -Infinity;
  let previewRevision = 0;
  const preview = document.createElement('img');
  preview.alt = '';
  preview.draggable = false;
  preview.setAttribute('aria-hidden', 'true');
  preview.dataset.portalPreview = '';
  Object.assign(preview.style, { width: '100%', height: '100%', objectFit: 'fill', pointerEvents: 'none', display: 'block' });
  preview.style.visibility = 'hidden';
  host.append(preview);
  const call = (method: string, args: Record<string, unknown> = {}) => desktop.portalSurface({ ...identity, method, args });
  function refreshPreview(): Promise<void> {
    if (previewPending) return previewPending;
    if (disposed || !current?.webContentsId || document.visibilityState !== 'visible') return Promise.resolve();
    // Cached motion previews are not agent screenshots. Repeated gestures must
    // not detach/reconfigure native pages several times per second.
    if (performance.now() - previewRequestedAt < 1000) return Promise.resolve();
    const rect = host.getBoundingClientRect();
    if (rect.right <= 0 || rect.bottom <= 0 || rect.left >= innerWidth || rect.top >= innerHeight) return Promise.resolve();
    const tabId = current.activeTabId;
    const revision = previewRevision;
    previewRequestedAt = performance.now();
    previewPending = call('preview').then(async url => {
      if (disposed || previewRevision !== revision || current?.activeTabId !== tabId || typeof url !== 'string' || !url.startsWith('data:image/')) return;
      preview.src = url;
      await preview.decode().catch(() => undefined);
      if (!disposed && previewRevision === revision && current?.activeTabId === tabId) preview.style.visibility = 'visible';
    }).catch(() => { /* A loading page can be captured after it finishes. */ })
      .finally(() => {
        previewPending = undefined;
        if (!disposed && previewRevision !== revision) void refreshPreview();
      });
    return previewPending;
  }
  function settle() {
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      if (disposed) return;
      moving = false;
      position();
      void refreshPreview();
    }, 120);
  }
  const updateState = (state: State) => {
    if (disposed) return;
    const changed = state.url !== current?.url;
    // History API/hash updates keep the same document. Capturing on every SPA
    // route detaches the live native view and looks like a full page reload.
    const documentChanged = !current || state.activeTabId !== current.activeTabId
      || state.webContentsId !== current.webContentsId || state.documentRevision !== current.documentRevision;
    current = state; input.state?.(state);
    if (changed) {
      Object.assign(host, { src: state.url });
      const event = new Event(documentChanged ? 'did-navigate' : 'did-navigate-in-page');
      Object.assign(event, { url: state.url, isMainFrame: true }); host.dispatchEvent(event);
    }
    if (documentChanged) {
      previewRevision++;
      previewRequestedAt = -Infinity;
      preview.style.visibility = 'hidden';
      host.dispatchEvent(new Event('did-finish-load'));
      // Reads and title updates are not navigations and must not capture at idle.
      clearTimeout(previewTimer);
      previewTimer = setTimeout(() => void refreshPreview(), 250);
    }
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

  function beginMotion() {
    if (disposed) return;
    if (!moving) {
      moving = true;
      // Hide using the last geometry. Do not measure the transformed DOM on
      // every frame while a native surface cannot be presented anyway.
      if (restingGeometry) {
        const geometry = { ...restingGeometry, moving: true };
        lastGeometry = JSON.stringify(geometry);
        desktop.portalLayout({ ...identity, geometry });
      }
    }
    settle();
  }
  function position() {
    if (disposed || !host.isConnected) return;
    if (moving) return;
    const rect = host.getBoundingClientRect();
    let left = Math.max(0, rect.left), top = Math.max(0, rect.top), right = Math.min(innerWidth, rect.right), bottom = Math.min(innerHeight, rect.bottom);
    for (let parent = host.parentElement; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent);
      if (/(hidden|auto|scroll|clip)/.test(style.overflow + style.overflowX + style.overflowY)) {
        const bounds = parent.getBoundingClientRect();
        left = Math.max(left, bounds.left); top = Math.max(top, bounds.top); right = Math.min(right, bounds.right); bottom = Math.min(bottom, bounds.bottom);
      }
    }
    const blocker = Array.from(document.querySelectorAll(overlays)).some(element =>
      !element.contains(host) && isPresented(element));
    const owner = host.closest('.svelte-flow__node');
    const covered = owner && [[left + 2, top + 2], [right - 2, bottom - 2], [(left + right) / 2, (top + bottom) / 2]].some(([x, y]) => {
      const topNode = document.elementFromPoint(x, y)?.closest('.svelte-flow__node');
      return topNode && topNode !== owner;
    });
    const clip = unobstructedPortalRect({ x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) },
      Array.from(document.querySelectorAll<HTMLElement>(occluders))
        .filter(element => !element.contains(host) && isPresented(element))
        .map(element => element.getBoundingClientRect()));
    const geometry = {
      // Use the same inward rounding as clip so fractional Canvas positions do
      // not look like left/top clipping and unnecessarily disable interaction.
      bounds: { x: Math.ceil(rect.x), y: Math.ceil(rect.y), width: Math.max(1, Math.floor(rect.right) - Math.ceil(rect.x)), height: Math.max(1, Math.floor(rect.bottom) - Math.ceil(rect.y)) },
      clip: { x: Math.ceil(clip.x), y: Math.ceil(clip.y), width: Math.max(0, Math.floor(clip.x + clip.width) - Math.ceil(clip.x)), height: Math.max(0, Math.floor(clip.y + clip.height) - Math.ceil(clip.y)) },
      moving,
      viewport: { width: Math.max(1, host.offsetWidth), height: Math.max(1, host.offsetHeight) },
      zoom: Math.min(5, Math.max(0.05, rect.width / (host.offsetWidth || rect.width || 1))),
      visible: !blocker && !covered && document.visibilityState === 'visible' && isPresented(host) && right > left && bottom > top,
    };
    const serialized = JSON.stringify(geometry);
    if (serialized !== lastGeometry) { lastGeometry = serialized; desktop.portalLayout({ ...identity, geometry }); }
    restingGeometry = geometry;
  }
  // Observe the actual transformed ancestors before paint. Polling trails the
  // Canvas by several frames and native views do not inherit DOM transforms.
  const observer = new ResizeObserver(beginMotion); observer.observe(host);
  const mutations = new MutationObserver(beginMotion);
  for (let element: HTMLElement | null = host; element; element = element.parentElement) {
    mutations.observe(element, { attributes: true, attributeFilter: ['style', 'class', 'hidden'] });
  }
  const unobserveOverlays = observeOverlays(position);
  const startInteraction = (event: PointerEvent) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('.svelte-flow') && !target.closest('.nodrag, .svelte-flow__panel, input, button, textarea')) {
      if (!moving) void refreshPreview();
      beginMotion();
    }
  };
  const wheelInteraction = (event: WheelEvent) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target?.closest('.svelte-flow') || target.closest('.nowheel, .svelte-flow__panel')) return;
    if (!moving) void refreshPreview();
    beginMotion();
  };
  document.addEventListener('pointerdown', startInteraction, true);
  window.addEventListener('resize', position);
  document.addEventListener('visibilitychange', position);
  window.addEventListener('scroll', position, true);
  document.addEventListener('wheel', wheelInteraction, { capture: true, passive: true });
  return { destroy() {
    disposed = true;
    clearTimeout(settleTimer); clearTimeout(previewTimer); preview.remove();
    observer.disconnect(); mutations.disconnect(); unobserveOverlays(); unsubscribe(); window.removeEventListener('scroll', position, true);
    document.removeEventListener('pointerdown', startInteraction, true);
    document.removeEventListener('wheel', wheelInteraction, true);
    window.removeEventListener('resize', position);
    document.removeEventListener('visibilitychange', position);
    input.ready(null);
    void ready.finally(() => call('detach')).catch(() => {});
  } };
}
