import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { constrainMove, normalizeLayout, placementOf, stripBounds, COMPACT_WIDTH } = require('../../electron/adventure-window.cjs') as {
  constrainMove: (bounds: Bounds, workArea: Bounds, layout: Layout) => Bounds;
  normalizeLayout: (input: unknown) => Layout;
  placementOf: (bounds: Bounds, display: { id: number; workArea: Bounds }) => { displayId: number; left: number; bottom: number };
  stripBounds: (workArea: Bounds, layout: Layout, saved: { left: number; bottom: number } | null) => Bounds;
  COMPACT_WIDTH: number;
};
type Bounds = { x: number; y: number; width: number; height: number };
type Layout = { width: 'full' | 'compact'; height: number };

const area: Bounds = { x: 0, y: 25, width: 1440, height: 800 };

describe('adventure strip window placement', () => {
  it('sits on the Dock at full width by default and keeps a sane height', () => {
    expect(stripBounds(area, normalizeLayout(null), null)).toEqual({ x: 0, y: 25 + 800 - 320, width: 1440, height: 320 });
    expect(normalizeLayout({ width: 'compact', height: 9_999 })).toEqual({ width: 'compact', height: 480 });
    expect(normalizeLayout({ width: 'weird', height: Number.NaN })).toEqual({ width: 'full', height: 320 });
  });

  it('remembers where it was left, relative to the work area, and stays on screen', () => {
    const layout = normalizeLayout({ width: 'compact', height: 320 });
    expect(stripBounds(area, layout, null)).toEqual({ x: (1440 - COMPACT_WIDTH) / 2, y: 505, width: COMPACT_WIDTH, height: 320 });
    const saved = placementOf({ x: 100, y: 300, width: COMPACT_WIDTH, height: 320 }, { id: 7, workArea: area });
    expect(saved).toEqual({ displayId: 7, left: 100, bottom: 205 });
    expect(stripBounds(area, layout, saved)).toEqual({ x: 100, y: 300, width: COMPACT_WIDTH, height: 320 });
    // A smaller display later: still fully visible.
    expect(stripBounds({ x: 0, y: 0, width: 800, height: 400 }, layout, { left: 700, bottom: 300 })).toEqual({ x: 40, y: 0, width: COMPACT_WIDTH, height: 320 });
  });

  it('drags full width only up and down, and compact anywhere on the display', () => {
    const full = normalizeLayout({ width: 'full', height: 320 });
    expect(constrainMove({ x: 300, y: 200, width: 1440, height: 320 }, area, full)).toEqual({ x: 0, y: 200, width: 1440, height: 320 });
    expect(constrainMove({ x: 0, y: -50, width: 1440, height: 320 }, area, full).y).toBe(25);
    const compact = normalizeLayout({ width: 'compact', height: 320 });
    expect(constrainMove({ x: 2_000, y: 900, width: COMPACT_WIDTH, height: 320 }, area, compact)).toEqual({ x: 1440 - COMPACT_WIDTH, y: 505, width: COMPACT_WIDTH, height: 320 });
  });
});
