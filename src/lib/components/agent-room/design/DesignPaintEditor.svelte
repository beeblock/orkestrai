<script lang="ts">
  import type { Snippet } from 'svelte';
  import { Eye, EyeOff, Minus, Plus } from '@lucide/svelte';
  import { Button } from '$lib/components/ui/button';
  import * as NativeSelect from '$lib/components/ui/native-select';
  import type { DesignPaint } from '$lib/modules/agent-room/contracts/schemas/designSchemas.js';
  import * as m from '$lib/paraglide/messages.js';
  import DesignInspectorSection from './DesignInspectorSection.svelte';
  import DesignColorControl from './DesignColorControl.svelte';
  import DesignNumericInput from './DesignNumericInput.svelte';

  let {
    id,
    title,
    paints,
    fallbackColor,
    documentColors = [],
    variables = [],
    onChange,
    onBindVariable,
    headerActions,
  }: {
    id: string;
    title: string;
    paints: DesignPaint[];
    fallbackColor: string;
    documentColors?: string[];
    variables?: Array<{ id: string; name: string; color: string }>;
    onChange: (paints: DesignPaint[]) => void;
    onBindVariable?: (variableId: string) => void;
    /** Acoes extras do cabecalho (ex.: ferramentas de cor), antes do "+". */
    headerActions?: Snippet;
  } = $props();

  const visiblePaints = $derived(paints.length ? paints : fallbackColor === 'transparent' ? [] : [{ type: 'solid', color: fallbackColor, opacity: 1, visible: true } satisfies DesignPaint]);
  let selectedStops = $state<Record<number, number>>({});

  function defaultPaint(type: DesignPaint['type']): DesignPaint {
    if (type === 'linear-gradient') return {
      type,
      angle: 0,
      stops: [{ offset: 0, color: '#7c5cff', opacity: 1 }, { offset: 1, color: '#33d6c5', opacity: 1 }],
      opacity: 1,
      visible: true,
    };
    if (type === 'radial-gradient') return {
      type,
      centerX: 0.5,
      centerY: 0.5,
      radius: 0.5,
      stops: [{ offset: 0, color: '#ffffff', opacity: 1 }, { offset: 1, color: '#7c5cff', opacity: 1 }],
      opacity: 1,
      visible: true,
    };
    return { type: 'solid', color: fallbackColor === 'transparent' ? '#7c5cff' : fallbackColor, opacity: 1, visible: true };
  }

  function changeType(index: number, type: DesignPaint['type']) {
    onChange(visiblePaints.map((paint, paintIndex) => paintIndex === index ? defaultPaint(type) : paint));
  }

  function changePaint(index: number, changes: Partial<DesignPaint>) {
    onChange(visiblePaints.map((paint, paintIndex) => paintIndex === index ? { ...paint, ...changes } as DesignPaint : paint));
  }

  function changeStop(index: number, stopIndex: number, changes: { color?: string; offset?: number; opacity?: number }) {
    const paint = visiblePaints[index];
    if (paint.type === 'solid') return;
    const stops = paint.stops.map((stop, current) => current === stopIndex ? { ...stop, ...changes } : stop);
    changePaint(index, { stops } as Partial<DesignPaint>);
  }

  function gradientCss(paint: Exclude<DesignPaint, { type: 'solid' }>): string {
    const stops = [...paint.stops].sort((left, right) => left.offset - right.offset).map((stop) => `${stop.color}${Math.round(stop.opacity * 255).toString(16).padStart(2, '0')} ${Math.round(stop.offset * 100)}%`).join(', ');
    return paint.type === 'linear-gradient' ? `linear-gradient(${paint.angle}deg, ${stops})` : `radial-gradient(circle at ${paint.centerX * 100}% ${paint.centerY * 100}%, ${stops})`;
  }

  function selectStop(paintIndex: number, stopIndex: number) {
    selectedStops = { ...selectedStops, [paintIndex]: stopIndex };
  }

  function addStop(paintIndex: number, offset = 0.5) {
    const paint = visiblePaints[paintIndex];
    if (paint.type === 'solid' || paint.stops.length >= 32) return;
    const nearest = [...paint.stops].sort((left, right) => Math.abs(left.offset - offset) - Math.abs(right.offset - offset))[0];
    const stops = [...paint.stops, { offset, color: nearest?.color ?? '#7c5cff', opacity: nearest?.opacity ?? 1 }].sort((left, right) => left.offset - right.offset);
    changePaint(paintIndex, { stops } as Partial<DesignPaint>);
    selectStop(paintIndex, stops.findIndex((stop) => stop.offset === offset));
  }

  function removeStop(paintIndex: number, stopIndex: number) {
    const paint = visiblePaints[paintIndex];
    if (paint.type === 'solid' || paint.stops.length <= 2) return;
    changePaint(paintIndex, { stops: paint.stops.filter((_, index) => index !== stopIndex) } as Partial<DesignPaint>);
    selectStop(paintIndex, Math.max(0, stopIndex - 1));
  }

  function startStopDrag(event: PointerEvent, paintIndex: number, stopIndex: number) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const track = (event.currentTarget as HTMLElement).parentElement;
    if (!track) return;
    selectStop(paintIndex, stopIndex);
    const paint = visiblePaints[paintIndex];
    if (paint.type === 'solid') return;
    let offset = paint.stops[stopIndex].offset;
    const handle = event.currentTarget as HTMLElement;
    const move = (moveEvent: PointerEvent) => {
      const bounds = track.getBoundingClientRect();
      offset = Math.max(0, Math.min(1, (moveEvent.clientX - bounds.left) / bounds.width));
      handle.style.left = `${offset * 100}%`;
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      changeStop(paintIndex, stopIndex, { offset });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
  }
</script>

{#snippet addPaint()}
  {#if headerActions}{@render headerActions()}{/if}
  <Button variant="ghost" size="icon-sm" class="size-7 text-[var(--app-text-soft)] hover:text-[var(--app-text)]" aria-label={title === m['design.fill']() ? m['design.add_fill']() : m['design.add_stroke']()} title={title === m['design.fill']() ? m['design.add_fill']() : m['design.add_stroke']()} onclick={() => onChange([...visiblePaints, defaultPaint('solid')])}><Plus size={14} /></Button>
{/snippet}

<!-- Cada pintura e uma linha: amostra, valor e opacidade primeiro (o que se
     ajusta sempre); tipo, visibilidade e remocao ficam na segunda linha, com
     visibilidade/remocao discretas ate o hover. -->
<DesignInspectorSection id={`paint-${id}`} {title} meta={visiblePaints.length > 1 ? String(visiblePaints.length) : undefined} actions={addPaint}>
  {#each visiblePaints as paint, index (`${paint.type}-${index}`)}
    <div class={`group/paint space-y-1.5 rounded-lg bg-[var(--app-hover)] p-1.5 transition-opacity duration-150 ${paint.visible ? '' : 'opacity-60'}`}>
      {#if paint.type === 'solid'}
        <div class="grid grid-cols-[28px_minmax(0,1fr)_68px] items-center gap-1.5">
          <DesignColorControl color={paint.color} opacity={paint.opacity} {documentColors} {variables} onChange={(color, opacity) => changePaint(index, { color, opacity })} {onBindVariable} />
          <span class="truncate font-mono text-ui-sm uppercase text-[var(--app-text-soft)]" title={paint.color}>{paint.color}</span>
          <DesignNumericInput label="%" value={Math.round(paint.opacity * 100)} min={0} max={100} onCommit={(value) => { if (value !== null) changePaint(index, { opacity: value / 100 }); }} />
        </div>
      {:else}
        {@const stopIndex = Math.min(selectedStops[index] ?? 0, paint.stops.length - 1)}
        {@const stop = paint.stops[stopIndex]}
        <div class="relative pb-4">
          <button type="button" class="block h-7 w-full cursor-copy rounded-md shadow-[inset_0_0_0_1px_rgb(0_0_0/0.16)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--app-accent)]" style:background={gradientCss(paint)} aria-label={m['design.add_gradient_stop']()} title={m['design.add_gradient_stop']()} onclick={(event) => { const bounds = event.currentTarget.getBoundingClientRect(); addStop(index, Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width))); }}></button>
          {#each paint.stops as gradientStop, gradientStopIndex}
            <button type="button" class={`absolute top-8 size-3.5 -translate-x-1/2 cursor-ew-resize rounded-[4px] border-2 shadow-[0_1px_2px_rgb(0_0_0/0.35)] transition-[border-color] duration-150 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--app-accent)] ${gradientStopIndex === stopIndex ? 'border-[var(--app-text)]' : 'border-[var(--app-surface)]'}`} style:left={`${gradientStop.offset * 100}%`} style:background={gradientStop.color} aria-label={m['design.gradient_stop']({ index: String(gradientStopIndex + 1) })} onpointerdown={(event) => startStopDrag(event, index, gradientStopIndex)} onclick={(event) => { event.stopPropagation(); selectStop(index, gradientStopIndex); }}></button>
          {/each}
        </div>
        <div class="grid grid-cols-[28px_minmax(0,1fr)_60px_60px_28px] items-center gap-1">
          <DesignColorControl color={stop.color} opacity={stop.opacity} {documentColors} onChange={(color, opacity) => changeStop(index, stopIndex, { color, opacity })} />
          <span class="truncate font-mono text-ui-sm uppercase text-[var(--app-text-soft)]" title={stop.color}>{stop.color}</span>
          <DesignNumericInput label="%" value={Math.round(stop.offset * 100)} min={0} max={100} onCommit={(value) => { if (value !== null) changeStop(index, stopIndex, { offset: value / 100 }); }} />
          <DesignNumericInput label="α" value={Math.round(stop.opacity * 100)} min={0} max={100} onCommit={(value) => { if (value !== null) changeStop(index, stopIndex, { opacity: value / 100 }); }} />
          <Button variant="ghost" size="icon-sm" class="size-7 text-[var(--app-text-muted)] hover:text-[var(--app-text)]" disabled={paint.stops.length <= 2} aria-label={m['design.delete_gradient_stop']()} title={m['design.delete_gradient_stop']()} onclick={() => removeStop(index, stopIndex)}><Minus size={13} /></Button>
        </div>
        <div class={`grid gap-1 ${paint.type === 'linear-gradient' ? 'grid-cols-2' : 'grid-cols-3'}`}>
          {#if paint.type === 'linear-gradient'}
            <DesignNumericInput label="°" value={paint.angle} min={-3600} max={3600} onCommit={(value) => { if (value !== null) changePaint(index, { angle: value }); }} />
          {:else}
            <DesignNumericInput label="X" value={Math.round(paint.centerX * 100)} min={0} max={100} onCommit={(value) => { if (value !== null) changePaint(index, { centerX: value / 100 }); }} />
            <DesignNumericInput label="Y" value={Math.round(paint.centerY * 100)} min={0} max={100} onCommit={(value) => { if (value !== null) changePaint(index, { centerY: value / 100 }); }} />
            <DesignNumericInput label="R" value={Math.round(paint.radius * 100)} min={1} max={400} onCommit={(value) => { if (value !== null) changePaint(index, { radius: value / 100 }); }} />
          {/if}
        </div>
      {/if}
      <div class="flex items-center gap-1">
        <NativeSelect.Root size="sm" class="min-w-0 flex-1 [&_select]:bg-transparent [&_select]:text-ui-md" value={paint.type} onchange={(event: Event) => changeType(index, (event.currentTarget as HTMLSelectElement).value as DesignPaint['type'])} aria-label={title}>
          <NativeSelect.Option value="solid">{m['design.solid']()}</NativeSelect.Option>
          <NativeSelect.Option value="linear-gradient">{m['design.linear_gradient']()}</NativeSelect.Option>
          <NativeSelect.Option value="radial-gradient">{m['design.radial_gradient']()}</NativeSelect.Option>
        </NativeSelect.Root>
        <Button variant="ghost" size="icon-sm" class={`size-7 transition-[opacity,color] duration-150 hover:text-[var(--app-text)] group-focus-within/paint:opacity-100 group-hover/paint:opacity-100 ${paint.visible ? 'text-[var(--app-text-muted)] opacity-60' : 'text-[var(--app-text-soft)]'}`} aria-label={paint.visible ? m['design.hide_paint']() : m['design.show_paint']()} aria-pressed={!paint.visible} title={paint.visible ? m['design.hide_paint']() : m['design.show_paint']()} onclick={() => changePaint(index, { visible: !paint.visible })}>{#if paint.visible}<Eye size={13} />{:else}<EyeOff size={13} />{/if}</Button>
        <Button variant="ghost" size="icon-sm" class="size-7 text-[var(--app-text-muted)] opacity-60 transition-[opacity,color] duration-150 hover:text-[var(--app-danger)] group-focus-within/paint:opacity-100 group-hover/paint:opacity-100" aria-label={m['design.remove_paint']()} title={m['design.remove_paint']()} onclick={() => onChange(visiblePaints.filter((_, paintIndex) => paintIndex !== index))}><Minus size={13} /></Button>
      </div>
    </div>
  {/each}
</DesignInspectorSection>
