import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createViewportSettler, sameViewport, VIEWPORT_SETTLE_MS } from '$lib/components/agent-room/canvas/viewport-settle.js';
import { edgeIntersectsViewport } from '$lib/components/agent-room/canvas/edge-performance.js';

describe('settled canvas viewport', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('publishes once after a pan stops, never per frame', () => {
    const settled = vi.fn();
    const settler = createViewportSettler(settled);
    // 120 animation frames of a continuous pan and zoom-out.
    for (let frame = 0; frame < 120; frame += 1) {
      settler.push({ x: frame * 8, y: frame * 3, zoom: 1 - frame * 0.005 });
      vi.advanceTimersByTime(16);
    }
    expect(settled).not.toHaveBeenCalled();
    vi.advanceTimersByTime(VIEWPORT_SETTLE_MS);
    expect(settled).toHaveBeenCalledTimes(1);
    expect(settled).toHaveBeenCalledWith({ x: 119 * 8, y: 119 * 3, zoom: 1 - 119 * 0.005 });
  });

  it('ignores frames that do not move the viewport and stops on cancel', () => {
    const settled = vi.fn();
    const settler = createViewportSettler(settled);
    settler.push({ x: 10, y: 10, zoom: 1 });
    vi.advanceTimersByTime(VIEWPORT_SETTLE_MS);
    settler.push({ x: 10.1, y: 10, zoom: 1 });
    vi.advanceTimersByTime(VIEWPORT_SETTLE_MS);
    expect(settled).toHaveBeenCalledTimes(1);
    settler.push({ x: 400, y: 10, zoom: 1 });
    settler.cancel();
    vi.advanceTimersByTime(VIEWPORT_SETTLE_MS);
    expect(settled).toHaveBeenCalledTimes(1);
  });

  it('decides edge visibility from the settled snapshot', () => {
    const anchors = { ax: 0, ay: 0, bx: 100, by: 0 };
    expect(edgeIntersectsViewport(anchors, { x: 0, y: 0, zoom: 1 }, 1200, 800)).toBe(true);
    expect(edgeIntersectsViewport(anchors, { x: -5_000, y: 0, zoom: 1 }, 1200, 800)).toBe(false);
    expect(sameViewport(null, null)).toBe(true);
    expect(sameViewport({ x: 0, y: 0, zoom: 1 }, null)).toBe(false);
  });
});
