import { describe, expect, it, vi } from 'vitest';
import { canCacheImageOverview, imageOverviewSize, paintImageOverview } from '$lib/components/agent-room/canvas/image-overview-preview.js';

describe('bounded display-only image overview', () => {
  it('keeps vector, known animated and unrecognized formats on their original renderer', () => {
    for (const path of ['asset.png', 'photo.JPG', 'photo.jpeg', 'bitmap.bmp']) expect(canCacheImageOverview(path)).toBe(true);
    for (const path of ['animation.gif', 'animation.apng', 'animation.webp', 'vector.svg', 'unknown.bin', undefined]) expect(canCacheImageOverview(path)).toBe(false);
  });
  it('bounds bitmap pixels, preserves aspect ratio and never enlarges small images', () => {
    expect(imageOverviewSize(1024, 1024)).toEqual({ width: 256, height: 256 });
    expect(imageOverviewSize(8192, 4096)).toEqual({ width: 256, height: 128 });
    expect(imageOverviewSize(4096, 8192)).toEqual({ width: 128, height: 256 });
    expect(imageOverviewSize(64, 32)).toEqual({ width: 64, height: 32 });
  });
  it('refuses unavailable or invalid dimensions', () => {
    for (const value of [0, -1, NaN, Infinity]) {
      expect(imageOverviewSize(value, 1024)).toBeNull();
      expect(imageOverviewSize(1024, value)).toBeNull();
    }
  });
  it('uses a bounded browser bitmap without changing the original image', () => {
    const image = { complete: true, naturalWidth: 8192, naturalHeight: 4096, src: 'unchanged.png' } as HTMLImageElement;
    const drawImage = vi.fn();
    const canvas = { width: 0, height: 0, getContext: vi.fn(() => ({ drawImage })) } as unknown as HTMLCanvasElement;
    expect(paintImageOverview(image, canvas)).toBe(true);
    expect(canvas.width).toBe(256); expect(canvas.height).toBe(128);
    expect(drawImage).toHaveBeenCalledExactlyOnceWith(image, 0, 0, 256, 128);
    expect(image.src).toBe('unchanged.png');
    expect(image.naturalWidth).toBe(8192);
  });
  it('falls back to the original for incomplete images, absent contexts or drawing failures', () => {
    const image = { complete: false, naturalWidth: 1024, naturalHeight: 1024 } as HTMLImageElement;
    const drawImage = vi.fn(() => { throw new Error('Unavailable bitmap'); });
    const canvas = { getContext: vi.fn(() => ({ drawImage })) } as unknown as HTMLCanvasElement;
    expect(paintImageOverview(image, canvas)).toBe(false);
    expect(canvas.getContext).not.toHaveBeenCalled();
    Object.assign(image, { complete: true });
    expect(paintImageOverview(image, canvas)).toBe(false);
    canvas.getContext = vi.fn(() => null);
    expect(paintImageOverview(image, canvas)).toBe(false);
  });
});
