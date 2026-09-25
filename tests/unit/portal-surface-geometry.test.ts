import { describe, expect, it } from 'vitest';
import { unobstructedPortalRect } from '$lib/components/agent-room/portal-surface-geometry.js';

describe('native Portal clipping around Canvas controls', () => {
  const page = { x: 100, y: 100, width: 800, height: 600 };
  it('keeps the native website above a partially overlapping bottom toolbar', () => {
    expect(unobstructedPortalRect(page, [{ x: 300, y: 620, width: 400, height: 60 }])).toEqual({ ...page, height: 520 });
  });
  it('clips against multiple controls without expanding outside the original page', () => {
    expect(unobstructedPortalRect(page, [
      { x: 300, y: 620, width: 400, height: 60 },
      { x: 100, y: 100, width: 180, height: 550 },
    ])).toEqual({ x: 280, y: 100, width: 620, height: 520 });
    expect(unobstructedPortalRect(page, [{ x: 0, y: 0, width: 100, height: 100 }])).toEqual(page);
    const covered = unobstructedPortalRect(page, [{ x: 0, y: 0, width: 2000, height: 2000 }]);
    expect(covered.width * covered.height).toBe(0);
  });
});
