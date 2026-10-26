/** One frame of an atlas: where it is in the image and the point that stands on the ground. */
export type AtlasFrame = { x: number; y: number; w: number; h: number; ax: number; ay: number };
export type AtlasAnimation = { frames: number[]; fps: number; loop: boolean };
export type Atlas = { id: string; image: HTMLImageElement; height: number; frames: AtlasFrame[]; animations: Record<string, AtlasAnimation> };

const cache = new Map<string, Promise<Atlas | null>>();

/** Loads `/adventure/sprites/<id>.{json,webp}` once; null when the sprite is missing. */
export function loadAtlas(id: string): Promise<Atlas | null> {
  let pending = cache.get(id);
  if (!pending) {
    pending = (async () => {
      try {
        const response = await fetch(`/adventure/sprites/${id}.json`);
        if (!response.ok) return null;
        const meta = await response.json() as Omit<Atlas, 'image'>;
        const image = new Image();
        image.decoding = 'async';
        image.src = `/adventure/sprites/${id}.webp`;
        await image.decode();
        return { ...meta, image };
      } catch {
        return null;
      }
    })();
    cache.set(id, pending);
  }
  return pending;
}

/** The frame an animation shows `elapsedMs` after it started. */
export function animationFrame(atlas: Atlas, name: string, elapsedMs: number, fallback = 'idle'): number {
  const animation = atlas.animations[name] ?? atlas.animations[fallback] ?? Object.values(atlas.animations)[0];
  if (!animation?.frames.length) return 0;
  const step = Math.floor((elapsedMs / 1000) * animation.fps);
  const index = animation.loop ? step % animation.frames.length : Math.min(step, animation.frames.length - 1);
  return animation.frames[index];
}

/**
 * Draws a frame standing on (x, y). `scale` maps atlas pixels to canvas pixels;
 * `flip` mirrors it around its anchor (a monster drawn facing left that walks right).
 */
export function drawFrame(context: CanvasRenderingContext2D, atlas: Atlas, frameIndex: number, x: number, y: number, scale: number, flip = false): { left: number; top: number; width: number; height: number } {
  const frame = atlas.frames[frameIndex] ?? atlas.frames[0];
  const width = frame.w * scale;
  const height = frame.h * scale;
  const left = flip ? x - (frame.w - frame.ax) * scale : x - frame.ax * scale;
  const top = y - frame.ay * scale;
  if (flip) {
    context.save();
    context.translate(left + width, top);
    context.scale(-1, 1);
    context.drawImage(atlas.image, frame.x, frame.y, frame.w, frame.h, 0, 0, width, height);
    context.restore();
  } else {
    context.drawImage(atlas.image, frame.x, frame.y, frame.w, frame.h, left, top, width, height);
  }
  return { left, top, width, height };
}
