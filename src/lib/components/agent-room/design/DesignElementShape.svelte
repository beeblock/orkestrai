<script lang="ts">
  import type { DesignElement } from '$lib/modules/agent-room/contracts/schemas/designSchemas.js';
  import { designPathData, designTextLayoutLines } from '$lib/modules/agent-room/domain/design-geometry.js';

  let {
    element,
    fill = 'none',
    fillOpacity = 1,
    stroke = 'none',
    strokeOpacity = 1,
    strokeWidth = 0,
    assetUrl = null,
    pointerEvents = 'visiblePainted',
  }: {
    element: DesignElement;
    fill?: string;
    fillOpacity?: number;
    stroke?: string;
    strokeOpacity?: number;
    strokeWidth?: number;
    assetUrl?: string | null;
    pointerEvents?: string;
  } = $props();

  const textValue = $derived.by(() => {
    const value = element.text || element.name;
    if (element.textTransform === 'uppercase') return value.toUpperCase();
    if (element.textTransform === 'lowercase') return value.toLowerCase();
    if (element.textTransform === 'capitalize') return value.replace(/\b\p{L}/gu, (character) => character.toUpperCase());
    return value;
  });
  const textLines = $derived(designTextLayoutLines(textValue, element.width, element.fontSize, element.fontWeight, element.lineHeight, element.letterSpacing, element.paragraphSpacing));
  const resolvedLineHeight = $derived(element.lineHeight ?? element.fontSize * 1.2);
  const textBlockHeight = $derived((textLines.at(-1)?.offsetY ?? 0) + resolvedLineHeight);
  const textOffsetY = $derived(element.textVerticalAlign === 'middle'
    ? Math.max(0, (element.height - textBlockHeight) / 2)
    : element.textVerticalAlign === 'bottom' ? Math.max(0, element.height - textBlockHeight) : 0);
</script>

{#if element.type === 'ellipse'}
  <ellipse
    cx={element.x + element.width / 2}
    cy={element.y + element.height / 2}
    rx={element.width / 2}
    ry={element.height / 2}
    {fill}
    fill-opacity={fillOpacity}
    {stroke}
    stroke-opacity={strokeOpacity}
    stroke-width={strokeWidth}
    pointer-events={pointerEvents}
  />
{:else if element.type === 'path'}
  <path
    d={designPathData(element)}
    {fill}
    fill-opacity={fillOpacity}
    fill-rule={element.fillRule}
    {stroke}
    stroke-opacity={strokeOpacity}
    stroke-width={strokeWidth}
    stroke-linecap="round"
    stroke-linejoin="round"
    pointer-events={pointerEvents}
  />
{:else if element.type === 'text'}
  <rect x={element.x} y={element.y} width={element.width} height={element.height} fill="transparent" pointer-events={pointerEvents} />
  <svg x={element.x} y={element.y} width={element.width} height={element.height} overflow="hidden" pointer-events="none">
    <text
      x={element.textAlign === 'center' ? element.width / 2 : element.textAlign === 'right' ? element.width : 0}
      {fill}
      fill-opacity={fillOpacity}
      {stroke}
      stroke-opacity={strokeOpacity}
      stroke-width={strokeWidth}
      font-family={`${element.fontFamily}, Inter Variable, Inter, sans-serif`}
      font-size={element.fontSize}
      font-weight={element.fontWeight}
      font-style={element.fontStyle}
      letter-spacing={element.letterSpacing}
      text-decoration={element.textDecoration}
      text-anchor={element.textAlign === 'center' ? 'middle' : element.textAlign === 'right' ? 'end' : 'start'}
    >
      {#each textLines as line}
        <tspan x={element.textAlign === 'center' ? element.width / 2 : element.textAlign === 'right' ? element.width : 0} y={textOffsetY + element.fontSize + line.offsetY}>{line.text}</tspan>
      {/each}
    </text>
  </svg>
{:else if element.type === 'image' && assetUrl}
  {#if element.cornerRadius > 0}
    <defs>
      <clipPath id={`design-image-clip-${element.id}`} clipPathUnits="userSpaceOnUse">
        <rect x={element.x} y={element.y} width={element.width} height={element.height} rx={element.cornerRadius} />
      </clipPath>
    </defs>
  {/if}
  <rect
    x={element.x}
    y={element.y}
    width={element.width}
    height={element.height}
    rx={element.cornerRadius}
    {fill}
    fill-opacity={fillOpacity}
    {stroke}
    stroke-opacity={strokeOpacity}
    stroke-width={strokeWidth}
    pointer-events={pointerEvents}
  />
  <image
    href={assetUrl}
    x={element.x}
    y={element.y}
    width={element.width}
    height={element.height}
    preserveAspectRatio={element.imageFit === 'fill' ? 'none' : element.imageFit === 'contain' ? 'xMidYMid meet' : 'xMidYMid slice'}
    pointer-events={pointerEvents}
    clip-path={element.cornerRadius > 0 ? `url(#design-image-clip-${element.id})` : undefined}
  />
{:else}
  <rect
    x={element.x}
    y={element.y}
    width={element.width}
    height={element.height}
    rx={element.cornerRadius}
    {fill}
    fill-opacity={fillOpacity}
    {stroke}
    stroke-opacity={strokeOpacity}
    stroke-width={strokeWidth}
    pointer-events={pointerEvents}
  />
{/if}
