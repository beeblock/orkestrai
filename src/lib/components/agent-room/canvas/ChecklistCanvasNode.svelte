<script lang="ts">
  import type { NodeProps } from '@xyflow/svelte';
  import { Check, ListChecks, Plus, X } from '@lucide/svelte';
  import NodeShell from './NodeShell.svelte';
  import HeaderIconButton from './HeaderIconButton.svelte';
  import type { ChecklistItem, ChecklistNodePayload } from '$lib/modules/agent-room/domain/types.js';
  import * as m from '$lib/paraglide/messages.js';

  export type ChecklistNodeData = {
    title: string;
    payload: ChecklistNodePayload;
    onDelete: (id: string) => void;
    onResize?: (id: string, params: { x: number; y: number; width: number; height: number }) => void;
    onPayloadChange?: (id: string, partial: Record<string, unknown>) => void | Promise<void>;
    onRename?: (id: string, title: string) => void;
    onJumpToNode?: (nodeId: string) => void;
    onRemoveConnection?: (edgeId: string) => void;
    connections?: import('./NodeShell.svelte').NodeConnection[];
  };

  let { id, data, selected } = $props<NodeProps & { data: ChecklistNodeData }>();

  let items = $state<ChecklistItem[]>([...(data.payload.items ?? [])]);
  let draft = $state('');
  const done = $derived(items.filter((item) => item.done).length);

  function save(next: ChecklistItem[]) {
    items = next;
    void data.onPayloadChange?.(id, { items: next });
  }

  function add() {
    const text = draft.trim();
    if (!text) return;
    save([...items, { id: crypto.randomUUID(), text: text.slice(0, 400), done: false }]);
    draft = '';
  }

  function toggle(itemId: string) {
    save(items.map((item) => (item.id === itemId ? { ...item, done: !item.done } : item)));
  }

  function remove(itemId: string) {
    save(items.filter((item) => item.id !== itemId));
  }
</script>

<NodeShell
  {id}
  {selected}
  class="canvas-checklist"
  accent="var(--app-success)"
  minWidth={240}
  minHeight={180}
  onResize={data.onResize}
  connections={data.connections ?? []}
  titleText={data.title || m['checklist.title']()}
  onRename={data.onRename}
  onJumpToNode={data.onJumpToNode}
  onRemoveConnection={data.onRemoveConnection}
>
  {#snippet icon()}<ListChecks size={13} />{/snippet}
  {#snippet title()}{data.title || m['checklist.title']()}{/snippet}
  {#snippet actions()}
    {#if items.length}<span class="progress-label">{m['checklist.progress']({ done, total: items.length })}</span>{/if}
    <HeaderIconButton class="node-action-btn" label={m['checklist.remove']()} danger onclick={() => data.onDelete(id)}><X size={13} /></HeaderIconButton>
  {/snippet}

  <div class="checklist nodrag nowheel" data-testid="checklist-node">
    {#if items.length}
      <div class="bar" aria-hidden="true"><span style:width={`${Math.round((done / items.length) * 100)}%`}></span></div>
    {/if}
    <ul>
      {#each items as item (item.id)}
        <li class:done={item.done}>
          <button type="button" class="box" role="checkbox" aria-checked={item.done} aria-label={item.text} onclick={() => toggle(item.id)}>
            {#if item.done}<Check size={12} strokeWidth={3} />{/if}
          </button>
          <span class="text">{item.text}</span>
          <button type="button" class="remove" aria-label={m['checklist.remove_item']()} onclick={() => remove(item.id)}><X size={12} /></button>
        </li>
      {:else}
        <li class="empty"><b>{m['checklist.empty']()}</b><span>{m['checklist.empty_body']()}</span></li>
      {/each}
    </ul>
    <form class="add" onsubmit={(event) => { event.preventDefault(); add(); }}>
      <Plus size={14} />
      <input bind:value={draft} placeholder={m['checklist.add']()} aria-label={m['checklist.add']()} maxlength="400" />
    </form>
    {#if done > 0}
      <button type="button" class="clear" onclick={() => save(items.filter((item) => !item.done))}>{m['checklist.clear_done']()}</button>
    {/if}
  </div>
</NodeShell>

<style>
  .progress-label {
    margin-right: 4px;
    color: var(--app-text-muted);
    font-family: var(--font-mono);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
  }

  .checklist {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    padding: 8px 10px 10px;
    gap: 6px;
  }

  .bar {
    height: 4px;
    border-radius: 2px;
    background: color-mix(in srgb, var(--app-text) 10%, transparent);
    overflow: hidden;
  }

  .bar span {
    display: block;
    height: 100%;
    border-radius: 2px;
    background: var(--app-success);
    transition: width var(--duration-medium) var(--ease-smooth-out);
  }

  ul {
    flex: 1;
    min-height: 0;
    margin: 0;
    padding: 0;
    list-style: none;
    overflow-y: auto;
  }

  li {
    display: flex;
    align-items: flex-start;
    gap: 9px;
    padding: 6px 4px;
    border-radius: 8px;
    transition: background-color var(--duration-quick) ease-out;
  }

  li:hover {
    background: var(--app-hover);
  }

  .box {
    width: 18px;
    height: 18px;
    flex: none;
    margin-top: 1px;
    display: grid;
    place-items: center;
    border: 1.5px solid var(--app-border-strong);
    border-radius: 5px;
    background: transparent;
    color: #08130d;
    transition: background-color var(--duration-quick) ease-out, border-color var(--duration-quick) ease-out, transform var(--duration-quick) var(--ease-bounce);
  }

  .done .box {
    border-color: var(--app-success);
    background: var(--app-success);
    transform: scale(1.04);
  }

  .text {
    flex: 1;
    min-width: 0;
    font-size: 13px;
    line-height: 1.45;
    overflow-wrap: anywhere;
    transition: color var(--duration-quick) ease-out;
  }

  .done .text {
    color: var(--app-text-muted);
    text-decoration: line-through;
  }

  .remove {
    width: 20px;
    height: 20px;
    display: grid;
    place-items: center;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--app-text-muted);
    opacity: 0;
  }

  li:hover .remove,
  .remove:focus-visible {
    opacity: 1;
  }

  .remove:hover {
    color: var(--app-danger);
  }

  .empty {
    flex-direction: column;
    gap: 2px;
    padding: 18px 6px;
    color: var(--app-text-muted);
    font-size: 12px;
    text-align: center;
  }

  .empty:hover {
    background: transparent;
  }

  .empty b {
    color: var(--app-text-soft);
    font-weight: 600;
  }

  .add {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 34px;
    padding: 0 10px;
    border-radius: 10px;
    border: 1px dashed var(--app-border-strong);
    color: var(--app-text-muted);
  }

  .add:focus-within {
    border-style: solid;
    border-color: color-mix(in srgb, var(--app-success) 60%, transparent);
  }

  .add input {
    flex: 1;
    min-width: 0;
    border: 0;
    outline: none;
    background: transparent;
    color: var(--app-text);
    font-size: 12.5px;
  }

  .clear {
    align-self: flex-end;
    height: 24px;
    padding: 0 8px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--app-text-muted);
    font-size: 11.5px;
  }

  .clear:hover {
    background: var(--app-hover);
    color: var(--app-text);
  }

  button:focus-visible {
    outline: 2px solid var(--app-accent);
    outline-offset: 1px;
  }
</style>
