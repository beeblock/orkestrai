<script lang="ts">
  import { tick } from 'svelte';
  import { AtSign } from '@lucide/svelte';
  import { Button } from '$lib/components/ui/button';
  import { Textarea } from '$lib/components/ui/textarea';
  import * as m from '$lib/paraglide/messages.js';

  let { value, references, maxlength = 50000, onChange }: { value: string; references: Array<{ alias: string; name: string; version: number }>; maxlength?: number; onChange: (value: string) => void } = $props();
  let input = $state<HTMLTextAreaElement | null>(null), open = $state(false), query = $state(''), active = $state(0), start = $state(-1);
  const componentId = $props.id();
  const listId = `${componentId}-references`;
  const filtered = $derived(references.filter(reference => `${reference.alias} ${reference.name}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())));
  function detect() {
    const before = input?.value.slice(0, input.selectionStart) ?? '';
    const match = /(?:^|\s)@([\w]*)$/.exec(before);
    open = Boolean(match && references.length); query = match?.[1] ?? ''; active = 0;
    start = match ? before.length - match[1].length - 1 : -1;
  }
  async function insert(alias: string) {
    if (!input) return;
    const text = `@{${alias}} `, end = input.selectionStart, from = start >= 0 ? start : end;
    const next = value.slice(0, from) + text + value.slice(end);
    if (next.length > maxlength) return;
    onChange(next); open = false; start = -1;
    await tick(); input.focus(); input.setSelectionRange(from + text.length, from + text.length);
  }
  function key(event: KeyboardEvent) {
    if (!open || event.isComposing) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); open = false; }
    else if (filtered.length && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
      event.preventDefault(); active = (active + (event.key === 'ArrowDown' ? 1 : -1) + filtered.length) % filtered.length;
      void tick().then(() => document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: 'nearest' }));
    }
    else if (filtered.length && event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); void insert(filtered[active].alias); }
  }
</script>

<div class="min-w-0 space-y-1 text-xs">
  <div class="flex items-center justify-between"><label for={`${listId}-input`}>{m['creative.prompt']()}</label><Button size="icon-sm" variant="ghost" disabled={!references.length} aria-label={m['creative.reference_insert']()} title={m['creative.reference_insert']()} onclick={() => { start = -1; query = ''; active = 0; open = !open; }}><AtSign size={14} /></Button></div>
  <Textarea id={`${listId}-input`} bind:ref={input} {value} {maxlength} class="min-h-28 resize-y text-sm" aria-controls={open ? listId : undefined} aria-activedescendant={open && filtered.length ? `${listId}-${active}` : undefined} oninput={(event: Event & { currentTarget: HTMLTextAreaElement }) => { onChange(event.currentTarget.value); detect(); }} onkeydown={key} onblur={(event: FocusEvent) => { if (!(event.relatedTarget instanceof HTMLElement) || !event.relatedTarget.closest(`[id="${listId}"]`)) open = false; }} />
  {#if open}<div id={listId} role="listbox" aria-label={m['creative.reference_insert']()} class="max-h-44 overflow-y-auto overscroll-contain rounded-md border border-[var(--app-border)] bg-[var(--app-surface-raised)] p-1">
    {#each filtered as reference, index (reference.alias)}<Button id={`${listId}-${index}`} role="option" aria-selected={active === index} variant="ghost" class="h-auto min-h-9 w-full justify-start whitespace-normal text-left data-[active=true]:bg-[var(--app-border)]" data-active={active === index} onpointerdown={(event: PointerEvent) => event.preventDefault()} onclick={() => insert(reference.alias)}><span class="min-w-0 break-words">{reference.name} · v{reference.version}</span></Button>{/each}
    {#if !filtered.length}<p class="p-2 text-[var(--app-text-muted)]">{m['creative.no_inputs']()}</p>{/if}
  </div>{/if}
</div>
