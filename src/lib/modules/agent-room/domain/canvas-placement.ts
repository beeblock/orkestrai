export type CanvasPlacementRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type PlacementOptions = {
  gap?: number;
  rowsPerColumn?: number;
  columnDirection?: 1 | -1;
  maxColumns?: number;
};

export function canvasRectsOverlap(left: CanvasPlacementRect, right: CanvasPlacementRect, gap = 0): boolean {
  return left.x < right.x + right.width + gap
    && left.x + left.width + gap > right.x
    && left.y < right.y + right.height + gap
    && left.y + left.height + gap > right.y;
}

/**
 * Finds a stable free slot without moving existing nodes. Rows are filled
 * first so generated results stay visually grouped, then columns expand in
 * the requested direction on the infinite canvas.
 */
export function findFreeCanvasPosition(
  occupied: CanvasPlacementRect[],
  preferred: CanvasPlacementRect,
  options: PlacementOptions = {},
): { x: number; y: number } {
  const gap = Math.max(0, options.gap ?? 48);
  const rowsPerColumn = Math.max(1, Math.trunc(options.rowsPerColumn ?? 4));
  const direction = options.columnDirection ?? 1;
  const maxColumns = Math.max(1, Math.trunc(options.maxColumns ?? 256));
  const stepX = preferred.width + gap;
  const stepY = preferred.height + gap;

  for (let column = 0; column < maxColumns; column += 1) {
    for (let row = 0; row < rowsPerColumn; row += 1) {
      const candidate = {
        x: preferred.x + column * stepX * direction,
        y: preferred.y + row * stepY,
        width: preferred.width,
        height: preferred.height,
      };
      if (!occupied.some((rect) => canvasRectsOverlap(candidate, rect, gap))) {
        return { x: candidate.x, y: candidate.y };
      }
    }
  }

  return {
    x: preferred.x + maxColumns * stepX * direction,
    y: preferred.y,
  };
}
