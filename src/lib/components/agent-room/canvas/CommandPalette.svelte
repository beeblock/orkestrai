<script lang="ts">
  import type { Node } from '@xyflow/svelte';
  import { Box, Search, Zap } from '@lucide/svelte';
  import * as Dialog from '$lib/components/ui/dialog';
  import * as m from '$lib/paraglide/messages.js';

  export type PaletteAction = {
    id: string;
    label: string;
    hint?: string;
    run: () => void;
  };

  type Props = {
    nodes: Node[];
    actions: PaletteAction[];
    onJumpToNode: (nodeId: string) => void;
    onClose: () => void;
  };

  let { nodes, actions, onJumpToNode, onClose }: Props = $props();

  let query = $state('');
  let selectedIndex = $state(0);
  let inputEl: HTMLInputElement;

  type Item = { kind: 'node' | 'action'; id: string; label: string; hint: string };

  const items = $derived.by<Item[]>(() => {
    const q = query.trim().toLowerCase();
    const nodeItems: Item[] = nodes.map((node) => ({
      kind: 'node',
      id: node.id,
      label: String(node.data?.title ?? node.type ?? m['palette.node_fallback']()),
      hint: m['palette.go_to']({ type: String(node.type) }),
    }));
    const actionItems: Item[] = actions.map((action) => ({
      kind: 'action',
      id: action.id,
      label: action.label,
      hint: action.hint ?? m['palette.action_hint'](),
    }));
    const all = [...actionItems, ...nodeItems];
    if (!q) return all;
    return all.filter((item) => item.label.toLowerCase().includes(q) || item.hint.toLowerCase().includes(q));
  });

  function choose(item: Item) {
    if (item.kind === 'node') {
      onJumpToNode(item.id);
    } else {
      actions.find((action) => action.id === item.id)?.run();
    }
    onClose();
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      selectedIndex = Math.min(selectedIndex + 1, items.length - 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      selectedIndex = Math.max(selectedIndex - 1, 0);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const item = items[selectedIndex] ?? items[0];
      if (item) choose(item);
    }
  }

  $effect(() => {
    inputEl?.focus();
  });

  $effect(() => {
    query;
    selectedIndex = 0;
  });

  // Mantem o item destacado visivel ao navegar pelas setas.
  $effect(() => {
    const item = items[selectedIndex];
    if (!item || typeof document === 'undefined') return;
    document.getElementById(`canvas-command-${item.kind}-${item.id}`)?.scrollIntoView({ block: 'nearest' });
  });
</script>

<Dialog.Root open={true} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
  <Dialog.Content
    class="w-[min(560px,calc(100vw-2rem))]! max-w-none! gap-0! overflow-hidden p-0! sm:max-w-none!"
    showCloseButton={false}
    data-testid="canvas-command-palette"
  >
    <Dialog.Title class="sr-only">{m['palette.title']()}</Dialog.Title>
    <div class="relative border-b border-[var(--app-border)]">
      <Search class="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[var(--app-text-muted)]" size={16} />
      <input
        bind:this={inputEl}
        bind:value={query}
        onkeydown={handleKeydown}
        placeholder={m['ph.palette']()}
        class="h-13 w-full border-0 bg-transparent pr-4 pl-11 text-[14px] text-[var(--app-text)] outline-none placeholder:text-[var(--app-text-muted)] focus-visible:outline-none"
        role="combobox"
        aria-expanded="true"
        aria-controls="canvas-command-palette-list"
        aria-activedescendant={items[selectedIndex] ? `canvas-command-${items[selectedIndex].kind}-${items[selectedIndex].id}` : undefined}
      />
    </div>
    <ul id="canvas-command-palette-list" class="max-h-[min(420px,60dvh)] list-none overflow-y-auto p-1.5 scroll-py-1.5" role="listbox">
      {#each items as item, index (item.kind + item.id)}
        <li>
          <button
            id={`canvas-command-${item.kind}-${item.id}`}
            type="button"
            role="option"
            aria-selected={index === selectedIndex}
            class="group flex min-h-10 w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[13px] text-[var(--app-text)] transition-colors duration-150 hover:bg-[var(--app-hover)] focus-visible:outline-none aria-selected:bg-[var(--app-active)]"
            onpointerenter={() => (selectedIndex = index)}
            onclick={() => choose(item)}
          >
            <span class="grid size-7 shrink-0 place-items-center rounded-md bg-[var(--app-hover)] text-[var(--app-text-soft)] transition-colors duration-150 group-aria-selected:bg-[var(--app-accent-soft)] group-aria-selected:text-[var(--app-accent)]">
              {#if item.kind === 'node'}<Box size={14} />{:else}<Zap size={14} />{/if}
            </span>
            <span class="min-w-0 flex-1 truncate">{item.label}</span>
            <span class="shrink-0 font-mono text-[11px] text-[var(--app-text-muted)]">{item.hint}</span>
          </button>
        </li>
      {:else}
        <li class="px-3 py-10 text-center text-ui-md text-[var(--app-text-muted)]">{m['palette.empty']()}</li>
      {/each}
    </ul>
    <footer class="flex items-center gap-4 border-t border-[var(--app-border)] bg-[var(--app-surface-subtle)] px-3 py-2 text-ui-xs text-[var(--app-text-muted)]">
      <span class="inline-flex items-center gap-1.5"><kbd>↑</kbd><kbd>↓</kbd>{m['global_search.hint_navigate']()}</span>
      <span class="inline-flex items-center gap-1.5"><kbd>↵</kbd>{m['global_search.hint_open']()}</span>
      <span class="ml-auto inline-flex items-center gap-1.5"><kbd>esc</kbd>{m['global_search.hint_close']()}</span>
    </footer>
  </Dialog.Content>
</Dialog.Root>
