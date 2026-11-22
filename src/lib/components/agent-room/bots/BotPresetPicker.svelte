<script lang="ts">
  import { Bot, Headphones, Handshake, CalendarDays, Search, ChartNoAxesCombined, CodeXml, Server,
    PenLine, Megaphone, GraduationCap, Heart, Wallet, Plane, Users, Palette, Check } from '@lucide/svelte';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { listBotPresets } from '$lib/modules/agent-room/domain/bot-presets.js';
  import type { BotPresetId } from '$lib/modules/agent-room/domain/bot-preset-types.js';
  import { getLocale } from '$lib/paraglide/runtime.js';
  import * as m from '$lib/paraglide/messages.js';

  let { value, onValueChange }: { value: BotPresetId | 'custom'; onValueChange: (id: BotPresetId | 'custom') => void } = $props();
  let query = $state('');
  const presets = $derived(listBotPresets(getLocale()));
  const visible = $derived(presets.filter(item => `${item.name} ${item.description}`.toLocaleLowerCase(getLocale()).includes(query.trim().toLocaleLowerCase(getLocale()))));
  const icons = { assistant: Bot, support: Headphones, sales: Handshake, calendar: CalendarDays, research: Search,
    reports: ChartNoAxesCombined, developer: CodeXml, devops: Server, writer: PenLine, social: Megaphone,
    teacher: GraduationCap, coach: Heart, finance: Wallet, travel: Plane, community: Users, creative: Palette };
</script>

<div class="flex min-h-0 flex-col gap-3 border-b border-[var(--app-border)] bg-[var(--app-bg)]/40 p-4 md:border-r md:border-b-0" data-testid="bot-preset-picker">
  <div class="flex items-center justify-between gap-2">
    <h3 class="text-sm font-medium">{m['bots.preset_heading']()}</h3>
    <span class="text-xs tabular-nums text-[var(--app-text-muted)]">{presets.length}</span>
  </div>
  <Input type="search" bind:value={query} placeholder={m['bots.preset_search']()} aria-label={m['bots.preset_search']()} />
  <div class="grid max-h-[200px] min-h-0 grid-cols-2 content-start gap-1.5 overflow-y-auto pr-1 md:max-h-none md:flex-1 md:grid-cols-1" role="group" aria-label={m['bots.preset_heading']()}>
    {#each visible as preset (preset.id)}
      {@const Icon = icons[preset.id]}
      <Button type="button" variant={value === preset.id ? 'secondary' : 'ghost'}
        class="h-auto min-h-14 items-start justify-start gap-2.5 whitespace-normal px-2.5 py-2.5 text-left"
        aria-label={preset.name} aria-pressed={value === preset.id} onclick={() => onValueChange(preset.id)}>
        <Icon class="mt-0.5 size-4 shrink-0 text-[var(--app-text-muted)]" />
        <span class="min-w-0 flex-1"><span class="block text-sm leading-snug">{preset.name}</span>
          <span class="mt-1 block text-xs leading-relaxed font-normal text-[var(--app-text-muted)]">{preset.description}</span></span>
        {#if value === preset.id}<Check class="mt-0.5 size-3.5 shrink-0" />{/if}
      </Button>
    {/each}
    {#if !visible.length}<p class="col-span-full p-2 text-xs leading-relaxed text-[var(--app-text-muted)]">{m['bots.preset_empty']()}</p>{/if}
  </div>
  <Button type="button" variant={value === 'custom' ? 'secondary' : 'outline'} class="h-auto justify-start gap-2 whitespace-normal py-2"
    aria-pressed={value === 'custom'} onclick={() => onValueChange('custom')}><PenLine size={15} />{m['bots.preset_custom']()}</Button>
  <p class="text-xs leading-relaxed text-[var(--app-text-muted)]">{m['bots.preset_replace_hint']()}</p>
</div>
