<script lang="ts">
  import { useSvelteFlow, useViewport } from '@xyflow/svelte';
  import { createViewportSettler } from './viewport-settle.js';
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

  // The only live viewport subscriber on the canvas: O(1) per pan/zoom frame.
  // Everything else reads the snapshot published after movement settles.
  const settler = createViewportSettler(settleCanvasViewport);
  $effect(() => {
    settler.push(viewportStore.current);
  });
  $effect(() => () => settler.cancel());

  $effect(() => {
    onReady({
      setCenter: (x, y, options) => setCenter(x, y, options),
      fitView: (options) => fitView(options),
      screenToFlowPosition: (position) => screenToFlowPosition(position),
      getViewport: () => getViewport(),
    });
  });
</script>
