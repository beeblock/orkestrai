import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
const require = createRequire(import.meta.url);
const { portalPresentation, validPortalGeometry } = require('../../electron/portal-presentation.cjs');

const geometry = { bounds: { x: 100, y: 100, width: 400, height: 300 },
  clip: { x: 150, y: 150, width: 250, height: 200 }, viewport: { width: 800, height: 600 }, zoom: 0.5, visible: true };

describe('Portal presentation contract', () => {
  it('crops without resizing CSS viewport or changing screen density', () => {
    expect(portalPresentation(geometry)).toEqual({ frame: geometry.clip, previewOnly: true, metrics: {
      width: 800, height: 600, deviceScaleFactor: 0, mobile: false, scale: 0.5, dontSetVisibleSize: true,
    } });
  });
  it('keeps right and bottom clipping live without a screenshot-only viewport override', () => {
    expect(portalPresentation({ ...geometry, clip: { x: 100, y: 100, width: 250, height: 200 } }).previewOnly).toBe(false);
  });
  it('intersects the native frame even when a caller supplies an oversized clip', () => {
    expect(portalPresentation({ ...geometry, clip: { x: 0, y: 0, width: 9999, height: 9999 } }).frame).toEqual(geometry.bounds);
  });
  it('accepts the entire Canvas zoom range and validates bounded logical dimensions', () => {
    expect(validPortalGeometry(geometry)).toBe(true);
    expect(validPortalGeometry({ ...geometry, zoom: 0.05 })).toBe(true);
    for (const zoom of [NaN, Infinity, 0, 0.01, 6]) expect(validPortalGeometry({ ...geometry, zoom })).toBe(false);
    for (const viewport of [null, { width: 0, height: 600 }, { width: 999999, height: 600 }, { width: 1.5, height: 600 }]) {
      expect(validPortalGeometry({ ...geometry, viewport })).toBeFalsy();
    }
  });
});
