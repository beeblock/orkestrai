/** A workspace may have thousands of originals; it must never decode them all
 * concurrently or retain their full-resolution pixels in hidden <img> tags. */
export const PREVIEW_CONCURRENCY = 2;
export const PREVIEW_CACHE_PIXELS = 8 * 1024 * 1024;
export const PREVIEW_SURFACE_PIXELS = 16 * 1024 * 1024;
const MAX_SOURCE_BYTES = 64 * 1024 * 1024;
export interface PreviewBitmap { width: number; height: number; sourceWidth?: number; sourceHeight?: number; pixels?: ImageData; close(): void }
type Entry = { key: string; url: string; edge: number; controller: AbortController; refs: number;
  bitmap?: PreviewBitmap; started: boolean; resolve: (bitmap: PreviewBitmap) => void; reject: (error: unknown) => void; promise: Promise<PreviewBitmap> };

export function previewEdge(screenEdge: number, devicePixelRatio = 1, selected = false): number {
  if (!Number.isFinite(screenEdge) || screenEdge < 8) return 0;
  const pixels = screenEdge * Math.min(2, Math.max(1, devicePixelRatio || 1));
  return Math.min(selected ? 2048 : 1024, Math.max(32, 2 ** Math.ceil(Math.log2(pixels))));
}

/** Decode on Chromium's image worker, rasterize down, and explicitly release
 * the full-size bitmap. No base64 copy, data URL or retained original element. */
async function loadPreview(url: string, edge: number, signal: AbortSignal): Promise<PreviewBitmap> {
  const response = await fetch(url, { signal, cache: 'no-store' });
  if (!response.ok) throw new Error('Image preview unavailable');
  if (Number(response.headers.get('content-length')) > MAX_SOURCE_BYTES) {
    await response.body?.cancel(); throw new Error('Image preview source too large');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Image preview unavailable');
  const chunks: Uint8Array<ArrayBuffer>[] = []; let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_SOURCE_BYTES) throw new Error('Image preview source too large');
      chunks.push(value);
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  const blob = new Blob(chunks, {
    type: response.headers.get('content-type')?.split(';')[0] ?? '',
  });
  // Chromium cannot create ImageBitmap directly from an SVG Blob. Decode the
  // vector with the native image loader, rasterize only the requested size,
  // and release its private object URL before completing the job.
  const vector = blob.type === 'image/svg+xml' ? new Image() : undefined;
  const objectUrl = vector ? URL.createObjectURL(blob) : undefined;
  const discardVector = () => { if (vector) vector.src = ''; };
  let original: ImageBitmap | HTMLImageElement | undefined;
  try {
    if (vector && objectUrl) {
      signal.addEventListener('abort', discardVector, { once: true });
      vector.src = objectUrl;
      await vector.decode(); original = vector;
    } else original = await createImageBitmap(blob);
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    const sourceWidth = vector ? vector.naturalWidth : original.width;
    const sourceHeight = vector ? vector.naturalHeight : original.height;
    const fit = edge / Math.max(sourceWidth, sourceHeight);
    const ratio = vector ? fit : Math.min(1, fit);
    const width = Math.max(1, Math.round(sourceWidth * ratio)), height = Math.max(1, Math.round(sourceHeight * ratio));
    const surface = new OffscreenCanvas(width, height);
    const context = surface.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Image preview unavailable');
    try {
      context.drawImage(original, 0, 0, width, height);
      // Materialize the small pixels: a resized ImageBitmap may keep a deferred
      // reference to the full-size image. The cache owns only this exact array.
      return { width, height, sourceWidth, sourceHeight,
        pixels: context.getImageData(0, 0, width, height), close() { this.pixels = undefined; } };
    } finally { surface.width = 1; surface.height = 1; }
  } finally {
    if (!vector) (original as ImageBitmap | undefined)?.close();
    signal.removeEventListener('abort', discardVector); discardVector();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}

export class ImagePreviewPool {
  private entries = new Map<string, Entry>();
  private queue: Entry[] = [];
  private queueHead = 0;
  private queued = 0;
  private running = 0;
  private cacheUsage = 0;
  private surfaceUsage = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private surfaces = new Map<object, { pixels: number; discard: () => void }>();
  private animations = new Map<object, () => void>();
  constructor(private loader = loadPreview, private cachePixels = PREVIEW_CACHE_PIXELS, private surfacePixels = PREVIEW_SURFACE_PIXELS) {}

  acquire(url: string, edge: number) {
    const key = JSON.stringify([url, edge]);
    let entry = this.entries.get(key);
    if (!entry) {
      let resolve!: Entry['resolve'], reject!: Entry['reject'];
      const promise = new Promise<PreviewBitmap>((yes, no) => { resolve = yes; reject = no; });
      entry = { key, url, edge, controller: new AbortController(), refs: 0, started: false, resolve, reject, promise };
      // Cancellation may happen before a component attaches its error handler.
      void promise.catch(() => {});
      this.entries.set(key, entry); this.queue.push(entry); this.queued++;
    } else { this.entries.delete(key); this.entries.set(key, entry); }
    entry.refs++; this.schedule();
    let released = false;
    return { promise: entry.promise, release: () => {
      if (released) return; released = true; entry!.refs--;
      if (!entry!.refs && !entry!.bitmap) {
        entry!.controller.abort(); entry!.reject(new DOMException('Aborted', 'AbortError'));
        if (this.entries.get(key) === entry) this.entries.delete(key);
        if (!entry!.started) this.queued--;
      }
      this.trim();
    } };
  }

  /** Canvas backing stores are budgeted too, including overlapping visible nodes. */
  reserveSurface(owner: object, width: number, height: number, discard: () => void): boolean {
    const pixels = width * height;
    if (!Number.isFinite(pixels) || pixels <= 0 || pixels > this.surfacePixels) return false;
    this.releaseSurface(owner);
    while (this.surfaceUsage + pixels > this.surfacePixels) {
      const [key, item] = this.surfaces.entries().next().value!;
      this.surfaces.delete(key); this.surfaceUsage -= item.pixels; item.discard();
    }
    this.surfaces.set(owner, { pixels, discard }); this.surfaceUsage += pixels; return true;
  }
  releaseSurface(owner: object): void {
    const previous = this.surfaces.get(owner);
    if (previous) { this.surfaces.delete(owner); this.surfaceUsage -= previous.pixels; }
  }
  reserveAnimation(owner: object, width: number, height: number, discard: () => void): boolean {
    if (this.animations.size >= 2 || !this.reserveSurface(owner, width, height, discard)) return false;
    this.animations.set(owner, discard); return true;
  }
  releaseAnimation(owner: object): void { this.animations.delete(owner); this.releaseSurface(owner); }
  get stats() { return { running: this.running, queued: this.queued, cachePixels: this.cacheUsage, surfacePixels: this.surfaceUsage }; }

  private schedule(): void {
    if (this.timer !== undefined) return;
    // Yield between decodes: a large gallery must not monopolize input/painting.
    this.timer = setTimeout(() => {
      this.timer = undefined;
      while (this.running < PREVIEW_CONCURRENCY && this.queueHead < this.queue.length) {
        const entry = this.queue[this.queueHead++];
        if (entry.controller.signal.aborted) continue;
        entry.started = true; this.queued--; this.running++;
        void this.loader(entry.url, entry.edge, entry.controller.signal).then(bitmap => {
          if (entry.controller.signal.aborted) { bitmap.close(); return; }
          entry.bitmap = bitmap; this.cacheUsage += bitmap.width * bitmap.height; entry.resolve(bitmap);
        }, error => { entry.reject(error); if (this.entries.get(entry.key) === entry) this.entries.delete(entry.key); })
          .finally(() => { this.running--; this.trim(); this.schedule(); });
      }
      if (this.queueHead >= 512 || this.queueHead === this.queue.length) { this.queue = this.queue.slice(this.queueHead); this.queueHead = 0; }
    }, 0);
  }
  private trim(): void {
    if (this.cacheUsage <= this.cachePixels) return;
    for (const [key, entry] of this.entries) {
      if (this.cacheUsage <= this.cachePixels) break;
      if (!entry.refs && entry.bitmap) {
        this.cacheUsage -= entry.bitmap.width * entry.bitmap.height; entry.bitmap.close(); this.entries.delete(key);
      }
    }
  }
}

export const imagePreviewPool = new ImagePreviewPool();

/** One observer for the gallery. Coalesce visibility churn while panning. */
const targets = new Map<Element, { callback: (visible: boolean) => void; visible: boolean }>();
let observer: IntersectionObserver | undefined;
let visibilityTimer: ReturnType<typeof setTimeout> | undefined;
export function observeImageVisibility(element: Element, callback: (visible: boolean) => void): () => void {
  observer ??= new IntersectionObserver(entries => {
    for (const entry of entries) { const target = targets.get(entry.target); if (target) target.visible = entry.isIntersecting && entry.intersectionRect.width > 0 && entry.intersectionRect.height > 0; }
    clearTimeout(visibilityTimer);
    visibilityTimer = setTimeout(() => { for (const target of targets.values()) target.callback(target.visible); }, 150);
  }, { rootMargin: '100px' });
  targets.set(element, { callback, visible: false }); observer.observe(element);
  return () => {
    observer?.unobserve(element); targets.delete(element);
    if (!targets.size) { observer?.disconnect(); observer = undefined; clearTimeout(visibilityTimer); }
  };
}
