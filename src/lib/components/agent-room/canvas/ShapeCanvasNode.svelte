<script lang="ts">
  import HeaderIconButton from './HeaderIconButton.svelte';

  import { NodeResizer } from '@xyflow/svelte';
  import { CopyPlus, GripHorizontal, Settings2, X } from '@lucide/svelte';
  import { Input } from '$lib/components/ui/input';
  import * as Select from '$lib/components/ui/select';
  import { Slider } from '$lib/components/ui/slider';
  import * as m from '$lib/paraglide/messages.js';

  export type ShapeKind = 'rectangle' | 'rounded' | 'ellipse' | 'diamond' | 'arrow';

  export type ShapeStyle = {
    shape?: ShapeKind;
    label?: string;
    fill?: string;
    fillOpacity?: number;
    stroke?: string;
    strokeWidth?: number;
    strokeDash?: boolean;
    textColor?: string;
    fontSize?: number;
    fontWeight?: number;
    textAlign?: 'left' | 'center' | 'right';
    /** Pontos ancora da seta (0..1 normalizados na caixa do no). */
    points?: Array<{ x: number; y: number }>;
    /** Tamanho da cabeca da seta em px (default: 5x a espessura, min 10). */
    headSize?: number;
  };

  export type ShapeNodeData = {
    title: string;
    payload: ShapeStyle;
    onDelete: (id: string) => void;
    onDuplicate?: (id: string) => void;
    onResize?: (id: string, params: { x: number; y: number; width: number; height: number }) => void;
    onPayloadChange?: (id: string, partial: Record<string, unknown>) => void;
  };

  type ArrowPoint = { x: number; y: number };
  type ResolvedShapeStyle = Required<Omit<ShapeStyle, 'shape' | 'label' | 'points' | 'headSize'>> & {
    points?: ArrowPoint[];
    headSize?: number;
  };

  let { id, data, selected } = $props<{ id: string; data: ShapeNodeData; selected?: boolean }>();

  const DEFAULTS: Required<Omit<ShapeStyle, 'shape' | 'label' | 'points' | 'headSize'>> = {
    fill: '#7C4DFF',
    fillOpacity: 0.08,
    stroke: '#7C4DFF',
    strokeWidth: 2,
    strokeDash: false,
    textColor: '#ffffff',
    fontSize: 12,
    fontWeight: 500,
    textAlign: 'center',
  };

  const style: ResolvedShapeStyle = $derived({ ...DEFAULTS, ...data.payload });
  const shape: ShapeKind = $derived(data.payload.shape ?? 'rectangle');
  const label = $derived(data.payload.label ?? data.title ?? '');

  const SWATCHES = ['#7C4DFF', '#00BFFF', '#FFC857', '#3dd68c', '#e5484d', '#ffffff', '#8b8c96', 'transparent'];

  function patch(partial: Record<string, unknown>) {
    data.onPayloadChange?.(id, partial);
  }

  // -- Painel de estilo flutuante (arrastavel pelo canvas) ---------------------
  let styleOpen = $state(false);
  let panelPos = $state({ x: 0, y: 0 });
  let panelDrag: { startX: number; startY: number; baseX: number; baseY: number } | null = null;

  /** Move o elemento para o <body>: dentro do no o xyflow aplica transform,
      e position:fixed passaria a ser relativo ao no (painel sai da tela). */
  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return {
      destroy() {
        node.remove();
      },
    };
  }

  function openStylePanel(event: MouseEvent) {
    if (styleOpen) {
      styleOpen = false;
      return;
    }
    styleOpen = true;
    // Nasce perto do clique; depois o usuario arrasta para onde quiser.
    panelPos = { x: Math.min(event.clientX + 14, window.innerWidth - 280), y: Math.max(60, event.clientY - 60) };
  }

  function panelPointerDown(event: PointerEvent) {
    // O X de fechar fica dentro do grip: nao inicia arraste a partir dele
    // (o pointer capture do grip sequestrava o clique do X — so dblclick passava).
    if ((event.target as HTMLElement).closest('.style-panel-close')) return;
    panelDrag = { startX: event.clientX, startY: event.clientY, baseX: panelPos.x, baseY: panelPos.y };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  function panelPointerMove(event: PointerEvent) {
    if (!panelDrag) return;
    panelPos = {
      x: Math.max(8, Math.min(window.innerWidth - 272, panelDrag.baseX + event.clientX - panelDrag.startX)),
      y: Math.max(8, Math.min(window.innerHeight - 120, panelDrag.baseY + event.clientY - panelDrag.startY)),
    };
  }

  function panelPointerUp() {
    panelDrag = null;
  }
  let editing = $state(false);
  let draft = $state('');

  function editLabel() {
    draft = label;
    editing = true;
  }

  function commitLabel() {
    editing = false;
    patch({ label: draft });
  }

  function handleLabelKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter') commitLabel();
    if (event.key === 'Escape') editing = false;
  }

  // -- Geometria em PIXELS reais (sem viewBox escalado: borda/canto nao deformam) --
  let boxWidth = $state(0);
  let boxHeight = $state(0);

  const geom = $derived.by(() => {
    const w = Math.max(0, boxWidth);
    const h = Math.max(0, boxHeight);
    const pad = style.strokeWidth / 2 + 1;
    const x1 = pad;
    const y1 = pad;
    const x2 = Math.max(pad, w - pad);
    const y2 = Math.max(pad, h - pad);
    const cx = w / 2;
    const cy = h / 2;
    const rx = Math.max(1, w / 2 - pad);
    const ry = Math.max(1, h / 2 - pad);
    const radius = Math.min(12, Math.min(w, h) / 4);
    return { w, h, x1, y1, x2, y2, cx, cy, rx, ry, radius };
  });

  const dashArray = $derived(style.strokeDash ? `${style.strokeWidth * 3} ${style.strokeWidth * 2}` : undefined);

  // -- Seta com pontos ancora arrastaveis (curva suave) --------------------------
  const DEFAULT_ARROW_POINTS = [
    { x: 0.05, y: 0.5 },
    { x: 0.5, y: 0.5 },
    { x: 0.95, y: 0.5 },
  ];

  /** Pontos locais durante o arraste (persiste no payload ao soltar). */
  let dragPoints = $state<ArrowPoint[] | null>(null);
  let dragIndex = -1;

  const arrowPoints: ArrowPoint[] = $derived(dragPoints ?? data.payload.points ?? DEFAULT_ARROW_POINTS);

  /** Catmull-Rom -> bezier cubico (curva suave passando por todos os pontos). */
  function smoothPath(pts: Array<{ x: number; y: number }>, w: number, h: number): string {
    const px = pts.map((p) => ({ x: p.x * w, y: p.y * h }));
    if (px.length < 2) return '';
    if (px.length === 2) return `M ${px[0].x} ${px[0].y} L ${px[1].x} ${px[1].y}`;
    let d = `M ${px[0].x} ${px[0].y}`;
    for (let i = 0; i < px.length - 1; i += 1) {
      const p0 = px[Math.max(0, i - 1)];
      const p1 = px[i];
      const p2 = px[i + 1];
      const p3 = px[Math.min(px.length - 1, i + 2)];
      const c1x = p1.x + (p2.x - p0.x) / 6;
      const c1y = p1.y + (p2.y - p0.y) / 6;
      const c2x = p2.x - (p3.x - p1.x) / 6;
      const c2y = p2.y - (p3.y - p1.y) / 6;
      d += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2.x} ${p2.y}`;
    }
    return d;
  }

  /** Ponta da seta orientada pela tangente no fim do caminho. */
  const arrowHead = $derived.by(() => {
    const pts = arrowPoints;
    if (pts.length < 2 || !geom.w) return null;
    const last = pts[pts.length - 1];
    const prev = pts[pts.length - 2];
    const endX = last.x * geom.w;
    const endY = last.y * geom.h;
    const angle = Math.atan2((last.y - prev.y) * geom.h, (last.x - prev.x) * geom.w);
    const size = style.headSize ?? Math.max(10, style.strokeWidth * 5);
    // A ponta AVANCA alem do fim da linha: o cap redondo da linha (stroke-linecap)
    // e a largura do traço ficam cobertos pelo triangulo solido — sem a ponta da
    // linha vazando na frente da cabeca da seta.
    const overshoot = Math.max(2, style.strokeWidth * 1.2);
    const tipX = endX + overshoot * Math.cos(angle);
    const tipY = endY + overshoot * Math.sin(angle);
    const left = { x: tipX - size * Math.cos(angle - 0.45), y: tipY - size * Math.sin(angle - 0.45) };
    const right = { x: tipX - size * Math.cos(angle + 0.45), y: tipY - size * Math.sin(angle + 0.45) };
    return { tipX, tipY, left, right };
  });

  function localPoint(event: PointerEvent, el: HTMLElement) {
    const rect = el.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
    };
  }

  function startPointDrag(event: PointerEvent, index: number) {
    if (!selected) return;
    event.stopPropagation();
    event.preventDefault();
    dragIndex = index;
    dragPoints = arrowPoints.map((p) => ({ ...p }));
    const shapeEl = (event.currentTarget as HTMLElement).closest('.canvas-shape') as HTMLElement;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    const move = (moveEvent: PointerEvent) => {
      if (!dragPoints || dragIndex < 0) return;
      dragPoints[dragIndex] = localPoint(moveEvent, shapeEl);
    };
    const up = (upEvent: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (dragPoints && dragIndex >= 0) {
        dragPoints[dragIndex] = localPoint(upEvent, shapeEl);
        patch({ points: dragPoints });
      }
      dragIndex = -1;
      dragPoints = null;
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  /** Duplo-clique no caminho: insere um ponto no segmento mais proximo. */
  function addArrowPoint(event: MouseEvent) {
    if (shape !== 'arrow' || !selected) return;
    const shapeEl = (event.currentTarget as HTMLElement).closest('.canvas-shape') as HTMLElement;
    const rect = shapeEl.getBoundingClientRect();
    const point = {
      x: (event.clientX - rect.left) / rect.width,
      y: (event.clientY - rect.top) / rect.height,
    };
    const pts = arrowPoints.map((p) => ({ ...p }));
    // Segmento mais proximo: maior distancia perpendicular menor
    let bestIndex = pts.length - 1;
    let bestDist = Infinity;
    for (let i = 0; i < pts.length - 1; i += 1) {
      const mx = (pts[i].x + pts[i + 1].x) / 2;
      const my = (pts[i].y + pts[i + 1].y) / 2;
      const dist = Math.hypot(point.x - mx, point.y - my);
      if (dist < bestDist) {
        bestDist = dist;
        bestIndex = i + 1;
      }
    }
    pts.splice(bestIndex, 0, point);
    patch({ points: pts });
  }

  /** Duplo-clique num ponto: remove (minimo 2). */
  function removeArrowPoint(event: MouseEvent, index: number) {
    if (shape !== 'arrow') return;
    event.stopPropagation();
    const pts = arrowPoints.map((p) => ({ ...p }));
    if (pts.length <= 2) return;
    pts.splice(index, 1);
    patch({ points: pts });
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="canvas-shape nowheel"
  class:selected
  bind:clientWidth={boxWidth}
  bind:clientHeight={boxHeight}
  ondblclick={editLabel}
>
  <NodeResizer
    isVisible={selected ?? false}
    minWidth={60}
    minHeight={40}
    onResizeEnd={(_e, params) => data.onResize?.(id, params)}
    lineStyle="border-color: var(--app-accent)"
    handleStyle="background: var(--app-accent)"
  />
  {#if selected}
    <HeaderIconButton label={m['shape.remove']()} class="shape-delete nodrag" side="left" onclick={() => data.onDelete(id)}>
      <X size={12} />
    </HeaderIconButton>

    <HeaderIconButton
      label={m['shape.duplicate_shortcut']()}
      class="shape-duplicate nodrag"
      side="left"
      onclick={() => data.onDuplicate?.(id)}
    >
      <CopyPlus size={12} />
    </HeaderIconButton>

    <button class="shape-settings nodrag" class:style-open={styleOpen} aria-label={m['shape.style_title']()} onclick={openStylePanel}>
      <Settings2 size={12} />
    </button>
  {/if}

  {#if styleOpen}
    <div
      class="style-panel nodrag nowheel"
      use:portal
      style:left="{panelPos.x}px"
      style:top="{panelPos.y}px"
      role="dialog"
      tabindex="-1"
      aria-label={m['shape.style_title']()}
      onclick={(event) => event.stopPropagation()}
      onkeydown={(event) => event.stopPropagation()}
      ondblclick={(event) => event.stopPropagation()}
    >
      <div
        class="style-panel-grip"
        onpointerdown={panelPointerDown}
        onpointermove={panelPointerMove}
        onpointerup={panelPointerUp}
        role="button"
        tabindex="0"
        aria-label={m['shape.drag_panel']()}
      >
        <GripHorizontal size={13} />
        <span>{m['shape.style_title']()}</span>
        <button class="style-panel-close" aria-label={m['shape.close']()} onclick={() => (styleOpen = false)}>
          <X size={12} />
        </button>
      </div>
      <div class="pop-grid">
        <span class="pop-label">{m['shape.lbl_type']()}</span>
        <Select.Root type="single" value={shape} onValueChange={(value: string) => patch({ shape: value as ShapeKind })}>
          <Select.Trigger class="h-7 w-full text-xs" data-slot="select-trigger">
            {{ rectangle: m['shape.kind_rectangle'](), rounded: m['shape.kind_rounded'](), ellipse: m['shape.kind_ellipse'](), diamond: m['shape.kind_diamond'](), arrow: m['shape.kind_arrow']() }[shape]}
          </Select.Trigger>
          <Select.Content>
            <Select.Item value="rectangle">{m['shape.kind_rectangle']()}</Select.Item>
            <Select.Item value="rounded">{m['shape.kind_rounded']()}</Select.Item>
            <Select.Item value="ellipse">{m['shape.kind_ellipse']()}</Select.Item>
            <Select.Item value="diamond">{m['shape.kind_diamond']()}</Select.Item>
            <Select.Item value="arrow">{m['shape.kind_arrow']()}</Select.Item>
          </Select.Content>
        </Select.Root>

        <span class="pop-label">{m['shape.lbl_fill']()}</span>
        <div class="swatches">
          {#each SWATCHES as swatch (swatch)}
            <button
              class="swatch"
              class:active={style.fill === swatch}
              class:transparent={swatch === 'transparent'}
              style:background={swatch === 'transparent' ? 'transparent' : swatch}
              aria-label={m['shape.swatch_fill']({ color: swatch })}
              onclick={() => patch({ fill: swatch })}
            ></button>
          {/each}
        </div>

        <span class="pop-label">{m['shape.lbl_opacity']()}</span>
        <Slider
          type="single"
          value={Math.round(style.fillOpacity * 100)}
          min={0}
          max={100}
          step={5}
          onValueChange={(value: number) => patch({ fillOpacity: value / 100 })}
        />

        <span class="pop-label">{m['shape.lbl_stroke']()}</span>
        <div class="swatches">
          {#each SWATCHES.filter((swatch) => swatch !== 'transparent') as swatch (swatch)}
            <button
              class="swatch"
              class:active={style.stroke === swatch}
              style:background={swatch}
              aria-label={m['shape.swatch_stroke']({ color: swatch })}
              onclick={() => patch({ stroke: swatch })}
            ></button>
          {/each}
        </div>

        <span class="pop-label">{m['shape.lbl_stroke_width']()}</span>
        <div class="pop-row">
          <Slider
            type="single"
            value={style.strokeWidth}
            min={0}
            max={10}
            step={0.5}
            onValueChange={(value: number) => patch({ strokeWidth: value })}
          />
          <span class="pop-value">{style.strokeWidth}px</span>
        </div>

        {#if shape === 'arrow'}
          <span class="pop-label">{m['shape.lbl_head']()}</span>
          <div class="pop-row">
            <Slider
              type="single"
              value={style.headSize ?? Math.max(10, style.strokeWidth * 5)}
              min={6}
              max={60}
              step={1}
              onValueChange={(value: number) => patch({ headSize: value })}
            />
            <span class="pop-value">{style.headSize ?? Math.max(10, style.strokeWidth * 5)}px</span>
          </div>
        {/if}

        <span class="pop-label">{m['shape.lbl_dashed']()}</span>
        <button class="mini-toggle" class:active={style.strokeDash} onclick={() => patch({ strokeDash: !style.strokeDash })}>
          {style.strokeDash ? m['shape.yes']() : m['shape.no']()}
        </button>

        <span class="pop-label">{m['shape.lbl_text']()}</span>
        <div class="swatches">
          {#each ['#ffffff', '#8b8c96', '#7C4DFF', '#00BFFF', '#FFC857', '#3dd68c', '#e5484d'] as swatch (swatch)}
            <button
              class="swatch"
              class:active={style.textColor === swatch}
              style:background={swatch}
              aria-label={m['shape.swatch_text']({ color: swatch })}
              onclick={() => patch({ textColor: swatch })}
            ></button>
          {/each}
        </div>

        <span class="pop-label">{m['shape.lbl_size']()}</span>
        <Input
          class="h-7 w-20 text-xs"
          type="number"
          min={8}
          max={72}
          value={style.fontSize}
          oninput={(event: Event) => patch({ fontSize: Number((event.target as HTMLInputElement).value) || DEFAULTS.fontSize })}
        />

        <span class="pop-label">{m['shape.lbl_weight']()}</span>
        <Select.Root type="single" value={String(style.fontWeight)} onValueChange={(value: string) => patch({ fontWeight: Number(value) })}>
          <Select.Trigger class="h-7 w-full text-xs" data-slot="select-trigger">
            {{ '400': m['shape.weight_400'](), '500': m['shape.weight_500'](), '600': m['shape.weight_600'](), '700': m['shape.weight_700']() }[String(style.fontWeight)]}
          </Select.Trigger>
          <Select.Content>
            <Select.Item value="400">{m['shape.weight_400']()}</Select.Item>
            <Select.Item value="500">{m['shape.weight_500']()}</Select.Item>
            <Select.Item value="600">{m['shape.weight_600']()}</Select.Item>
            <Select.Item value="700">{m['shape.weight_700']()}</Select.Item>
          </Select.Content>
        </Select.Root>

        <span class="pop-label">{m['shape.lbl_align']()}</span>
        <div class="pop-row">
          {#each (['left', 'center', 'right'] as const) as align (align)}
            <button
              class="mini-toggle"
              class:active={style.textAlign === align}
              onclick={() => patch({ textAlign: align })}
            >{{ left: m['shape.align_left'](), center: m['shape.align_center'](), right: m['shape.align_right']() }[align]}</button>
          {/each}
        </div>

        {#if shape === 'arrow'}
          <span class="pop-label">{m['shape.lbl_points']()}</span>
          <span class="pop-hint">{m['shape.points_hint']()}</span>
        {/if}
      </div>
    </div>
  {/if}

  {#if geom.w > 0 && geom.h > 0}
    <svg width={geom.w} height={geom.h} class="shape-svg">
      {#if shape === 'rectangle' || shape === 'rounded'}
        <rect
          x={geom.x1}
          y={geom.y1}
          width={geom.x2 - geom.x1}
          height={geom.y2 - geom.y1}
          rx={shape === 'rounded' ? geom.radius : 2}
          fill={style.fill === 'transparent' ? 'none' : style.fill}
          fill-opacity={style.fill === 'transparent' ? 0 : style.fillOpacity}
          stroke={style.stroke}
          stroke-width={style.strokeWidth}
          stroke-dasharray={dashArray}
        />
      {:else if shape === 'ellipse'}
        <ellipse
          cx={geom.cx}
          cy={geom.cy}
          rx={geom.rx}
          ry={geom.ry}
          fill={style.fill === 'transparent' ? 'none' : style.fill}
          fill-opacity={style.fill === 'transparent' ? 0 : style.fillOpacity}
          stroke={style.stroke}
          stroke-width={style.strokeWidth}
          stroke-dasharray={dashArray}
        />
      {:else if shape === 'diamond'}
        <polygon
          points={`${geom.cx},${geom.y1} ${geom.x2},${geom.cy} ${geom.cx},${geom.y2} ${geom.x1},${geom.cy}`}
          fill={style.fill === 'transparent' ? 'none' : style.fill}
          fill-opacity={style.fill === 'transparent' ? 0 : style.fillOpacity}
          stroke={style.stroke}
          stroke-width={style.strokeWidth}
          stroke-dasharray={dashArray}
          stroke-linejoin="round"
        />
      {:else if shape === 'arrow'}
        <!-- caminho suave com pontos arrastaveis; 2x-clique no traco adiciona ponto -->
        <path
          d={smoothPath(arrowPoints, geom.w, geom.h)}
          fill="none"
          stroke={style.stroke}
          stroke-width={style.strokeWidth}
          stroke-dasharray={dashArray}
          stroke-linecap="round"
          class="arrow-path"
          class:editable={selected}
          ondblclick={addArrowPoint}
        />
        {#if arrowHead}
          <polygon
            points={`${arrowHead.left.x},${arrowHead.left.y} ${arrowHead.tipX},${arrowHead.tipY} ${arrowHead.right.x},${arrowHead.right.y}`}
            fill={style.stroke}
          />
        {/if}
        {#if selected}
          {#each arrowPoints as point, index (index)}
            <circle
              cx={point.x * geom.w}
              cy={point.y * geom.h}
              r={7}
              class="arrow-anchor nodrag"
              onpointerdown={(event) => startPointDrag(event, index)}
              ondblclick={(event) => removeArrowPoint(event, index)}
            />
          {/each}
        {/if}
      {/if}
    </svg>
  {/if}

  {#if editing}
    <!-- svelte-ignore a11y_autofocus -->
    <input
      class="shape-label-input nodrag"
      bind:value={draft}
      style:color={style.textColor}
      style:font-size="{style.fontSize}px"
      style:font-weight={style.fontWeight}
      style:text-align={style.textAlign}
      onkeydown={handleLabelKeydown}
      onblur={commitLabel}
      autofocus
    />
  {:else if label}
    <span
      class="shape-label"
      style:color={style.textColor}
      style:font-size="{style.fontSize}px"
      style:font-weight={style.fontWeight}
      style:justify-content={{ left: 'flex-start', center: 'center', right: 'flex-end' }[style.textAlign]}
      style:text-align={style.textAlign}
    >{label}</span>
  {/if}
</div>

<style>
  .canvas-shape {
    width: 100%;
    height: 100%;
    position: relative;
  }

  /* Mesma linguagem de selecao do NodeShell. Sem border-color aqui: a caixa
     nao tem borda e um border-width novo deslocaria o SVG em 1px. */
  .canvas-shape.selected {
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--app-accent) 18%, transparent);
  }

  .shape-svg {
    position: absolute;
    inset: 0;
    display: block;
  }

  .arrow-path.editable {
    cursor: copy;
    pointer-events: stroke;
  }

  .arrow-anchor {
    fill: var(--app-surface);
    stroke: var(--app-accent);
    stroke-width: 2;
    cursor: grab;
    pointer-events: all;
  }

  .arrow-anchor:hover {
    fill: var(--app-accent);
  }

  .arrow-anchor:active {
    cursor: grabbing;
  }

  .shape-label {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    padding: 8px 12px;
    pointer-events: none;
    overflow-wrap: break-word;
  }

  .shape-label-input {
    position: absolute;
    inset: 8px 12px;
    width: calc(100% - 24px);
    min-width: 0;
    padding: 0;
    border: none;
    outline: none;
    background: transparent;
    line-height: 1.2;
  }

  :global(.shape-delete),
  :global(.shape-duplicate) {
    position: absolute;
    top: -10px;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    border: 1px solid var(--app-border-strong);
    background: var(--app-surface-raised);
    color: var(--app-text-muted);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    z-index: 5;
  }

  :global(.shape-delete) {
    right: -10px;
  }

  :global(.shape-duplicate) {
    right: 16px;
  }

  :global(.shape-delete):hover {
    color: var(--app-danger);
  }

  :global(.shape-duplicate):hover {
    color: var(--app-accent);
    border-color: var(--app-accent);
  }

  :global(.shape-settings) {
    position: absolute;
    top: -10px;
    left: -10px;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    border: 1px solid var(--app-border-strong);
    background: var(--app-surface-raised);
    color: var(--app-text-muted);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    z-index: 5;
  }

  :global(.shape-settings:hover),
  .shape-settings.style-open {
    color: var(--app-accent);
    border-color: var(--app-accent);
  }

  .style-panel {
    position: fixed;
    /* z 40: acima do canvas, ABAIXO dos dropdowns (bits-ui Select ~50). */
    z-index: 40;
    width: 264px;
    border: 1px solid var(--app-border);
    border-radius: 12px;
    background: var(--app-surface);
    box-shadow: var(--app-shadow-overlay);
    padding: 10px 12px 12px;
    user-select: none;
  }

  .style-panel-grip {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: -4px -6px 10px;
    padding: 6px 6px 8px;
    border-bottom: 1px solid var(--app-border);
    color: var(--app-text-muted);
    font-size: 11px;
    font-weight: 600;
    cursor: grab;
    touch-action: none;
  }

  .style-panel-grip:active {
    cursor: grabbing;
  }

  .style-panel-grip span {
    flex: 1;
  }

  .style-panel-close {
    border: none;
    background: transparent;
    color: var(--app-text-muted);
    cursor: pointer;
    display: inline-flex;
    padding: 2px;
    border-radius: 5px;
  }

  .style-panel-close:hover {
    color: var(--app-danger);
    background: var(--app-border);
  }

  .pop-grid {
    display: grid;
    grid-template-columns: 70px 1fr;
    align-items: center;
    gap: 8px 10px;
  }

  .pop-label {
    font-size: 11px;
    color: var(--app-text-muted);
  }

  .pop-row {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .pop-value {
    font-size: 10px;
    color: var(--app-text-muted);
    min-width: 28px;
    text-align: right;
  }

  .pop-hint {
    font-size: 10px;
    color: var(--app-text-muted);
    line-height: 1.4;
  }

  .swatches {
    display: flex;
    gap: 4px;
    flex-wrap: wrap;
  }

  .swatch {
    width: 16px;
    height: 16px;
    border-radius: 5px;
    border: 1px solid var(--app-border-strong);
    cursor: pointer;
    padding: 0;
  }

  .swatch.transparent {
    background: repeating-conic-gradient(
        var(--app-surface-raised) 0% 25%,
        var(--app-surface-subtle) 0% 50%
      )
      0 0 / 8px 8px;
  }

  .swatch.active {
    outline: 2px solid var(--app-text);
    outline-offset: 1px;
  }

  .mini-toggle {
    border: 1px solid var(--app-border);
    background: transparent;
    color: var(--app-text-muted);
    font-size: 10px;
    border-radius: 6px;
    padding: 3px 8px;
    cursor: pointer;
  }

  .mini-toggle.active {
    background: var(--app-accent-soft);
    border-color: var(--app-accent);
    color: var(--app-text);
  }
</style>
