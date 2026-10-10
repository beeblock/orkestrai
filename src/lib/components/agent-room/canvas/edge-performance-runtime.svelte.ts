import type { FlowViewport } from './edge-performance.js';

let references = 0;
let cleanup: (() => void) | null = null;
let state = $state<{
  documentVisible: boolean;
  reducedMotion: boolean;
  width: number;
  height: number;
  /** Last viewport after pan/zoom stopped; null until the canvas reports one. */
  viewport: FlowViewport | null;
}>({
  documentVisible: true,
  reducedMotion: false,
  width: 0,
  height: 0,
  viewport: null,
});

export const canvasEdgeRuntime = {
  get current() {
    return state;
  },
};

/**
 * Publishes the viewport once movement has settled. Edges read this snapshot
 * instead of the live viewport store, so panning and zooming never make every
 * edge recompute (or switch rendering mode) on every frame.
 */
export function settleCanvasViewport(viewport: FlowViewport): void {
  state = { ...state, viewport: { x: viewport.x, y: viewport.y, zoom: viewport.zoom } };
}

export function retainCanvasEdgeRuntime(): () => void {
  references += 1;
  if (typeof window !== 'undefined' && !cleanup) {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => {
      state = {
        ...state,
        documentVisible: document.visibilityState !== 'hidden',
        reducedMotion: media.matches,
        width: window.innerWidth,
        height: window.innerHeight,
      };
    };
    sync();
    document.addEventListener('visibilitychange', sync);
    window.addEventListener('resize', sync);
    media.addEventListener('change', sync);
    cleanup = () => {
      document.removeEventListener('visibilitychange', sync);
      window.removeEventListener('resize', sync);
      media.removeEventListener('change', sync);
    };
  }
  return () => {
    references = Math.max(0, references - 1);
    if (references === 0 && cleanup) {
      cleanup();
      cleanup = null;
    }
  };
}
