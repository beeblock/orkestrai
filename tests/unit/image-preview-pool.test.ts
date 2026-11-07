import { afterEach, describe, expect, it, vi } from 'vitest';
import { ImagePreviewPool, previewEdge } from '$lib/components/agent-room/canvas/image-preview-pool.ts';

describe('bounded image gallery resources', () => {
  afterEach(() => vi.useRealTimers());
  it('sizes previews by displayed pixels, suppresses subpixel work and caps large/selected images', () => {
    expect(previewEdge(7)).toBe(0); expect(previewEdge(30)).toBe(32);
    expect(previewEdge(120, 2)).toBe(256); expect(previewEdge(10000, 3)).toBe(1024);
    expect(previewEdge(10000, 3, true)).toBe(2048);
  });

  it.each([300, 3000])('keeps %i queued images at two simultaneous decodes and cancels offscreen work', async count => {
    vi.useFakeTimers();
    const pending: Array<(bitmap: any) => void> = [];
    const loader = vi.fn(() => new Promise<any>(resolve => pending.push(resolve)));
    const pool = new ImagePreviewPool(loader);
    const leases = Array.from({ length: count }, (_, index) => pool.acquire(`image-${index}`, 32));
    await vi.advanceTimersByTimeAsync(1);
    expect(loader).toHaveBeenCalledTimes(2); expect(pool.stats.running).toBe(2);
    for (const lease of leases) lease.release();
    expect(pool.stats.queued).toBe(0);
    const bitmaps = pending.map(() => ({ width: 32, height: 32, close: vi.fn() }));
    pending.forEach((resolve, index) => resolve(bitmaps[index]));
    await vi.advanceTimersByTimeAsync(1);
    expect(bitmaps.every(bitmap => bitmap.close.mock.calls.length === 1)).toBe(true);
    expect(pool.stats).toEqual({ running: 0, queued: 0, cachePixels: 0, surfacePixels: 0 });
  });

  it('coalesces duplicate sources, retains active leases and closes evicted bitmaps', async () => {
    vi.useFakeTimers();
    const bitmaps: any[] = [];
    const loader = vi.fn(async () => { const bitmap = { width: 32, height: 32, close: vi.fn() }; bitmaps.push(bitmap); return bitmap; });
    const pool = new ImagePreviewPool(loader, 1024);
    const a = pool.acquire('same', 32), duplicate = pool.acquire('same', 32);
    await vi.advanceTimersByTimeAsync(2); expect(await a.promise).toBe(await duplicate.promise);
    const b = pool.acquire('different', 32); await vi.advanceTimersByTimeAsync(2); await b.promise;
    a.release(); b.release(); expect(bitmaps[0].close).not.toHaveBeenCalled();
    duplicate.release(); expect(pool.stats.cachePixels).toBeLessThanOrEqual(1024);
    expect(bitmaps.some(bitmap => bitmap.close.mock.calls.length === 1)).toBe(true);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('never retains more than the destination pixel budget, even with 3000 overlapping nodes', () => {
    const pool = new ImagePreviewPool(undefined, 1024, 4096);
    const discards = Array.from({ length: 3000 }, () => vi.fn());
    for (const discard of discards) {
      expect(pool.reserveSurface({}, 32, 32, discard)).toBe(true);
      expect(pool.stats.surfacePixels).toBeLessThanOrEqual(4096);
    }
    expect(discards.filter(discard => discard.mock.calls.length === 1)).toHaveLength(2996);
    expect(pool.reserveSurface({}, 65, 65, vi.fn())).toBe(false);
  });

  it('allows the same source to be requested again while its cancelled decode finishes', async () => {
    vi.useFakeTimers();
    const complete: Array<(bitmap: any) => void> = [];
    const pool = new ImagePreviewPool(() => new Promise<any>(resolve => complete.push(resolve)));
    const old = pool.acquire('replaced', 32); await vi.advanceTimersByTimeAsync(1); old.release();
    const next = pool.acquire('replaced', 32); await vi.advanceTimersByTimeAsync(1);
    const stale = { width: 32, height: 32, close: vi.fn() }, fresh = { width: 32, height: 32, close: vi.fn() };
    complete[0](stale); complete[1](fresh); await vi.advanceTimersByTimeAsync(1);
    expect(await next.promise).toBe(fresh); expect(stale.close).toHaveBeenCalledOnce();
    expect(fresh.close).not.toHaveBeenCalled(); next.release();
  });

  it('bounds selected native animations and returns their reservation on disposal', () => {
    const pool = new ImagePreviewPool(undefined, 1024, 4096);
    const a = {}, b = {}, c = {};
    expect(pool.reserveAnimation(a, 32, 32, vi.fn())).toBe(true);
    expect(pool.reserveAnimation(b, 32, 32, vi.fn())).toBe(true);
    expect(pool.reserveAnimation(c, 32, 32, vi.fn())).toBe(false);
    pool.releaseAnimation(a);
    expect(pool.reserveAnimation(c, 32, 32, vi.fn())).toBe(true);
    pool.releaseAnimation(b); pool.releaseAnimation(c); expect(pool.stats.surfacePixels).toBe(0);
  });
});
