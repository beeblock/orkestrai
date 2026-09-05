<script lang="ts">
  import type { DesignAsset, DesignElement, DesignPaint } from '$lib/modules/agent-room/contracts/schemas/designSchemas.js';
  import DesignElementShape from './DesignElementShape.svelte';

  let {
    elements,
    assets = [],
    workspaceId = null,
    selectedId = null,
    selectedIds = [],
    hoveredId = null,
    showFrameLabels = false,
  }: {
    elements: DesignElement[];
    assets?: DesignAsset[];
    workspaceId?: string | null;
    selectedId?: string | null;
    selectedIds?: string[];
    hoveredId?: string | null;
    showFrameLabels?: boolean;
  } = $props();

  const ordered = $derived(elements.filter((element) => element.visible).sort((a, b) => a.order - b.order));
  const selectedSet = $derived(new Set(selectedIds.length ? selectedIds : selectedId ? [selectedId] : []));
  const elementMap = $derived(new Map(elements.map((element) => [element.id, element])));

  function fills(element: DesignElement): DesignPaint[] {
    const paints = element.fills.filter((paint) => paint.visible);
    if (paints.length) return paints;
    return element.fill === 'transparent' ? [] : [{ type: 'solid', color: element.fill, opacity: 1, visible: true }];
  }

  function strokes(element: DesignElement): DesignPaint[] {
    const paints = element.strokes.filter((paint) => paint.visible);
    if (paints.length) return paints;
    return element.stroke === 'transparent' || element.strokeWidth <= 0
      ? []
      : [{ type: 'solid', color: element.stroke, opacity: 1, visible: true }];
  }

  function definitionId(element: DesignElement, role: string, index: number): string {
    return `design-${role}-${element.id}-${index}`;
  }

  function paintValue(element: DesignElement, role: string, paint: DesignPaint, index: number): string {
    return paint.type === 'solid' ? paint.color : `url(#${definitionId(element, role, index)})`;
  }

  function gradientVector(angle: number): { x1: number; y1: number; x2: number; y2: number } {
    const radians = angle * Math.PI / 180;
    const dx = Math.cos(radians) / 2;
    const dy = Math.sin(radians) / 2;
    return { x1: 0.5 - dx, y1: 0.5 - dy, x2: 0.5 + dx, y2: 0.5 + dy };
  }

  function assetUrl(element: DesignElement): string | null {
    if (!workspaceId || !element.assetId) return null;
    const asset = assets.find((item) => item.id === element.assetId);
    return asset ? `/api/agent-room/workspaces/${workspaceId}/fs/raw?path=${encodeURIComponent(asset.path)}` : null;
  }

  function clippingId(element: DesignElement): string | null {
    if (element.maskId) return `url(#design-clip-${element.maskId})`;
    const parent = element.parentId ? elementMap.get(element.parentId) : null;
    return parent?.clipContent ? `url(#design-clip-${parent.id})` : null;
  }
</script>

<defs>
  {#each ordered as element (element.id)}
    <clipPath id={`design-clip-${element.id}`} clipPathUnits="userSpaceOnUse">
      <DesignElementShape {element} fill="white" pointerEvents="none" />
    </clipPath>
    {#each [...fills(element), ...strokes(element)] as paint, index (`${element.id}-${index}`)}
      {#if paint.type === 'linear-gradient'}
        {@const vector = gradientVector(paint.angle)}
        <linearGradient id={definitionId(element, index < fills(element).length ? 'fill' : 'stroke', index < fills(element).length ? index : index - fills(element).length)} x1={vector.x1} y1={vector.y1} x2={vector.x2} y2={vector.y2}>
          {#each paint.stops as stop}<stop offset={stop.offset} stop-color={stop.color} stop-opacity={stop.opacity} />{/each}
        </linearGradient>
      {:else if paint.type === 'radial-gradient'}
        <radialGradient id={definitionId(element, index < fills(element).length ? 'fill' : 'stroke', index < fills(element).length ? index : index - fills(element).length)} cx={paint.centerX} cy={paint.centerY} r={paint.radius}>
          {#each paint.stops as stop}<stop offset={stop.offset} stop-color={stop.color} stop-opacity={stop.opacity} />{/each}
        </radialGradient>
      {/if}
    {/each}
    {#if element.effects.some((effect) => effect.visible)}
      <filter id={`design-filter-${element.id}`} x="-100%" y="-100%" width="300%" height="300%" color-interpolation-filters="sRGB">
        {#each element.effects.filter((effect) => effect.visible) as effect}
          {#if effect.type === 'drop-shadow' || effect.type === 'inner-shadow'}
            <feDropShadow dx={effect.x} dy={effect.y} stdDeviation={effect.blur / 2} flood-color={effect.color} />
          {:else}
            <feGaussianBlur stdDeviation={effect.blur / 2} />
          {/if}
        {/each}
      </filter>
    {/if}
  {/each}
</defs>

{#each ordered.filter((element) => !element.isMask) as element (element.id)}
  <g
    data-design-element={element.id}
    opacity={element.opacity}
    transform={`rotate(${element.rotation} ${element.x + element.width / 2} ${element.y + element.height / 2})`}
    clip-path={clippingId(element)}
    filter={element.effects.some((effect) => effect.visible) ? `url(#design-filter-${element.id})` : undefined}
    style={`mix-blend-mode:${element.blendMode}`}
  >
    {#if element.type === 'path'}
      <g data-design-hit>
        <DesignElementShape
          {element}
          fill={element.pathClosed && fills(element).length ? 'transparent' : 'none'}
          stroke="transparent"
          strokeWidth={Math.max(12, element.strokeWidth)}
          pointerEvents={element.pathClosed && fills(element).length ? 'all' : 'stroke'}
        />
      </g>
    {:else if element.type === 'group'}
      <rect data-design-hit x={element.x} y={element.y} width={element.width} height={element.height} fill="transparent" pointer-events="all" />
    {:else}
      <g data-design-hit><DesignElementShape {element} fill="transparent" pointerEvents="all" /></g>
    {/if}
    {#if element.type === 'image'}
      <DesignElementShape {element} fill="transparent" assetUrl={assetUrl(element)} />
    {:else if element.type !== 'group'}
      {#each fills(element) as paint, index}
        <DesignElementShape {element} fill={paintValue(element, 'fill', paint, index)} fillOpacity={paint.opacity} />
      {/each}
    {/if}
    {#if element.type !== 'group'}
      {#each strokes(element) as paint, index}
        <DesignElementShape {element} fill="none" stroke={paintValue(element, 'stroke', paint, index)} strokeOpacity={paint.opacity} strokeWidth={element.strokeWidth || 1} pointerEvents="none" />
      {/each}
    {/if}
    {#if selectedSet.has(element.id)}
      <rect
        data-design-selection
        x={element.x - 2}
        y={element.y - 2}
        width={element.width + 4}
        height={element.height + 4}
        rx={Math.max(0, element.cornerRadius + 2)}
        fill="none"
        stroke="#2563eb"
        stroke-width="2"
        vector-effect="non-scaling-stroke"
        pointer-events="none"
      />
    {:else if hoveredId === element.id}
      <rect
        data-design-hover
        x={element.x - 1}
        y={element.y - 1}
        width={element.width + 2}
        height={element.height + 2}
        rx={Math.max(0, element.cornerRadius + 1)}
        fill="none"
        stroke="#0ea5e9"
        stroke-width="1.25"
        vector-effect="non-scaling-stroke"
        pointer-events="none"
      />
    {/if}
  </g>
{/each}

{#if showFrameLabels}
  <g data-design-ui pointer-events="none">
    {#each ordered.filter((element) => element.type === 'frame') as frame (frame.id)}
      <text
        x={frame.x}
        y={Math.max(13, frame.y - 8)}
        fill="#2563eb"
        stroke={frame.y < 22 ? '#ffffff' : 'none'}
        stroke-width={frame.y < 22 ? 3 : 0}
        paint-order="stroke"
        font-family="Inter Variable, Inter, sans-serif"
        font-size="12"
        font-weight="600"
        transform={`rotate(${frame.rotation} ${frame.x + frame.width / 2} ${frame.y + frame.height / 2})`}
      >{frame.name}</text>
    {/each}
  </g>
{/if}
