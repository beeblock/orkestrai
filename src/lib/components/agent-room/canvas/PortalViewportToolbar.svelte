<script lang="ts">
  import { Maximize2, MonitorSmartphone, Ruler, RotateCw } from '@lucide/svelte';
  import HeaderIconButton from './HeaderIconButton.svelte';
  import {
    clampPortalViewportDimension,
    findPortalDevicePreset,
    PORTAL_DEVICE_PRESETS,
    PORTAL_VIEWPORT_MAX,
    PORTAL_VIEWPORT_MIN,
    swapPortalViewportOrientation,
    type PortalViewport,
  } from './portal-device-presets.js';
  import { Input } from '$lib/components/ui/input';
  import { Slider } from '$lib/components/ui/slider';
  import * as Popover from '$lib/components/ui/popover';
  import * as Select from '$lib/components/ui/select';
  import * as m from '$lib/paraglide/messages.js';

  type Props = {
    viewport: PortalViewport | null;
    onchange: (viewport: PortalViewport | null) => void;
  };

  let { viewport, onchange }: Props = $props();
  let widthDraft = $state('390');
  let heightDraft = $state('844');

  const matchedPreset = $derived.by(() => {
    if (!viewport) return null;
    const persisted = viewport.presetId ? findPortalDevicePreset(viewport.presetId) : undefined;
    if (persisted && (
      (persisted.width === viewport.width && persisted.height === viewport.height)
      || (persisted.width === viewport.height && persisted.height === viewport.width)
    )) return persisted;
    return PORTAL_DEVICE_PRESETS.find((preset) =>
      (preset.width === viewport!.width && preset.height === viewport!.height)
      || (preset.width === viewport!.height && preset.height === viewport!.width)
    ) ?? null;
  });

  const isPortraitPreset = $derived(Boolean(
    viewport
    && matchedPreset
    && matchedPreset.width === viewport.width
    && matchedPreset.height === viewport.height,
  ));
  const selectedPresetId = $derived(!viewport ? 'off' : isPortraitPreset ? matchedPreset?.id ?? 'custom' : 'custom');
  const selectedLabel = $derived(!viewport
    ? m['portal.device_off']()
    : matchedPreset
      ? `${matchedPreset.label}${isPortraitPreset ? '' : ` · ${m['portal.device_landscape']()}`}`
      : m['portal.device_custom']());

  $effect(() => {
    if (!viewport) return;
    widthDraft = String(viewport.width);
    heightDraft = String(viewport.height);
  });

  function applyPreset(value: string) {
    if (value === 'off') {
      onchange(null);
      return;
    }
    if (value === 'custom') {
      if (!viewport) onchange({ width: 390, height: 844 });
      return;
    }
    const preset = findPortalDevicePreset(value);
    if (preset) onchange({ width: preset.width, height: preset.height, presetId: preset.id });
  }

  function commitDimension(axis: 'width' | 'height') {
    if (!viewport) return;
    const raw = Number(axis === 'width' ? widthDraft : heightDraft);
    const value = clampPortalViewportDimension(raw);
    onchange(axis === 'width'
      ? { width: value, height: viewport.height }
      : { width: viewport.width, height: value });
  }

  // Slider so move o rascunho; a dimensao e aplicada (e persistida) ao soltar, pelo mesmo commitDimension.
  function sliderValue(draft: string): number {
    return clampPortalViewportDimension(Number(draft));
  }

  function commitOnEnter(event: KeyboardEvent, axis: 'width' | 'height') {
    if (event.key !== 'Enter') return;
    commitDimension(axis);
    (event.currentTarget as HTMLInputElement).select();
  }
</script>

<div
  class="nodrag flex h-10 shrink-0 items-center gap-1 border-b border-[var(--app-border)] bg-[var(--app-surface)] px-2"
  role="toolbar"
  aria-label={m['portal.device_toolbar_show']()}
  data-testid="portal-viewport-toolbar"
>
  <Select.Root type="single" value={selectedPresetId} onValueChange={applyPreset}>
    <Select.Trigger
      class="h-7 min-w-0 flex-1 border-transparent bg-[var(--app-surface-subtle)] px-2 text-ui-md shadow-[var(--app-shadow-border)] transition-[box-shadow,background-color] duration-150 hover:shadow-[var(--app-shadow-border-hover)]"
      size="sm"
      aria-label={m['portal.device_preset']()}
    >
      <span class="flex min-w-0 items-center gap-1.5">
        <MonitorSmartphone class="size-3.5 shrink-0 text-[var(--app-text-muted)]" />
        <span class="truncate">{selectedLabel}</span>
      </span>
    </Select.Trigger>
    <Select.Content class="max-h-80 min-w-[280px] p-1" align="start" sideOffset={6}>
      <Select.Item value="off" class="py-1.5">
        <div class="flex min-w-0 flex-1 items-center justify-between gap-5">
          <span>{m['portal.device_off']()}</span>
          <span class="text-ui-xs text-[var(--app-text-muted)]">{m['portal.device_fill']()}</span>
        </div>
      </Select.Item>
      <Select.Separator />
      {#each PORTAL_DEVICE_PRESETS as preset (preset.id)}
        <Select.Item value={preset.id} class="py-1.5">
          <div class="flex min-w-0 flex-1 items-center justify-between gap-5">
            <span>{preset.label}</span>
            <span class="font-mono text-[10.5px] tabular-nums text-[var(--app-text-muted)]">{preset.width} × {preset.height}</span>
          </div>
        </Select.Item>
      {/each}
      <Select.Separator />
      <Select.Item value="custom" class="py-1.5">{m['portal.device_custom']()}</Select.Item>
    </Select.Content>
  </Select.Root>

  {#if viewport}
    <Popover.Root>
      <Popover.Trigger
        class="press ml-0.5 inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md bg-[var(--app-surface-subtle)] px-2 font-mono text-[11px] tabular-nums text-[var(--app-text)] shadow-[var(--app-shadow-border)] hover:shadow-[var(--app-shadow-border-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--app-accent)] data-[state=open]:shadow-[var(--app-shadow-border-hover)]"
        aria-label={m['portal.device_dimensions']({ width: viewport.width, height: viewport.height })}
      >
        <Ruler class="size-3 text-[var(--app-text-muted)]" />
        <span>{viewport.width} × {viewport.height}</span>
      </Popover.Trigger>
      <Popover.Content class="w-[min(18rem,calc(100vw-1.5rem))] gap-3 p-3" align="end" sideOffset={8}>
        <Popover.Header>
          <Popover.Title class="text-xs">{m['portal.device_custom']()}</Popover.Title>
        </Popover.Header>
        <!-- Cada eixo: numero exato + slider para arrastar a largura/altura. -->
        <div class="grid gap-4">
          <div class="grid gap-2">
            <label class="flex items-center justify-between gap-3 text-ui-sm font-medium text-[var(--app-text-soft)]">
              <span>{m['portal.device_width']()}</span>
              <span class="relative w-24 shrink-0">
                <Input
                  class="h-7 pr-7 text-xs tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                  type="number"
                  min={PORTAL_VIEWPORT_MIN}
                  max={PORTAL_VIEWPORT_MAX}
                  bind:value={widthDraft}
                  onblur={() => commitDimension('width')}
                  onkeydown={(event: KeyboardEvent) => commitOnEnter(event, 'width')}
                />
                <span class="pointer-events-none absolute inset-y-0 right-2 flex items-center text-ui-xs text-[var(--app-text-muted)]">px</span>
              </span>
            </label>
            <Slider
              type="single"
              min={PORTAL_VIEWPORT_MIN}
              max={PORTAL_VIEWPORT_MAX}
              step={1}
              value={sliderValue(widthDraft)}
              onValueChange={(value: number) => (widthDraft = String(value))}
              onValueCommit={() => commitDimension('width')}
              aria-label={m['portal.device_width']()}
            />
          </div>
          <div class="grid gap-2">
            <label class="flex items-center justify-between gap-3 text-ui-sm font-medium text-[var(--app-text-soft)]">
              <span>{m['portal.device_height']()}</span>
              <span class="relative w-24 shrink-0">
                <Input
                  class="h-7 pr-7 text-xs tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                  type="number"
                  min={PORTAL_VIEWPORT_MIN}
                  max={PORTAL_VIEWPORT_MAX}
                  bind:value={heightDraft}
                  onblur={() => commitDimension('height')}
                  onkeydown={(event: KeyboardEvent) => commitOnEnter(event, 'height')}
                />
                <span class="pointer-events-none absolute inset-y-0 right-2 flex items-center text-ui-xs text-[var(--app-text-muted)]">px</span>
              </span>
            </label>
            <Slider
              type="single"
              min={PORTAL_VIEWPORT_MIN}
              max={PORTAL_VIEWPORT_MAX}
              step={1}
              value={sliderValue(heightDraft)}
              onValueChange={(value: number) => (heightDraft = String(value))}
              onValueCommit={() => commitDimension('height')}
              aria-label={m['portal.device_height']()}
            />
          </div>
        </div>
      </Popover.Content>
    </Popover.Root>

    <HeaderIconButton class="node-action-btn" label={m['portal.device_rotate']()} onclick={() => onchange(swapPortalViewportOrientation(viewport!))}>
      <RotateCw size={13} />
    </HeaderIconButton>
    <HeaderIconButton class="node-action-btn" label={m['portal.device_off']()} onclick={() => onchange(null)}>
      <Maximize2 size={13} />
    </HeaderIconButton>
  {/if}
</div>
