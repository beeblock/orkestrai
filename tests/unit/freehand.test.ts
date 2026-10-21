import { describe, expect, it } from 'vitest';
import { simplifyStroke, strokeToShape } from '../../src/lib/components/agent-room/canvas/freehand.js';

describe('freehand strokes', () => {
  it('keeps corners and drops points along straight runs', () => {
    const line = Array.from({ length: 50 }, (_, i) => ({ x: i, y: 0 }));
    expect(simplifyStroke(line)).toEqual([{ x: 0, y: 0 }, { x: 49, y: 0 }]);
    const corner = [...line, ...Array.from({ length: 50 }, (_, i) => ({ x: 49, y: i + 1 }))];
    expect(simplifyStroke(corner)).toEqual([{ x: 0, y: 0 }, { x: 49, y: 0 }, { x: 49, y: 50 }]);
  });

  it('boxes the stroke with padding and normalizes it inside the box', () => {
    const shape = strokeToShape([{ x: 100, y: 100 }, { x: 150, y: 120 }, { x: 200, y: 100 }], 10);
    expect(shape).toMatchObject({ x: 90, y: 90, width: 120, height: 40 });
    expect(shape!.points[0]).toEqual({ x: 0.0833, y: 0.25 });
    expect(strokeToShape([{ x: 1, y: 1 }])).toBeNull();
  });
});
