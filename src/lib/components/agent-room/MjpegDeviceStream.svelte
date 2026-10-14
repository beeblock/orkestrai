<script lang="ts">
  import { createMjpegFrameParser } from './mjpeg-device-stream.js';

  let {
    streamUrl,
    alt,
    style,
    onloaded,
    onerror,
    onpointerdown,
    onpointerup,
    onpointercancel,
  }: {
    streamUrl: string;
    alt: string;
    style?: string;
    onloaded: (width: number, height: number) => void;
    onerror: () => void;
    onpointerdown: (event: PointerEvent) => void;
    onpointerup: (event: PointerEvent) => void;
    onpointercancel: (event: PointerEvent) => void;
  } = $props();

  let canvas = $state<HTMLCanvasElement | null>(null);

  $effect(() => {
    const target = canvas;
    const url = streamUrl;
    if (!target || !url) return;
    const abort = new AbortController();
    const bitmapContext = target.getContext('bitmaprenderer');
    const drawingContext = bitmapContext ? null : target.getContext('2d');
    let latest: Uint8Array | null = null;
    let presenting = false;
    let width = 0;
    let height = 0;

    // Decode only the newest frame. A slow decode drops intermediate frames
    // instead of queueing them behind the live screen.
    const present = async () => {
      presenting = true;
      try {
        while (latest && !abort.signal.aborted) {
          const jpeg = latest;
          latest = null;
          let bitmap: ImageBitmap;
          try {
            bitmap = await createImageBitmap(new Blob([jpeg as Uint8Array<ArrayBuffer>], { type: 'image/jpeg' }));
          } catch {
            continue;
          }
          if (abort.signal.aborted) {
            bitmap.close();
            return;
          }
          if (bitmap.width !== width || bitmap.height !== height) {
            width = bitmap.width;
            height = bitmap.height;
            target.width = width;
            target.height = height;
            onloaded(width, height);
          }
          if (bitmapContext) {
            bitmapContext.transferFromImageBitmap(bitmap);
          } else {
            drawingContext?.drawImage(bitmap, 0, 0);
            bitmap.close();
          }
        }
      } finally {
        presenting = false;
      }
    };

    void (async () => {
      try {
        const response = await fetch(url, { signal: abort.signal, cache: 'no-store' });
        if (!response.ok || !response.body) throw new Error(`Device stream failed with HTTP ${response.status}.`);
        const parser = createMjpegFrameParser(response.headers.get('content-type'));
        const reader = response.body.getReader();
        abort.signal.addEventListener('abort', () => void reader.cancel().catch(() => undefined), { once: true });
        while (!abort.signal.aborted) {
          const { value, done } = await reader.read();
          if (done) break;
          const frames = value ? parser.push(value) : [];
          if (!frames.length) continue;
          latest = frames[frames.length - 1]!;
          if (!presenting) void present();
        }
        if (!abort.signal.aborted) onerror();
      } catch {
        if (!abort.signal.aborted) onerror();
      }
    })();

    return () => {
      abort.abort();
      latest = null;
    };
  });
</script>

<canvas
  bind:this={canvas}
  role="img"
  aria-label={alt}
  class="block max-h-none max-w-none touch-none select-none rounded-[18px] object-contain"
  {style}
  onpointerdown={onpointerdown}
  onpointerup={onpointerup}
  onpointercancel={onpointercancel}
></canvas>
