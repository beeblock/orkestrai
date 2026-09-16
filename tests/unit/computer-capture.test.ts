import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { PNG } from 'pngjs';
const { composeDisplays } = createRequire(import.meta.url)('../../electron/computer-capture.cjs');

describe('Bounded Electron display capture', () => {
  it('composes negative-origin and adjacent displays in the same OS coordinate frame', () => {
    const red = new PNG({ width: 2, height: 2 });
    for (let i = 0; i < red.data.length; i += 4) { red.data[i] = 255; red.data[i + 3] = 255; }
    const items = [-2, 0].map(x => ({ bounds: { x, y: 0, width: 2, height: 2 }, png: PNG.sync.write(red) }));
    const result = composeDisplays(items);
    expect(result).toMatchObject({ width: 4, height: 2 });
    const image = PNG.sync.read(Buffer.from(result.base64, 'base64'));
    expect(image.data.length).toBe(32);
    for (let i = 0; i < image.data.length; i += 4) expect([...image.data.subarray(i, i + 4)]).toEqual([255, 0, 0, 255]);
  });
  it('rejects unbounded geometry and mismatched actual image dimensions', () => {
    expect(() => composeDisplays([])).toThrow();
    const png = PNG.sync.write(new PNG({ width: 1, height: 1 }));
    expect(() => composeDisplays([{ bounds: { x: 0, y: 0, width: 40000, height: 40000 }, png }])).toThrow();
    expect(() => composeDisplays([{ bounds: { x: 0, y: 0, width: 2, height: 2 }, png }])).toThrow();
  });
});
