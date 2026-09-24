<script lang="ts">
  import { onMount } from 'svelte';
  import { Pipette, Variable } from '@lucide/svelte';
  import { toast } from 'svelte-sonner';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Slider } from '$lib/components/ui/slider';
  import * as Popover from '$lib/components/ui/popover';
  import { designHexToRgb, designHslToHex, designHsvToHex, designRgbToHex, designRgbToHsl, designRgbToHsv, normalizeDesignHex, type DesignHsl, type DesignHsv } from '$lib/modules/agent-room/domain/design-color.js';
  import * as m from '$lib/paraglide/messages.js';
  import DesignNumericInput from './DesignNumericInput.svelte';

  let {
    color,
    opacity,
    documentColors = [],
    variables = [],
    alpha = true,
    label,
    onChange,
    onBindVariable,
  }: {
    color: string;
    opacity: number;
    documentColors?: string[];
    variables?: Array<{ id: string; name: string; color: string }>;
    /** Esconde o canal alfa onde o valor salvo e so hex (variaveis, keyframes). */
    alpha?: boolean;
    /** Nome acessivel do gatilho quando ha mais de um seletor na mesma tela. */
    label?: string;
    onChange: (color: string, opacity: number) => void;
    onBindVariable?: (variableId: string) => void;
  } = $props();

  let format = $state<'hex' | 'rgb' | 'hsl'>('hex');
  let previewColor = $state('#000000');
  let hsv = $state<DesignHsv>({ h: 0, s: 0, v: 0 });
  let dragging = $state(false);
  let recentColors = $state<string[]>([]);
  const hsl = $derived(designRgbToHsl(designHexToRgb(previewColor)));

  $effect(() => {
    if (!dragging) {
      const nextColor = normalizeDesignHex(color) ?? '#000000';
      previewColor = nextColor;
      hsv = designRgbToHsv(designHexToRgb(nextColor));
    }
  });

  onMount(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('orkestrai:design:recent-colors') ?? '[]');
      if (Array.isArray(saved)) recentColors = saved.filter((entry): entry is string => typeof entry === 'string' && Boolean(normalizeDesignHex(entry))).slice(0, 12);
    } catch {
      recentColors = [];
    }
  });

  function remember(next: string) {
    recentColors = [next, ...recentColors.filter((entry) => entry !== next)].slice(0, 12);
    try {
      localStorage.setItem('orkestrai:design:recent-colors', JSON.stringify(recentColors));
    } catch {
      // Recent colors remain available for the current editor session.
    }
  }

  function commit(nextColor = color, nextOpacity = opacity) {
    const normalized = normalizeDesignHex(nextColor);
    if (!normalized) return;
    previewColor = normalized;
    hsv = designRgbToHsv(designHexToRgb(normalized));
    remember(normalized);
    onChange(normalized, Math.max(0, Math.min(1, nextOpacity)));
  }

  function updateRgb(channel: 'r' | 'g' | 'b', value: number) {
    commit(designRgbToHex({ ...designHexToRgb(previewColor), [channel]: value }));
  }

  function updateHsl(channel: keyof DesignHsl, value: number) {
    const next = { ...hsl, [channel]: value };
    commit(designHslToHex(next));
  }

  function startPlane(event: PointerEvent) {
    if (event.button !== 0) return;
    event.preventDefault();
    dragging = true;
    const target = event.currentTarget as HTMLElement;
    let next = hsv;
    const move = (moveEvent: PointerEvent) => {
      const bounds = target.getBoundingClientRect();
      next = {
        ...hsv,
        s: Math.round(Math.max(0, Math.min(1, (moveEvent.clientX - bounds.left) / bounds.width)) * 100),
        v: Math.round((1 - Math.max(0, Math.min(1, (moveEvent.clientY - bounds.top) / bounds.height))) * 100),
      };
      hsv = next;
      previewColor = designHsvToHex(next);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      dragging = false;
      commit(designHsvToHex(next));
    };
    move(event);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
  }

  function movePlaneWithKeyboard(event: KeyboardEvent) {
    const amount = event.shiftKey ? 10 : 1;
    const next = { ...hsv };
    if (event.key === 'ArrowLeft') next.s = Math.max(0, next.s - amount);
    else if (event.key === 'ArrowRight') next.s = Math.min(100, next.s + amount);
    else if (event.key === 'ArrowDown') next.v = Math.max(0, next.v - amount);
    else if (event.key === 'ArrowUp') next.v = Math.min(100, next.v + amount);
    else return;
    event.preventDefault();
    hsv = next;
    commit(designHsvToHex(next));
  }

  async function pickFromScreen() {
    const EyeDropper = (window as Window & { EyeDropper?: new () => { open: () => Promise<{ sRGBHex: string }> } }).EyeDropper;
    if (!EyeDropper) {
      toast.error(m['design.eyedropper_unavailable']());
      return;
    }
    try {
      const result = await new EyeDropper().open();
      commit(result.sRGBHex);
    } catch {
      // The native picker was cancelled.
    }
  }
</script>

{#snippet swatches(title: string, colors: string[])}
  <div class="space-y-1.5">
    <p class="section-label">{title}</p>
    <div class="flex flex-wrap gap-1.5">
      {#each colors as swatch}
        <button type="button" class="size-5 rounded-[5px] shadow-[inset_0_0_0_1px_rgb(0_0_0/0.14)] transition-transform duration-150 ease-out hover:scale-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--app-accent)] active:scale-[0.96]" style:background={swatch} aria-label={swatch} title={swatch} onclick={() => commit(swatch)}></button>
      {/each}
    </div>
  </div>
{/snippet}

<Popover.Root>
  <Popover.Trigger>
    {#snippet child({ props })}
      <!-- Xadrez atras da amostra: sem ele uma cor com alfa baixo parecia
           simplesmente mais clara, e nao transparente. -->
      <Button {...props} variant="outline" size="icon-sm" class="size-7 overflow-hidden rounded-md p-[3px]" aria-label={label ?? m['design.color_picker']()} title={label}>
        <span class="design-checker relative size-full overflow-hidden rounded-[4px] shadow-[inset_0_0_0_1px_rgb(0_0_0/0.14)]"><span class="absolute inset-0" style:background={`${previewColor}${Math.round(opacity * 255).toString(16).padStart(2, '0')}`}></span></span>
      </Button>
    {/snippet}
  </Popover.Trigger>
  <Popover.Content align="start" sideOffset={6} class="z-[170] w-72 space-y-3 p-3">
    <div
      class="relative h-36 cursor-crosshair overflow-hidden rounded-md shadow-[inset_0_0_0_1px_rgb(0_0_0/0.18)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--app-accent)]"
      style:background={`linear-gradient(to bottom, transparent, #000), linear-gradient(to right, #fff, hsl(${hsv.h} 100% 50%))`}
      role="slider"
      aria-label={m['design.color_picker']()}
      aria-valuemin="0"
      aria-valuemax="100"
      aria-valuenow={hsv.s}
      aria-valuetext={`${hsv.s}%, ${hsv.v}%`}
      tabindex="0"
      onpointerdown={startPlane}
      onkeydown={movePlaneWithKeyboard}
    >
      <span class="pointer-events-none absolute size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.5)]" style:left={`${hsv.s}%`} style:top={`${100 - hsv.v}%`}></span>
    </div>
    <div class="grid grid-cols-[minmax(0,1fr)_28px] items-center gap-2">
      <Slider type="single" value={hsv.h} min={0} max={360} step={1} aria-label={m['design.hue_short']()} class="[&_[data-slot=slider-track]]:h-2.5 [&_[data-slot=slider-track]]:bg-[linear-gradient(to_right,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)] [&_[data-slot=slider-range]]:bg-transparent" onValueChange={(value: number) => { hsv = { ...hsv, h: value }; previewColor = designHsvToHex(hsv); }} onValueCommit={(value: number) => commit(designHsvToHex({ ...hsv, h: value }))} />
      <Button variant="ghost" size="icon-sm" class="size-7 text-[var(--app-text-soft)]" aria-label={m['design.eyedropper']()} title={m['design.eyedropper']()} onclick={() => void pickFromScreen()}><Pipette size={14} /></Button>
    </div>
    <!-- Botoes com aria-pressed (e nao radios): o contrato de teste usa esse papel. -->
    <div class="grid grid-cols-3 gap-0.5 rounded-lg bg-[var(--app-hover)] p-0.5" role="group" aria-label={m['design.color_format']()}>
      {#each ['hex', 'rgb', 'hsl'] as option}
        <button type="button" class={`h-6 rounded-md text-ui-xs font-medium uppercase transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--app-accent)] ${format === option ? 'bg-[var(--app-surface-raised)] text-[var(--app-text)] shadow-[var(--app-shadow-border)]' : 'text-[var(--app-text-muted)] hover:text-[var(--app-text)]'}`} aria-pressed={format === option} onclick={() => (format = option as typeof format)}>{option}</button>
      {/each}
    </div>
    {#if format === 'hex'}
      <div class={`grid gap-1.5 ${alpha ? 'grid-cols-[minmax(0,1fr)_76px]' : 'grid-cols-1'}`}><Input class="h-7 font-mono text-ui-md uppercase md:text-ui-md" value={previewColor} aria-label={m['design.hex_color']()} onchange={(event: Event) => commit((event.currentTarget as HTMLInputElement).value)} />{#if alpha}<DesignNumericInput label={m['design.alpha_short']()} value={Math.round(opacity * 100)} min={0} max={100} onCommit={(value) => { if (value !== null) commit(previewColor, value / 100); }} />{/if}</div>
    {:else if format === 'rgb'}
      {@const rgb = designHexToRgb(previewColor)}
      <div class={`grid gap-1 ${alpha ? 'grid-cols-4' : 'grid-cols-3'}`}><DesignNumericInput label={m['design.red_short']()} value={rgb.r} min={0} max={255} onCommit={(value) => { if (value !== null) updateRgb('r', value); }} /><DesignNumericInput label={m['design.green_short']()} value={rgb.g} min={0} max={255} onCommit={(value) => { if (value !== null) updateRgb('g', value); }} /><DesignNumericInput label={m['design.blue_short']()} value={rgb.b} min={0} max={255} onCommit={(value) => { if (value !== null) updateRgb('b', value); }} />{#if alpha}<DesignNumericInput label={m['design.alpha_short']()} value={Math.round(opacity * 100)} min={0} max={100} onCommit={(value) => { if (value !== null) commit(previewColor, value / 100); }} />{/if}</div>
    {:else}
      <div class={`grid gap-1 ${alpha ? 'grid-cols-4' : 'grid-cols-3'}`}><DesignNumericInput label={m['design.hue_short']()} value={hsl.h} min={0} max={360} onCommit={(value) => { if (value !== null) updateHsl('h', value); }} /><DesignNumericInput label={m['design.saturation_short']()} value={hsl.s} min={0} max={100} onCommit={(value) => { if (value !== null) updateHsl('s', value); }} /><DesignNumericInput label={m['design.lightness_short']()} value={hsl.l} min={0} max={100} onCommit={(value) => { if (value !== null) updateHsl('l', value); }} />{#if alpha}<DesignNumericInput label={m['design.alpha_short']()} value={Math.round(opacity * 100)} min={0} max={100} onCommit={(value) => { if (value !== null) commit(previewColor, value / 100); }} />{/if}</div>
    {/if}
    {#if recentColors.length}{@render swatches(m['design.recent_colors'](), recentColors)}{/if}
    {#if documentColors.length}{@render swatches(m['design.document_colors'](), documentColors.slice(0, 24))}{/if}
    {#if variables.length && onBindVariable}
      <div class="space-y-1.5"><p class="section-label">{m['design.color_variables']()}</p><div class="max-h-28 space-y-0.5 overflow-y-auto">{#each variables as variable}<button type="button" class="flex h-7 w-full items-center gap-2 rounded-md px-1.5 text-left transition-colors duration-150 hover:bg-[var(--app-hover)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--app-accent)]" aria-label={m['design.bind_color_variable']({ name: variable.name })} onclick={() => onBindVariable?.(variable.id)}><span class="size-4 shrink-0 rounded-[4px] shadow-[inset_0_0_0_1px_rgb(0_0_0/0.14)]" style:background={variable.color}></span><span class="min-w-0 flex-1 truncate text-ui-sm">{variable.name}</span><Variable size={12} class="shrink-0 text-[var(--app-text-muted)]" /></button>{/each}</div></div>
    {/if}
  </Popover.Content>
</Popover.Root>

<style>
  /* Xadrez neutro so aparece atras de cores translucidas. */
  .design-checker {
    background-color: #fff;
    background-image:
      linear-gradient(45deg, #d4d4d8 25%, transparent 25%),
      linear-gradient(-45deg, #d4d4d8 25%, transparent 25%),
      linear-gradient(45deg, transparent 75%, #d4d4d8 75%),
      linear-gradient(-45deg, transparent 75%, #d4d4d8 75%);
    background-size: 8px 8px;
    background-position: 0 0, 0 4px, 4px -4px, -4px 0;
  }
</style>
