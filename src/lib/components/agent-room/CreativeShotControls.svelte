<script lang="ts">
  import { Expand, Accessibility, UserRound, ContactRound, Focus, SlidersHorizontal, Info } from '@lucide/svelte';
  import * as RadioGroup from '$lib/components/ui/radio-group';
  import ModelCombobox from './canvas/ModelCombobox.svelte';
  import { shotDirectionSchema, type ShotDirection } from '$lib/modules/creative-media/domain/shot-direction.js';
  import * as m from '$lib/paraglide/messages.js';
  let { value, disabled = false, onChange }: { value: ShotDirection; disabled?: boolean; onChange: (value: ShotDirection) => void } = $props();
  const id = $props.id();
  const frames = $derived([
    { key: 'custom', label: m['creative_shot.custom'](), icon: SlidersHorizontal },
    { key: 'wide', label: m['creative_shot.wide'](), icon: Expand },
    { key: 'full', label: m['creative_shot.full'](), icon: Accessibility },
    { key: 'medium', label: m['creative_shot.medium'](), icon: UserRound },
    { key: 'close_up', label: m['creative_shot.close_up'](), icon: ContactRound },
    { key: 'detail', label: m['creative_shot.detail'](), icon: Focus },
  ]);
  const angles = $derived([{ value: 'eye_level', label: m['creative_shot.eye_level']() }, { value: 'low', label: m['creative_shot.low']() }, { value: 'high', label: m['creative_shot.high']() }, { value: 'overhead', label: m['creative_shot.overhead']() }]);
  const motions = $derived([{ value: 'static', label: m['creative_shot.static']() }, { value: 'push_in', label: m['creative_shot.push_in']() }, { value: 'pull_out', label: m['creative_shot.pull_out']() }, { value: 'pan_left', label: m['creative_shot.pan_left']() }, { value: 'pan_right', label: m['creative_shot.pan_right']() }, { value: 'orbit', label: m['creative_shot.orbit']() }, { value: 'tracking', label: m['creative_shot.tracking']() }]);
  const paces = $derived([{ value: 'gentle', label: m['creative_shot.gentle']() }, { value: 'normal', label: m['creative_shot.normal']() }, { value: 'energetic', label: m['creative_shot.energetic']() }]);
  function change(field: keyof ShotDirection, next: string) { onChange(shotDirectionSchema.parse({ ...value, [field]: next })); }
</script>
<fieldset disabled={disabled} class="min-w-0 space-y-3" data-testid="creative-shot-controls">
  <legend class="mb-2 flex items-center gap-2 text-xs font-medium">{m['creative_shot.title']()}<span class="text-muted-foreground" title={m['creative_shot.intent']()} aria-label={m['creative_shot.intent']()}><Info size={13} /></span></legend>
  <RadioGroup.Root value={value.framing} onValueChange={(next) => change('framing', next)} disabled={disabled} class="grid grid-cols-3 gap-2" aria-label={m['creative_shot.framing']()}>
    {#each frames as frame}<div class="relative"><RadioGroup.Item id={`${id}-${frame.key}`} value={frame.key} class="peer absolute inset-0 z-10 h-full w-full rounded opacity-0 after:hidden" /><label for={`${id}-${frame.key}`} class="pointer-events-none flex h-16 cursor-pointer flex-col items-center justify-center gap-1 rounded border border-[var(--app-border)] bg-[var(--app-panel)] text-center text-[11px] text-[var(--app-text-soft)] peer-aria-checked:border-[var(--app-accent)] peer-aria-checked:bg-[var(--app-hover)] peer-aria-checked:text-[var(--app-text)] peer-focus-visible:outline-2 peer-focus-visible:outline-[var(--app-accent)] peer-disabled:cursor-default peer-disabled:opacity-50"><frame.icon size={20} /><span>{frame.label}</span></label></div>{/each}
  </RadioGroup.Root>
  <div class="grid min-w-0 grid-cols-1 gap-2 @lg:grid-cols-3">
    <div class="min-w-0 space-y-1"><span class="text-xs text-muted-foreground">{m['creative_shot.angle']()}</span><ModelCombobox value={value.angle} options={angles} defaultLabel={m['creative_shot.eye_level']()} searchPlaceholder={m['creative.search_media']()} emptyLabel={m['creative.no_inputs']()} ariaLabel={m['creative_shot.angle']()} fieldProps={{ disabled }} onValueChange={(next) => change('angle', next || 'eye_level')} /></div>
    <div class="min-w-0 space-y-1"><span class="text-xs text-muted-foreground">{m['creative_shot.motion']()}</span><ModelCombobox value={value.motion === 'none' ? '' : value.motion} options={motions} defaultLabel={m['creative_shot.custom']()} searchPlaceholder={m['creative.search_media']()} emptyLabel={m['creative.no_inputs']()} ariaLabel={m['creative_shot.motion']()} fieldProps={{ disabled }} onValueChange={(next) => change('motion', next || 'none')} /></div>
    <div class="min-w-0 space-y-1"><span class="text-xs text-muted-foreground">{m['creative_shot.pace']()}</span><ModelCombobox value={value.pace} options={paces} defaultLabel={m['creative_shot.gentle']()} searchPlaceholder={m['creative.search_media']()} emptyLabel={m['creative.no_inputs']()} ariaLabel={m['creative_shot.pace']()} fieldProps={{ disabled }} onValueChange={(next) => change('pace', next || 'gentle')} /></div>
  </div>
</fieldset>
