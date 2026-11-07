<script lang="ts">
  import { imagePreviewPool, observeImageVisibility, previewEdge } from './image-preview-pool.js';
  import { canvasEdgeRuntime } from './edge-performance-runtime.svelte.js';
  let { src, alt, selected = false, animated = false, layoutWidth = 320, layoutHeight = 240 }: {
    src: string; alt: string; selected?: boolean; animated?: boolean; layoutWidth?: number; layoutHeight?: number;
  } = $props();
  let surface = $state<HTMLCanvasElement>();
  let visible = $state(false);
  let ready = $state(false);
  let playing = $state(false);
  const animationOwner = {};
  $effect(() => { if (surface) return observeImageVisibility(surface, value => { visible = value; }); });
  $effect(() => {
    const canvas = surface, zoom = canvasEdgeRuntime.current.viewport?.zoom ?? 1;
    const active = visible && canvasEdgeRuntime.current.documentVisible;
    const animate = selected && animated;
    if (!canvas) return;
    const discard = () => { if (canvas.width !== 1) canvas.width = 1; if (canvas.height !== 1) canvas.height = 1; ready = false; };
    discard();
    if (!active) return;
    // XYFlow already owns the layout dimensions. Reading clientWidth after
    // clearing each canvas caused thousands of synchronous layout flushes.
    const edge = previewEdge(Math.max(layoutWidth, layoutHeight) * zoom, window.devicePixelRatio, selected);
    if (!edge) return;
    const lease = imagePreviewPool.acquire(src, edge);
    let current = true;
    void lease.promise.then(bitmap => {
      if (!current || !imagePreviewPool.reserveSurface(canvas, bitmap.width, bitmap.height, discard)) return;
      const context = canvas.getContext('2d', { willReadFrequently: true }); if (!context || !bitmap.pixels) return;
      canvas.width = bitmap.width; canvas.height = bitmap.height;
      context.putImageData(bitmap.pixels, 0, 0); ready = true;
      if (animate && bitmap.sourceWidth && bitmap.sourceHeight) {
        playing = imagePreviewPool.reserveAnimation(animationOwner, bitmap.sourceWidth, bitmap.sourceHeight,
          () => { playing = false; imagePreviewPool.releaseAnimation(animationOwner); });
      }
    }).catch(() => {}).finally(lease.release);
    return () => { current = false; lease.release(); imagePreviewPool.releaseSurface(canvas);
      imagePreviewPool.releaseAnimation(animationOwner); playing = false; discard(); };
  });
</script>

<canvas bind:this={surface} class:ready width="1" height="1" aria-label={alt} data-image-preview={src}>{alt}</canvas>
{#if playing}<img {src} {alt} draggable="false" decoding="async" />{/if}

<style>
  canvas, img { position: absolute; inset: 0; width: 100%; height: 100%; min-width: 0; min-height: 0; object-fit: contain; }
  canvas { opacity: 0; }
  canvas.ready { opacity: 1; }
</style>
