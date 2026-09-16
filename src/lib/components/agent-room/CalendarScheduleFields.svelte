<script lang="ts">
  import { Input } from '$lib/components/ui/input';
  import { Checkbox } from '$lib/components/ui/checkbox';
  import * as Select from '$lib/components/ui/select';
  import ModelCombobox from './canvas/ModelCombobox.svelte';
  import type { CalendarSchedule } from '$lib/modules/agent-room/contracts/schemas/calendar-schedule.schema.js';
  import * as m from '$lib/paraglide/messages.js';
  import { getLocale } from '$lib/paraglide/runtime.js';
  let { value = $bindable() }: { value: CalendarSchedule } = $props();
  const text = m as unknown as Record<string, () => string>;
  const zones = ['UTC', ...Intl.supportedValuesOf('timeZone')].map(value => ({ value, label: value }));
  const frequencies = ['once', 'daily', 'weekly', 'monthly'] as const;
  function dayLabel(day: number) { return new Intl.DateTimeFormat(getLocale(), { weekday: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, 8, 13 + day))); }
</script>
<div class="grid min-w-0 gap-3 sm:grid-cols-2" data-testid="calendar-schedule-fields">
  <label class="min-w-0 space-y-1 text-xs"><span>{text['companion.frequency']()}</span><Select.Root type="single" value={value.frequency} onValueChange={(frequency: string) => value = { ...value, frequency: frequency as CalendarSchedule['frequency'], weekdays: value.weekdays ?? [1], dayOfMonth: value.dayOfMonth ?? 1 }}><Select.Trigger class="w-full">{text[`companion.${value.frequency}`]()}</Select.Trigger><Select.Content>{#each frequencies as frequency}<Select.Item value={frequency}>{text[`companion.${frequency}`]()}</Select.Item>{/each}</Select.Content></Select.Root></label>
  <label class="min-w-0 space-y-1 text-xs"><span>{text['companion.time']()}</span><Input type="time" name="schedule-time" bind:value={value.time} required /></label>
  <div class="min-w-0 space-y-1 text-xs"><span>{text['companion.timezone']()}</span><ModelCombobox value={value.timeZone} options={zones} defaultLabel="UTC" searchPlaceholder={text['companion.timezone']()} emptyLabel={text['companion.no_results']()} ariaLabel={text['companion.timezone']()} onValueChange={timeZone => value = { ...value, timeZone: timeZone || 'UTC' }} /></div>
  {#if value.frequency === 'once'}<label class="space-y-1 text-xs"><span>{text['companion.date']()}</span><Input type="date" name="schedule-date" bind:value={value.date} required /></label>{/if}
  {#if value.frequency === 'monthly'}<label class="space-y-1 text-xs"><span>{text['companion.day']()}</span><Select.Root type="single" value={String(value.dayOfMonth ?? 1)} onValueChange={day => value = { ...value, dayOfMonth: Number(day) }}><Select.Trigger class="w-full">{value.dayOfMonth ?? 1}</Select.Trigger><Select.Content>{#each Array.from({ length: 31 }, (_, i) => i + 1) as day}<Select.Item value={String(day)}>{day}</Select.Item>{/each}</Select.Content></Select.Root></label>{/if}
  {#if value.frequency === 'weekly'}<fieldset class="flex flex-wrap items-center gap-3 sm:col-span-2"><legend class="mb-2 text-xs">{text['companion.weekdays']()}</legend>{#each [1,2,3,4,5,6,0] as day}<label class="flex items-center gap-1.5 text-xs"><Checkbox checked={value.weekdays?.includes(day) ?? false} onCheckedChange={(checked: boolean) => value = { ...value, weekdays: checked ? [...(value.weekdays ?? []), day].sort() : (value.weekdays ?? []).filter(d => d !== day) }} />{dayLabel(day)}</label>{/each}</fieldset>{/if}
  <label class="min-w-0 space-y-1 text-xs"><span>{text['companion.missed']()}</span><Select.Root type="single" value={value.missed} onValueChange={missed => value = { ...value, missed: missed as CalendarSchedule['missed'] }}><Select.Trigger class="w-full">{text[`companion.${value.missed}`]()}</Select.Trigger><Select.Content><Select.Item value="skip">{text['companion.skip']()}</Select.Item><Select.Item value="latest">{text['companion.latest']()}</Select.Item></Select.Content></Select.Root></label>
  {#if value.missed === 'latest'}<label class="space-y-1 text-xs"><span>{text['companion.lateness']()}</span><Select.Root type="single" value={String(value.maxLatenessMinutes)} onValueChange={minutes => value = { ...value, maxLatenessMinutes: Number(minutes) }}><Select.Trigger class="w-full">{value.maxLatenessMinutes}</Select.Trigger><Select.Content>{#each [...new Set([15,60,360,1440,10080,value.maxLatenessMinutes])].sort((a,b)=>a-b) as minutes}<Select.Item value={String(minutes)}>{minutes}</Select.Item>{/each}</Select.Content></Select.Root></label>{/if}
</div>
