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
</script>

<Dialog.Root open={true} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
  <Dialog.Content
    class="w-[min(560px,calc(100vw-2rem))]! max-w-none! gap-0! overflow-hidden p-0! sm:max-w-none!"
    showCloseButton={false}
    data-testid="canvas-command-palette"
  >
    <Dialog.Title class="sr-only">{m['palette.title']()}</Dialog.Title>
    <div class="relative border-b border-[var(--app-border)]">
      <Search class="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[var(--app-text-muted)]" size={15} />
      <input
        bind:this={inputEl}
        bind:value={query}
        onkeydown={handleKeydown}
        placeholder={m['ph.palette']()}
        class="h-12 w-full border-0 bg-transparent pr-4 pl-11 text-sm text-[var(--app-text)] outline-none placeholder:text-[var(--app-text-muted)]"
        role="combobox"
        aria-expanded="true"
        aria-controls="canvas-command-palette-list"
        aria-activedescendant={items[selectedIndex] ? `canvas-command-${items[selectedIndex].kind}-${items[selectedIndex].id}` : undefined}
      />
    </div>
    <ul id="canvas-command-palette-list" class="max-h-[min(420px,60dvh)] list-none overflow-y-auto p-1.5" role="listbox">
      {#each items as item, index (item.kind + item.id)}
        <li>
          <button
            id={`canvas-command-${item.kind}-${item.id}`}
            type="button"
            role="option"
            aria-selected={index === selectedIndex}
            class="flex min-h-10 w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-ui-lg text-[var(--app-text)] transition-colors hover:bg-[var(--app-surface-raised)] focus-visible:bg-[var(--app-surface-raised)] focus-visible:outline-none"
            class:bg-[var(--app-surface-raised)]={index === selectedIndex}
            onpointerenter={() => (selectedIndex = index)}
            onclick={() => choose(item)}
          >
            <span class="grid size-6 shrink-0 place-items-center rounded bg-[var(--app-surface-subtle)] text-[var(--app-secondary)]">
              {#if item.kind === 'node'}<Box size={12} />{:else}<Zap size={12} />{/if}
            </span>
            <span class="min-w-0 flex-1 truncate">{item.label}</span>
            <span class="shrink-0 text-ui-xs text-[var(--app-text-muted)]">{item.hint}</span>
          </button>
        </li>
      {:else}
        <li class="px-3 py-8 text-center text-xs text-[var(--app-text-muted)]">{m['palette.empty']()}</li>
      {/each}
    </ul>
  </Dialog.Content>
</Dialog.Root>
