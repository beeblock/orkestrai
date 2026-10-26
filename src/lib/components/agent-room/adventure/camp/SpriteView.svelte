<script lang="ts">
  import { onMount } from 'svelte';
  import { animationFrame, drawFrame, loadAtlas, type Atlas } from '../atlas.js';

  /** An animated sprite (a hero's portrait, a pet), drawn on its feet in a box. */
  let { atlasId, fallbackId = null, animation = 'idle', frames = null, height = 120, width = 120, glow = null }: {
    atlasId: string;
    fallbackId?: string | null;
    animation?: string;
    /** Explicit frame list (pets), instead of a named animation. */
    frames?: number[] | null;
    height?: number;
    width?: number;
    glow?: string | null;
  } = $props();

  let canvas = $state<HTMLCanvasElement | null>(null);
  let atlas: Atlas | null = null;
  // When the sheet arrived: the portrait fades in instead of popping up.
  let shownAt = 0;

  $effect(() => {
    const id = atlasId;
    const fallback = fallbackId;
    atlas = null;
    void loadAtlas(id).then(async (loaded) => {
      if (id !== atlasId) return;
      atlas = loaded ?? (fallback ? await loadAtlas(fallback) : null);
      shownAt = performance.now();
    });
  });

  onMount(() => {
    const context = canvas?.getContext('2d');
    if (!context || !canvas) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    let raf = 0;
    const loop = (now: number) => {
      context.clearRect(0, 0, width, height);
      if (glow) {
        const gradient = context.createRadialGradient(width / 2, height * 0.6, 4, width / 2, height * 0.6, width * 0.45);
        gradient.addColorStop(0, `${glow}55`);
        gradient.addColorStop(1, `${glow}00`);
        context.fillStyle = gradient;
        context.fillRect(0, 0, width, height);
      }
      if (atlas) {
        context.globalAlpha = Math.min(1, (now - shownAt) / 220);
        const tallest = Math.max(...atlas.frames.map((frame) => frame.h));
        const scale = Math.min(1.2, (height * 0.92) / tallest);
        const frame = frames?.length ? frames[Math.floor(now / 130) % frames.length] : animationFrame(atlas, animation, now);
        drawFrame(context, atlas, frame, width / 2, height - 4, scale);
        context.globalAlpha = 1;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  });
</script>

<canvas bind:this={canvas} style:width={`${width}px`} style:height={`${height}px`} aria-hidden="true"></canvas>
