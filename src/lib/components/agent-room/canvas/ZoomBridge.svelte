<script lang="ts">
  import { useSvelteFlow, useViewport } from '@xyflow/svelte';
  import { createViewportSettler, isCanvasOverview } from './viewport-settle.js';
  import { settleCanvasViewport } from './edge-performance-runtime.svelte.js';

  type ZoomApi = {
    setCenter: (x: number, y: number, options?: { zoom?: number; duration?: number }) => void;
    fitView: (options?: { duration?: number }) => void;
    screenToFlowPosition: (position: { x: number; y: number }) => { x: number; y: number };
    getViewport: () => { x: number; y: number; zoom: number };
  };

  let { onReady }: { onReady: (api: ZoomApi) => void } = $props();

  const { setCenter, fitView, screenToFlowPosition, getViewport } = useSvelteFlow();
  const viewportStore = useViewport();
  let marker: HTMLSpanElement;
  let movingCanvas: HTMLElement | null = null;
  let overviewCanvas: HTMLElement | null = null;
  function motion(moving: boolean) {
    if (moving) {
      movingCanvas = marker?.parentElement?.querySelector<HTMLElement>('.svelte-flow') ?? null;
      // One transition, not hundreds of reactive node updates per frame.
      // Keep small canvases and all focused editors fully painted.
      if (movingCanvas && movingCanvas.querySelectorAll('.svelte-flow__node').length >= 150) {
        movingCanvas.dataset.canvasMoving = 'true';
      }
    } else {
      movingCanvas?.removeAttribute('data-canvas-moving');
      movingCanvas = null;
    }
  }

  // The only live viewport subscriber on the canvas: O(1) per pan/zoom frame.
  // Everything else reads the snapshot published after movement settles.
  const settler = createViewportSettler(viewport => {
    settleCanvasViewport(viewport);
    overviewCanvas = marker?.parentElement?.querySelector<HTMLElement>('.svelte-flow') ?? null;
    if (isCanvasOverview(viewport.zoom)) overviewCanvas?.setAttribute('data-canvas-overview', 'true');
    else overviewCanvas?.removeAttribute('data-canvas-overview');
  }, undefined, motion);
  $effect(() => {
    settler.push(viewportStore.current);
  });
  $effect(() => () => {
    settler.cancel();
    overviewCanvas?.removeAttribute('data-canvas-overview');
  });

  $effect(() => {
    onReady({
      setCenter: (x, y, options) => setCenter(x, y, options),
      fitView: (options) => fitView(options),
      screenToFlowPosition: (position) => screenToFlowPosition(position),
      getViewport: () => getViewport(),
    });
  });
</script>

<span hidden aria-hidden="true" bind:this={marker}></span>
