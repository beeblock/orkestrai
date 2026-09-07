<script lang="ts">
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
  }: {
    id: string;
    title: string;
    paints: DesignPaint[];
    fallbackColor: string;
    documentColors?: string[];
    variables?: Array<{ id: string; name: string; color: string }>;
    onChange: (paints: DesignPaint[]) => void;
    onBindVariable?: (variableId: string) => void;
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
  <Button variant="ghost" size="icon-sm" class="size-6" aria-label={title === m['design.fill']() ? m['design.add_fill']() : m['design.add_stroke']()} onclick={() => onChange([...visiblePaints, defaultPaint('solid')])}><Plus size={12} /></Button>
{/snippet}

<DesignInspectorSection id={`paint-${id}`} {title} actions={addPaint}>
  {#each visiblePaints as paint, index (`${paint.type}-${index}`)}
    <div class="mb-1.5 space-y-2 rounded border border-[var(--app-border)] bg-[var(--app-surface-subtle)] p-2 last:mb-0">
      <div class="flex items-center gap-1.5">
        <Button variant="ghost" size="icon-sm" class="size-7" aria-label={paint.visible ? m['design.hide_paint']() : m['design.show_paint']()} onclick={() => changePaint(index, { visible: !paint.visible })}>{#if paint.visible}<Eye size={12} />{:else}<EyeOff size={12} />{/if}</Button>
        <NativeSelect.Root class="h-7 min-w-0 flex-1 text-ui-xs" value={paint.type} onchange={(event: Event) => changeType(index, (event.currentTarget as HTMLSelectElement).value as DesignPaint['type'])} aria-label={title}>
          <NativeSelect.Option value="solid">{m['design.solid']()}</NativeSelect.Option>
          <NativeSelect.Option value="linear-gradient">{m['design.linear_gradient']()}</NativeSelect.Option>
          <NativeSelect.Option value="radial-gradient">{m['design.radial_gradient']()}</NativeSelect.Option>
        </NativeSelect.Root>
        <Button variant="ghost" size="icon-sm" class="size-7" aria-label={m['design.remove_paint']()} onclick={() => onChange(visiblePaints.filter((_, paintIndex) => paintIndex !== index))}><Minus size={12} /></Button>
      </div>
      {#if paint.type === 'solid'}
        <div class="grid grid-cols-[34px_1fr_74px] items-center gap-1.5">
          <DesignColorControl color={paint.color} opacity={paint.opacity} {documentColors} {variables} onChange={(color, opacity) => changePaint(index, { color, opacity })} {onBindVariable} />
          <span class="truncate font-mono text-ui-xs uppercase text-[var(--app-text-soft)]">{paint.color}</span>
          <DesignNumericInput label="%" value={Math.round(paint.opacity * 100)} min={0} max={100} onCommit={(value) => { if (value !== null) changePaint(index, { opacity: value / 100 }); }} />
        </div>
      {:else}
        {@const stopIndex = Math.min(selectedStops[index] ?? 0, paint.stops.length - 1)}
        {@const stop = paint.stops[stopIndex]}
        <div class="relative">
          <button class="h-8 w-full cursor-crosshair rounded-sm border border-[var(--app-border-strong)]" style:background={gradientCss(paint)} aria-label={m['design.add_gradient_stop']()} onclick={(event) => { const bounds = event.currentTarget.getBoundingClientRect(); addStop(index, Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width))); }}></button>
          {#each paint.stops as gradientStop, gradientStopIndex}
            <button class={`absolute top-full mt-1 size-3 -translate-x-1/2 rounded-sm border-2 shadow ${gradientStopIndex === stopIndex ? 'border-[var(--app-text)]' : 'border-[var(--app-surface)]'}`} style:left={`${gradientStop.offset * 100}%`} style:background={gradientStop.color} aria-label={m['design.gradient_stop']({ index: String(gradientStopIndex + 1) })} onpointerdown={(event) => startStopDrag(event, index, gradientStopIndex)} onclick={(event) => { event.stopPropagation(); selectStop(index, gradientStopIndex); }}></button>
          {/each}
        </div>
        <div class="h-3"></div>
        <div class="grid grid-cols-[34px_1fr_58px_58px_28px] items-center gap-1.5">
          <DesignColorControl color={stop.color} opacity={stop.opacity} {documentColors} onChange={(color, opacity) => changeStop(index, stopIndex, { color, opacity })} />
          <span class="truncate font-mono text-ui-xs uppercase text-[var(--app-text-soft)]">{stop.color}</span>
          <DesignNumericInput label="%" value={Math.round(stop.offset * 100)} min={0} max={100} onCommit={(value) => { if (value !== null) changeStop(index, stopIndex, { offset: value / 100 }); }} />
          <DesignNumericInput label="α" value={Math.round(stop.opacity * 100)} min={0} max={100} onCommit={(value) => { if (value !== null) changeStop(index, stopIndex, { opacity: value / 100 }); }} />
          <Button variant="ghost" size="icon-sm" class="size-7" disabled={paint.stops.length <= 2} aria-label={m['design.delete_gradient_stop']()} onclick={() => removeStop(index, stopIndex)}><Minus size={12} /></Button>
        </div>
        <div class="grid grid-cols-2 gap-1.5">
          {#if paint.type === 'linear-gradient'}
            <DesignNumericInput label="°" value={paint.angle} min={-3600} max={3600} onCommit={(value) => { if (value !== null) changePaint(index, { angle: value }); }} />
          {:else}
            <DesignNumericInput label="X" value={Math.round(paint.centerX * 100)} min={0} max={100} onCommit={(value) => { if (value !== null) changePaint(index, { centerX: value / 100 }); }} />
            <DesignNumericInput label="Y" value={Math.round(paint.centerY * 100)} min={0} max={100} onCommit={(value) => { if (value !== null) changePaint(index, { centerY: value / 100 }); }} />
            <DesignNumericInput label="R" value={Math.round(paint.radius * 100)} min={1} max={400} onCommit={(value) => { if (value !== null) changePaint(index, { radius: value / 100 }); }} />
          {/if}
        </div>
      {/if}
    </div>
  {/each}
</DesignInspectorSection>
