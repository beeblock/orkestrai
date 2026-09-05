import { describe, expect, it } from 'vitest';
import { designHexToRgb, designHslToHex, designHsvToHex, designHsvToRgb, designRgbToHex, designRgbToHsl, designRgbToHsv, normalizeDesignHex } from '$lib/modules/agent-room/domain/design-color.js';

describe('Design color conversions', () => {
  it('normalizes hex values and round-trips RGB', () => {
    expect(normalizeDesignHex('  #AbC ')).toBe('#aabbcc');
    expect(normalizeDesignHex('oops')).toBeNull();
    expect(designHexToRgb('#ff7f00')).toEqual({ r: 255, g: 127, b: 0 });
    expect(designRgbToHex({ r: 300, g: -2, b: 127.4 })).toBe('#ff007f');
  });

  it('round-trips representative HSL colors', () => {
    expect(designRgbToHsl({ r: 255, g: 0, b: 0 })).toEqual({ h: 0, s: 100, l: 50 });
    expect(designHslToHex({ h: 120, s: 100, l: 50 })).toBe('#00ff00');
    const source = '#7c5cff';
    expect(designHslToHex(designRgbToHsl(designHexToRgb(source)))).toBe(source);
  });

  it('converts the visual saturation/value plane in both directions', () => {
    expect(designRgbToHsv({ r: 255, g: 0, b: 0 })).toEqual({ h: 0, s: 100, v: 100 });
    expect(designHsvToRgb({ h: 210, s: 50, v: 80 })).toEqual({ r: 102, g: 153, b: 204 });
    expect(designHsvToHex({ h: 210, s: 50, v: 80 })).toBe('#6699cc');
  });
});
