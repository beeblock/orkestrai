<script lang="ts">
  import HeaderIconButton from './HeaderIconButton.svelte';

  import { NodeResizer } from '@xyflow/svelte';
  import { AlignCenter, AlignLeft, AlignRight, ArrowRight, Circle, CopyPlus, Diamond, GripHorizontal, Settings2, Square, SquareRoundCorner, X } from '@lucide/svelte';
  import * as Select from '$lib/components/ui/select';
  import { Slider } from '$lib/components/ui/slider';
  import { Switch } from '$lib/components/ui/switch';
  import { SegmentedControl } from '$lib/components/ui/segmented';
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

  // Cores de conteudo gravadas no payload da forma (nao sao tokens do tema:
  // o desenho precisa sair igual em qualquer tema e em exportacoes).
  const SWATCHES = ['#7C4DFF', '#00BFFF', '#FFC857', '#3dd68c', '#e5484d', '#ffffff', '#8b8c96', 'transparent'];

  // Escolhas curtas viram controles diretos (icone + nome acessivel).
  const KIND_OPTIONS = [
    { value: 'rectangle' as ShapeKind, label: m['shape.kind_rectangle'](), icon: Square },
    { value: 'rounded' as ShapeKind, label: m['shape.kind_rounded'](), icon: SquareRoundCorner },
    { value: 'ellipse' as ShapeKind, label: m['shape.kind_ellipse'](), icon: Circle },
    { value: 'diamond' as ShapeKind, label: m['shape.kind_diamond'](), icon: Diamond },
    { value: 'arrow' as ShapeKind, label: m['shape.kind_arrow'](), icon: ArrowRight },
  ];
  const ALIGN_OPTIONS = [
    { value: 'left' as const, label: m['design.align_left'](), icon: AlignLeft },
    { value: 'center' as const, label: m['design.align_center'](), icon: AlignCenter },
    { value: 'right' as const, label: m['design.align_right'](), icon: AlignRight },
  ];

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
  <!-- Alcas e anel iguais aos do NodeShell: linha invisivel, quadradinhos
       de 8px com recorte na cor da superficie. -->
  <NodeResizer
    isVisible={selected ?? false}
    minWidth={60}
    minHeight={40}
    onResizeEnd={(_e, params) => data.onResize?.(id, params)}
    lineStyle="border-color: transparent"
    handleStyle="width: 8px; height: 8px; border-radius: 3px; border: 1.5px solid var(--app-surface); background: var(--app-accent)"
  />
  {#if selected}
    <!-- Acoes agrupadas numa barra acima da forma: os cantos ficam livres
         para as alcas de redimensionar. -->
    <div class="shape-toolbar nodrag">
      <HeaderIconButton label={m['shape.style_title']()} class="shape-tool shape-settings" active={styleOpen} side="top" onclick={openStylePanel}>
        <Settings2 size={13} />
      </HeaderIconButton>
      <HeaderIconButton label={m['shape.duplicate_shortcut']()} class="shape-tool shape-duplicate" side="top" onclick={() => data.onDuplicate?.(id)}>
        <CopyPlus size={13} />
      </HeaderIconButton>
      <HeaderIconButton label={m['shape.remove']()} class="shape-tool shape-delete" danger side="top" onclick={() => data.onDelete(id)}>
        <X size={13} />
      </HeaderIconButton>
    </div>
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
        <SegmentedControl options={KIND_OPTIONS} value={shape} label={m['shape.lbl_type']()} size="sm" iconOnly fill onValueChange={(value) => patch({ shape: value })} />

        <span class="pop-label">{m['shape.lbl_fill']()}</span>
        <div class="swatches">
          {#each SWATCHES as swatch (swatch)}
            <button
              class="swatch"
              class:active={style.fill === swatch}
              class:transparent={swatch === 'transparent'}
              style:--swatch={swatch}
              aria-label={m['shape.swatch_fill']({ color: swatch })}
              aria-pressed={style.fill === swatch}
              title={swatch}
              onclick={() => patch({ fill: swatch })}
            ></button>
          {/each}
        </div>

        <span class="pop-label">{m['shape.lbl_opacity']()}</span>
        <div class="pop-row">
          <Slider
            type="single"
            value={Math.round(style.fillOpacity * 100)}
            min={0}
            max={100}
            step={5}
            aria-label={m['shape.lbl_opacity']()}
            onValueChange={(value: number) => patch({ fillOpacity: value / 100 })}
          />
          <span class="pop-value">{Math.round(style.fillOpacity * 100)}%</span>
        </div>

        <span class="pop-label">{m['shape.lbl_stroke']()}</span>
        <div class="swatches">
          {#each SWATCHES.filter((swatch) => swatch !== 'transparent') as swatch (swatch)}
            <button
              class="swatch"
              class:active={style.stroke === swatch}
              style:--swatch={swatch}
              aria-label={m['shape.swatch_stroke']({ color: swatch })}
              aria-pressed={style.stroke === swatch}
              title={swatch}
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
            aria-label={m['shape.lbl_stroke_width']()}
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
              aria-label={m['shape.lbl_head']()}
              onValueChange={(value: number) => patch({ headSize: value })}
            />
            <span class="pop-value">{style.headSize ?? Math.max(10, style.strokeWidth * 5)}px</span>
          </div>
        {/if}

        <span class="pop-label">{m['shape.lbl_dashed']()}</span>
        <div class="pop-row">
          <Switch checked={style.strokeDash} aria-label={m['shape.lbl_dashed']()} onCheckedChange={(checked: boolean) => patch({ strokeDash: checked })} />
        </div>

        <div class="pop-divider" aria-hidden="true"></div>

        <span class="pop-label">{m['shape.lbl_text']()}</span>
        <div class="swatches">
          {#each ['#ffffff', '#8b8c96', '#7C4DFF', '#00BFFF', '#FFC857', '#3dd68c', '#e5484d'] as swatch (swatch)}
            <button
              class="swatch"
              class:active={style.textColor === swatch}
              style:--swatch={swatch}
              aria-label={m['shape.swatch_text']({ color: swatch })}
              aria-pressed={style.textColor === swatch}
              title={swatch}
              onclick={() => patch({ textColor: swatch })}
            ></button>
          {/each}
        </div>

        <span class="pop-label">{m['shape.lbl_size']()}</span>
        <div class="pop-row">
          <Slider
            type="single"
            value={style.fontSize}
            min={8}
            max={72}
            step={1}
            aria-label={m['shape.lbl_size']()}
            onValueChange={(value: number) => patch({ fontSize: value || DEFAULTS.fontSize })}
          />
          <span class="pop-value">{style.fontSize}px</span>
        </div>

        <span class="pop-label">{m['shape.lbl_weight']()}</span>
        <Select.Root type="single" value={String(style.fontWeight)} onValueChange={(value: string) => patch({ fontWeight: Number(value) })}>
          <Select.Trigger class="h-7 w-full text-xs" data-slot="select-trigger" aria-label={m['shape.lbl_weight']()}>
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
        <SegmentedControl options={ALIGN_OPTIONS} value={style.textAlign} label={m['shape.lbl_align']()} size="sm" iconOnly fill onValueChange={(value) => patch({ textAlign: value })} />

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
    border-radius: 4px;
    transition: box-shadow var(--duration-quick) ease-out;
  }

  /* Mesma linguagem do NodeShell: anel fino ao apontar; na selecao, anel
     de 1px no acento + halo de 4px. Sombra, nunca borda: uma borda nova
     deslocaria o SVG em 1px. */
  .canvas-shape:hover {
    box-shadow: 0 0 0 1px var(--app-ring-hairline-strong);
  }

  .canvas-shape.selected {
    box-shadow:
      0 0 0 1px var(--app-accent),
      0 0 0 4px color-mix(in srgb, var(--app-accent) 16%, transparent);
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
    transition: fill var(--duration-quick) ease-out;
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

  /* Barra flutuante da forma selecionada (mesma elevacao dos menus). */
  .shape-toolbar {
    position: absolute;
    right: 0;
    bottom: calc(100% + 10px);
    z-index: 5;
    display: flex;
    gap: 2px;
    padding: 3px;
    border-radius: 9px;
    background: var(--app-surface-raised);
    box-shadow: var(--app-shadow-overlay);
  }

  .shape-toolbar :global(.shape-tool) {
    display: inline-grid;
    place-items: center;
    width: 26px;
    height: 26px;
    padding: 0;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--app-text-muted);
    cursor: pointer;
    transition:
      background-color var(--duration-quick) ease-out,
      color var(--duration-quick) ease-out,
      transform var(--duration-quick) var(--ease-smooth-out);
  }

  .shape-toolbar :global(.shape-tool:hover),
  .shape-toolbar :global(.shape-tool.active) {
    background: var(--app-hover);
    color: var(--app-text);
  }

  .shape-toolbar :global(.shape-tool.danger:hover) {
    background: var(--app-danger-soft);
    color: var(--app-danger);
  }

  .shape-toolbar :global(.shape-tool:active) {
    transform: scale(var(--scale-press));
  }

  .shape-toolbar :global(.shape-tool:focus-visible) {
    outline: 2px solid var(--app-accent);
    outline-offset: 1px;
  }

  .style-panel {
    position: fixed;
    /* z 40: acima do canvas, ABAIXO dos dropdowns (bits-ui Select ~50). */
    z-index: 40;
    width: 288px;
    border-radius: 12px;
    background: var(--app-surface);
    box-shadow: var(--app-shadow-overlay);
    padding: 0 12px 12px;
    user-select: none;
    animation: style-panel-in var(--duration-fast) var(--ease-smooth-out) both;
  }

  @keyframes style-panel-in {
    from {
      opacity: 0;
      transform: translateY(var(--distance-micro)) scale(var(--scale-dropdown));
    }
  }

  .style-panel-grip {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 40px;
    margin: 0 -12px 12px;
    padding: 0 6px 0 10px;
    border-bottom: 1px solid color-mix(in srgb, var(--app-border) 80%, transparent);
    color: var(--app-text-muted);
    cursor: grab;
    touch-action: none;
  }

  .style-panel-grip:active {
    cursor: grabbing;
  }

  .style-panel-grip:focus-visible {
    outline: 2px solid var(--app-accent);
    outline-offset: -2px;
    border-radius: 12px 12px 0 0;
  }

  .style-panel-grip span {
    flex: 1;
    color: var(--app-text);
    font-size: 12.5px;
    font-weight: 600;
  }

  .style-panel-close {
    display: inline-grid;
    place-items: center;
    width: 26px;
    height: 26px;
    padding: 0;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--app-text-muted);
    cursor: pointer;
    transition: background-color var(--duration-quick) ease-out, color var(--duration-quick) ease-out;
  }

  .style-panel-close:hover {
    color: var(--app-text);
    background: var(--app-hover);
  }

  .style-panel-close:focus-visible {
    outline: 2px solid var(--app-accent);
    outline-offset: 1px;
  }

  .pop-grid {
    display: grid;
    grid-template-columns: 72px minmax(0, 1fr);
    align-items: center;
    gap: 12px 12px;
  }

  .pop-label {
    color: var(--app-text-muted);
    font-size: 11.5px;
  }

  .pop-row {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 24px;
  }

  .pop-value {
    min-width: 34px;
    color: var(--app-text-soft);
    font-family: var(--font-mono);
    font-size: 10.5px;
    font-variant-numeric: tabular-nums;
    text-align: right;
  }

  .pop-hint {
    color: var(--app-text-muted);
    font-size: 11px;
    line-height: 1.45;
    text-wrap: pretty;
  }

  .pop-divider {
    grid-column: 1 / -1;
    height: 1px;
    margin: 2px -12px;
    background: color-mix(in srgb, var(--app-border) 70%, transparent);
  }

  .swatches {
    display: flex;
    flex-wrap: wrap;
    margin: -4px;
  }

  /* Alvo de 22px para uma bolinha de 14px; anel marca a cor atual. */
  .swatch {
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    padding: 0;
    border: 0;
    border-radius: 6px;
    background: transparent;
    cursor: pointer;
    transition: background-color var(--duration-quick) ease-out, transform var(--duration-quick) var(--ease-smooth-out);
  }

  .swatch::after {
    content: '';
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: var(--swatch);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--app-text) 18%, transparent);
  }

  .swatch.transparent::after {
    background: repeating-conic-gradient(var(--app-surface-raised) 0% 25%, var(--app-surface-subtle) 0% 50%) 0 0 / 6px 6px;
  }

  .swatch:hover {
    background: var(--app-hover);
  }

  .swatch:active {
    transform: scale(var(--scale-press));
  }

  .swatch.active::after {
    box-shadow: 0 0 0 2px var(--app-surface), 0 0 0 3.5px var(--app-text);
  }

  .swatch:focus-visible {
    outline: 2px solid var(--app-accent);
    outline-offset: 1px;
  }
</style>
