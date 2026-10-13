import type { FlowViewport } from './edge-performance.js';

/** Pan/zoom quiet time before per-edge work runs again. */
export const VIEWPORT_SETTLE_MS = 150;

/** At overview scale terminal glyphs are unreadable; keep the live PTY, not its paint. */
export function isCanvasOverview(zoom: number): boolean {
  return Number.isFinite(zoom) && zoom > 0 && zoom < 0.2;
}

/**
 * Collapses a stream of viewport frames into one value after movement stops.
 * Panning or zooming emits a frame per animation tick; anything that depends
 * on the viewport (hundreds of edges, graph renderers) must react once, not
 * per frame. Pushing costs O(1); identical frames never re-arm the timer.
 */
export function createViewportSettler(
  onSettle: (viewport: FlowViewport) => void,
  delayMs = VIEWPORT_SETTLE_MS,
  onMotion: (moving: boolean) => void = () => {},
): { push: (viewport: FlowViewport) => void; cancel: () => void } {
  let pending: FlowViewport | null = null;
  let settled: FlowViewport | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let previous: FlowViewport | null = null;
  let moving = false;
  const motion = (next: boolean) => {
    if (moving === next) return;
    moving = next;
    onMotion(next);
  };

  const fire = () => {
    timer = null;
    const next = pending;
    pending = null;
    motion(false);
    if (!next || sameViewport(next, settled)) return;
    settled = next;
    onSettle(next);
  };

  return {
    push(viewport) {
      if (sameViewport(previous, viewport)) return;
      if (previous) motion(true);
      pending = { x: viewport.x, y: viewport.y, zoom: viewport.zoom };
      previous = pending;
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(fire, delayMs);
    },
    cancel() {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      pending = null;
      motion(false);
    },
  };
}

export function sameViewport(a: FlowViewport | null, b: FlowViewport | null): boolean {
  if (!a || !b) return a === b;
  return Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5 && Math.abs(a.zoom - b.zoom) < 0.0005;
}
