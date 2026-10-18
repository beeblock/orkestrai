<script lang="ts">
  import type { NodeProps } from '@xyflow/svelte';
  import { CalendarDays, ChevronDown, ChevronUp, Plus, Trash2, X } from '@lucide/svelte';
  import NodeShell from './NodeShell.svelte';
  import HeaderIconButton from './HeaderIconButton.svelte';
  import { Input } from '$lib/components/ui/input';
  import { Switch } from '$lib/components/ui/switch';
  import { Textarea } from '$lib/components/ui/textarea';
  import { getLocale } from '$lib/paraglide/runtime.js';
  import type { CalendarEvent, CalendarNodePayload } from '$lib/modules/agent-room/domain/types.js';
  import * as m from '$lib/paraglide/messages.js';

  export type CalendarNodeData = {
    title: string;
    payload: CalendarNodePayload;
    onDelete: (id: string) => void;
    onResize?: (id: string, params: { x: number; y: number; width: number; height: number }) => void;
    onPayloadChange?: (id: string, partial: Record<string, unknown>) => void | Promise<void>;
    onRename?: (id: string, title: string) => void;
    onJumpToNode?: (nodeId: string) => void;
    onRemoveConnection?: (edgeId: string) => void;
    connections?: import('./NodeShell.svelte').NodeConnection[];
  };

  let { id, data, selected } = $props<NodeProps & { data: CalendarNodeData }>();

  const COLORS = ['#e8b84a', '#f0883e', '#e5646c', '#f29bc0', '#b6a2ff', '#7cbff0', '#5fd2c2', '#8fd18b'];

  let events = $state<CalendarEvent[]>([...(data.payload.events ?? [])]);
  const today = new Date();
  let cursor = $state(new Date(today.getFullYear(), today.getMonth(), 1));
  let editor = $state<{ event: CalendarEvent; isNew: boolean } | null>(null);

  const mondayFirst = getLocale() !== 'en';
  const iso = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const todayIso = iso(today);

  const monthLabel = $derived.by(() => {
    const label = new Intl.DateTimeFormat(getLocale(), { month: 'long', year: 'numeric' }).format(cursor);
    return label.charAt(0).toLocaleUpperCase() + label.slice(1);
  });
  const weekdays = $derived.by(() => {
    const base = new Date(2024, 0, mondayFirst ? 1 : 7);
    return Array.from({ length: 7 }, (_, index) => new Intl.DateTimeFormat(getLocale(), { weekday: 'short' }).format(new Date(base.getFullYear(), base.getMonth(), base.getDate() + index)).replace('.', ''));
  });
  const cells = $derived.by(() => {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const offset = (first.getDay() - (mondayFirst ? 1 : 0) + 7) % 7;
    const start = new Date(first.getFullYear(), first.getMonth(), 1 - offset);
    return Array.from({ length: 42 }, (_, index) => {
      const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + index);
      const key = iso(date);
      return { key, day: date.getDate(), inMonth: date.getMonth() === cursor.getMonth(), events: events.filter((event) => event.date === key).sort((a, b) => (a.time ?? '').localeCompare(b.time ?? '')) };
    });
  });

  function shift(months: number) {
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + months, 1);
  }

  function save(next: CalendarEvent[]) {
    events = next;
    void data.onPayloadChange?.(id, { events: next });
  }

  function openNew(date: string) {
    editor = { isNew: true, event: { id: crypto.randomUUID(), title: '', date, allDay: true, time: null, color: COLORS[0], notes: null } };
  }

  function commit() {
    if (!editor) return;
    const event = { ...editor.event, title: editor.event.title.trim().slice(0, 160) };
    if (!event.title || !/^\d{4}-\d{2}-\d{2}$/.test(event.date)) return;
    if (event.allDay) event.time = null;
    save(editor.isNew ? [...events, event] : events.map((item) => (item.id === event.id ? event : item)));
    editor = null;
  }

  function removeEvent() {
    if (!editor) return;
    const targetId = editor.event.id;
    save(events.filter((item) => item.id !== targetId));
    editor = null;
  }
</script>

<NodeShell
  {id}
  {selected}
  class="canvas-calendar"
  accent="var(--app-secondary)"
  minWidth={360}
  minHeight={300}
  onResize={data.onResize}
  connections={data.connections ?? []}
  titleText={data.title || m['calendar.title']()}
  onRename={data.onRename}
  onJumpToNode={data.onJumpToNode}
  onRemoveConnection={data.onRemoveConnection}
>
  {#snippet icon()}<CalendarDays size={13} />{/snippet}
  {#snippet title()}{data.title || m['calendar.title']()}{/snippet}
  {#snippet actions()}
    <HeaderIconButton class="node-action-btn" label={m['calendar.remove']()} danger onclick={() => data.onDelete(id)}><X size={13} /></HeaderIconButton>
  {/snippet}

  <div class="calendar nodrag nowheel" data-testid="calendar-node">
    <div class="month-head">
      <b class="month">{monthLabel}</b>
      <span class="grow"></span>
      <button type="button" class="new" onclick={() => openNew(cursor.getMonth() === today.getMonth() && cursor.getFullYear() === today.getFullYear() ? todayIso : iso(cursor))}><Plus size={12} />{m['calendar.new']()}</button>
      <button type="button" class="ghost" onclick={() => (cursor = new Date(today.getFullYear(), today.getMonth(), 1))}>{m['calendar.today']()}</button>
      <button type="button" class="nav" aria-label={m['calendar.prev']()} onclick={() => shift(-1)}><ChevronUp size={14} /></button>
      <button type="button" class="nav" aria-label={m['calendar.next']()} onclick={() => shift(1)}><ChevronDown size={14} /></button>
    </div>
    <div class="grid">
      {#each weekdays as weekday (weekday)}<span class="wd">{weekday}</span>{/each}
      {#each cells as cell (cell.key)}
        <div class="cell" class:out={!cell.inMonth} class:today={cell.key === todayIso} role="button" tabindex="0" ondblclick={() => openNew(cell.key)} onkeydown={(event) => { if (event.key === 'Enter') openNew(cell.key); }}>
          <span class="day">{cell.day}</span>
          {#each cell.events.slice(0, 2) as event (event.id)}
            <button type="button" class="event" style:--event={event.color ?? COLORS[0]} title={event.title} onclick={(clickEvent) => { clickEvent.stopPropagation(); editor = { isNew: false, event: { ...event } }; }}>{event.time ? `${event.time} ` : ''}{event.title}</button>
          {/each}
          {#if cell.events.length > 2}<span class="more">{m['calendar.more']({ count: cell.events.length - 2 })}</span>{/if}
        </div>
      {/each}
    </div>

    {#if editor}
      <div class="editor" role="dialog" aria-label={m['calendar.event_title']()}>
        <Input class="h-8" bind:value={editor.event.title} placeholder={m['calendar.event_title']()} aria-label={m['calendar.event_title']()} maxlength={160} onkeydown={(event: KeyboardEvent) => { if (event.key === 'Enter') commit(); if (event.key === 'Escape') editor = null; }} />
        <div class="row">
          <Input class="h-8" type="date" bind:value={editor.event.date} aria-label={m['calendar.date']()} />
          {#if !editor.event.allDay}<Input class="h-8 w-28" type="time" bind:value={editor.event.time} aria-label={m['calendar.time']()} />{/if}
        </div>
        <label class="row switch-row"><span>{m['calendar.all_day']()}</span><Switch bind:checked={editor.event.allDay} aria-label={m['calendar.all_day']()} /></label>
        <div class="colors" role="radiogroup" aria-label={m['calendar.color']()}>
          {#each COLORS as color (color)}
            <button type="button" role="radio" aria-checked={editor.event.color === color} aria-label={color} class="color" class:on={editor.event.color === color} style:--event={color} onclick={() => editor && (editor.event.color = color)}></button>
          {/each}
        </div>
        <Textarea class="min-h-14 text-xs" bind:value={editor.event.notes} placeholder={m['calendar.notes']()} aria-label={m['calendar.notes']()} />
        <div class="row end">
          {#if !editor.isNew}<button type="button" class="ghost danger" onclick={removeEvent}><Trash2 size={12} />{m['calendar.delete_event']()}</button>{/if}
          <span class="grow"></span>
          <button type="button" class="ghost" onclick={() => (editor = null)}>{m['calendar.cancel']()}</button>
          <button type="button" class="new" disabled={!editor.event.title.trim()} onclick={commit}>{editor.isNew ? m['calendar.add_event']() : m['calendar.save_event']()}</button>
        </div>
      </div>
    {/if}
  </div>
</NodeShell>

<style>
  .calendar {
    position: relative;
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    padding: 8px 10px 10px;
    gap: 8px;
  }

  .month-head {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .month {
    font-size: 14px;
    font-weight: 650;
  }

  .grow {
    flex: 1;
  }

  .new {
    height: 24px;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 0 9px;
    border: 0;
    border-radius: 999px;
    background: var(--app-accent);
    color: var(--app-accent-contrast);
    font-size: 11.5px;
    font-weight: 600;
  }

  .new:disabled {
    opacity: 0.5;
  }

  .ghost {
    height: 24px;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 0 8px;
    border: 0;
    border-radius: 7px;
    background: transparent;
    color: var(--app-text-soft);
    font-size: 11.5px;
  }

  .ghost:hover {
    background: var(--app-hover);
    color: var(--app-text);
  }

  .ghost.danger:hover {
    color: var(--app-danger);
  }

  .nav {
    width: 24px;
    height: 24px;
    display: grid;
    place-items: center;
    border: 0;
    border-radius: 7px;
    background: transparent;
    color: var(--app-text-muted);
  }

  .nav:hover {
    background: var(--app-hover);
    color: var(--app-text);
  }

  .grid {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: repeat(7, minmax(0, 1fr));
    grid-template-rows: auto repeat(6, minmax(0, 1fr));
    gap: 2px;
  }

  .wd {
    padding: 2px 4px 4px;
    color: var(--app-text-muted);
    font-size: 11px;
    text-transform: capitalize;
  }

  .cell {
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 3px;
    border-radius: 7px;
    background: color-mix(in srgb, var(--app-text) 3%, transparent);
    overflow: hidden;
    cursor: default;
  }

  .cell:hover {
    background: var(--app-hover);
  }

  .cell.out {
    opacity: 0.4;
  }

  .day {
    align-self: flex-start;
    min-width: 20px;
    height: 20px;
    padding: 0 4px;
    display: grid;
    place-items: center;
    border-radius: 10px;
    color: var(--app-text-soft);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
  }

  .today .day {
    background: var(--app-accent);
    color: var(--app-accent-contrast);
    font-weight: 700;
  }

  .event {
    width: 100%;
    padding: 1px 5px;
    border: 0;
    border-radius: 5px;
    background: color-mix(in srgb, var(--event) 22%, transparent);
    color: color-mix(in srgb, var(--event) 70%, var(--app-text));
    font-size: 11px;
    text-align: left;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .more {
    color: var(--app-text-muted);
    font-size: 11px;
  }

  .editor {
    position: absolute;
    top: 40px;
    left: 50%;
    width: min(290px, calc(100% - 20px));
    transform: translateX(-50%);
    z-index: 3;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px;
    border-radius: 14px;
    background: var(--app-glass-strong);
    -webkit-backdrop-filter: blur(22px) saturate(170%);
    backdrop-filter: blur(22px) saturate(170%);
    border: 1px solid var(--app-glass-line);
    box-shadow: var(--app-glass-shadow);
    animation: editor-in var(--duration-fast) var(--ease-smooth-out);
  }

  @keyframes editor-in {
    from { opacity: 0; transform: translate(-50%, 6px); }
  }

  .row {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .switch-row {
    justify-content: space-between;
    color: var(--app-text-soft);
    font-size: 12px;
  }

  .colors {
    display: flex;
    gap: 6px;
  }

  .color {
    width: 18px;
    height: 18px;
    border: 0;
    border-radius: 50%;
    background: var(--event);
  }

  .color.on {
    box-shadow: 0 0 0 2px var(--app-surface), 0 0 0 4px var(--event);
  }

  button:focus-visible,
  .cell:focus-visible {
    outline: 2px solid var(--app-accent);
    outline-offset: 1px;
  }
</style>
