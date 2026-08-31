import { describe, expect, it } from 'vitest';
import { canvasRectsOverlap, findFreeCanvasPosition } from '$lib/modules/agent-room/domain/canvas-placement.js';

describe('canvas placement', () => {
  it('keeps the preferred position when it is free', () => {
    expect(findFreeCanvasPosition([{ x: 0, y: 0, width: 100, height: 100 }], {
      x: 300, y: 0, width: 100, height: 100,
    })).toEqual({ x: 300, y: 0 });
  });

  it('fills rows and then moves to the next column without overlap', () => {
    const occupied = [
      { x: 200, y: 100, width: 100, height: 80 },
      { x: 200, y: 204, width: 100, height: 80 },
    ];
    const position = findFreeCanvasPosition(occupied, { x: 200, y: 100, width: 100, height: 80 }, {
      gap: 24,
      rowsPerColumn: 2,
    });
    expect(position).toEqual({ x: 324, y: 100 });
    expect(occupied.some((rect) => canvasRectsOverlap({ ...position, width: 100, height: 80 }, rect, 24))).toBe(false);
  });

  it('can expand reference nodes to the left', () => {
    const position = findFreeCanvasPosition(
      [{ x: 100, y: 100, width: 80, height: 80 }],
      { x: 100, y: 100, width: 80, height: 80 },
      { gap: 20, rowsPerColumn: 1, columnDirection: -1 },
    );
    expect(position).toEqual({ x: 0, y: 100 });
  });
});
