export type StrokePoint = { x: number; y: number };

function distanceToSegment(point: StrokePoint, start: StrokePoint, end: StrokePoint): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = dx * dx + dy * dy;
  if (!length) return Math.hypot(point.x - start.x, point.y - start.y);
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / length));
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
}

/** Drops points that do not change the stroke by more than `epsilon` (Ramer–Douglas–Peucker). */
export function simplifyStroke(points: readonly StrokePoint[], epsilon = 1.5): StrokePoint[] {
  if (points.length <= 2) return [...points];
  let index = 0;
  let farthest = 0;
  for (let i = 1; i < points.length - 1; i += 1) {
    const distance = distanceToSegment(points[i], points[0], points[points.length - 1]);
    if (distance > farthest) {
      farthest = distance;
      index = i;
    }
  }
  if (farthest <= epsilon) return [points[0], points[points.length - 1]];
  const left = simplifyStroke(points.slice(0, index + 1), epsilon);
  const right = simplifyStroke(points.slice(index), epsilon);
  return [...left.slice(0, -1), ...right];
}

/**
 * The node box around a stroke (with room for the line width) and the stroke
 * normalized to 0..1 inside it, the same convention arrows use.
 */
export function strokeToShape(points: readonly StrokePoint[], padding = 8, maxPoints = 400): {
  x: number; y: number; width: number; height: number; points: StrokePoint[];
} | null {
  const simplified = simplifyStroke(points).slice(0, maxPoints);
  if (simplified.length < 2) return null;
  const xs = simplified.map((point) => point.x);
  const ys = simplified.map((point) => point.y);
  const x = Math.min(...xs) - padding;
  const y = Math.min(...ys) - padding;
  const width = Math.max(24, Math.max(...xs) + padding - x);
  const height = Math.max(24, Math.max(...ys) + padding - y);
  return {
    x, y, width, height,
    points: simplified.map((point) => ({
      x: Math.round(((point.x - x) / width) * 10_000) / 10_000,
      y: Math.round(((point.y - y) / height) * 10_000) / 10_000,
    })),
  };
}
