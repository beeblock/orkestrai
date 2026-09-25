export type SurfaceRect = { x: number; y: number; width: number; height: number };

// A native View can clip to one rectangle, not punch holes around DOM controls.
// Keep its largest unobstructed area live; the DOM preview fills the remainder.
export function unobstructedPortalRect(rect: SurfaceRect, obstacles: SurfaceRect[]): SurfaceRect {
  let result = rect;
  for (const obstacle of obstacles) {
    const left = Math.max(result.x, obstacle.x), top = Math.max(result.y, obstacle.y);
    const right = Math.min(result.x + result.width, obstacle.x + obstacle.width);
    const bottom = Math.min(result.y + result.height, obstacle.y + obstacle.height);
    if (right <= left || bottom <= top) continue;
    const candidates = [
      { ...result, height: top - result.y },
      { ...result, y: bottom, height: result.y + result.height - bottom },
      { ...result, width: left - result.x },
      { ...result, x: right, width: result.x + result.width - right },
    ];
    result = candidates.reduce((best, candidate) => candidate.width * candidate.height > best.width * best.height ? candidate : best);
  }
  return result;
}
