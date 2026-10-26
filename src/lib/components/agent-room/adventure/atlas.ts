/** One frame of an atlas: where it is in the image and the point that stands on the ground. */
export type AtlasFrame = { x: number; y: number; w: number; h: number; ax: number; ay: number };
export type AtlasAnimation = { frames: number[]; fps: number; loop: boolean };
export type Atlas = { id: string; image: HTMLImageElement; height: number; frames: AtlasFrame[]; animations: Record<string, AtlasAnimation> };

// Every sheet ships with the app: its frames are bundled with this code and
// its image is a fingerprinted asset, cached for good after the first load.
const IMAGES = import.meta.glob('$lib/assets/adventure/sprites/*.webp', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const METAS = import.meta.glob('$lib/assets/adventure/sprites/*.json', { eager: true, import: 'default' }) as Record<string, Omit<Atlas, 'image'>>;
const byId = <T>(entries: Record<string, T>) => Object.fromEntries(Object.entries(entries).map(([path, value]) => [path.slice(path.lastIndexOf('/') + 1).replace(/\.(webp|json)$/, ''), value]));
const IMAGE_URLS: Record<string, string> = byId(IMAGES);
const ATLAS_METAS: Record<string, Omit<Atlas, 'image'>> = byId(METAS);

const cache = new Map<string, Promise<Atlas | null>>();

/** Every sheet the app ships. */
export const ATLAS_IDS: string[] = Object.keys(ATLAS_METAS).filter((id) => IMAGE_URLS[id]);

/** Whether a sheet exists (a hero outfit tier, a monster, an icon sheet). */
export function hasAtlas(id: string): boolean {
  return Boolean(ATLAS_METAS[id] && IMAGE_URLS[id]);
}

/** Loads a sheet's image once; null when there is no such sheet. */
export function loadAtlas(id: string): Promise<Atlas | null> {
  let pending = cache.get(id);
  if (!pending) {
    pending = (async () => {
      const meta = ATLAS_METAS[id];
      const url = IMAGE_URLS[id];
      if (!meta || !url) return null;
      try {
        const image = new Image();
        image.decoding = 'async';
        image.src = url;
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

/** Starts loading sheets a screen is about to draw, so they are ready when it does. */
export function preloadAtlases(ids: Iterable<string>): void {
  for (const id of ids) if (hasAtlas(id)) void loadAtlas(id);
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
