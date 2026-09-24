<script lang="ts">
  import { MoreHorizontal, X } from '@lucide/svelte';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
  import * as Tooltip from '$lib/components/ui/tooltip';
  import WorkbenchNodeIcon from './WorkbenchNodeIcon.svelte';
  import type { CanvasNode } from '$lib/modules/agent-room/domain/types.js';
  import type { WorkbenchPaneState, WorkbenchTabPlacement } from './workbench-layout.js';
  import * as m from '$lib/paraglide/messages.js';

  let {
    pane,
    nodes,
    placement,
    activePane,
    label,
    panes,
    dirtyNodeIds = [],
    onSelect,
    onClose,
    onMove,
  }: {
    pane: WorkbenchPaneState;
    nodes: CanvasNode[];
    placement: WorkbenchTabPlacement;
    activePane: boolean;
    label: string;
    panes: Array<{ id: string; label: string }>;
    dirtyNodeIds?: string[];
    onSelect: (nodeId: string) => void;
    onClose: (nodeId: string) => void;
    onMove: (nodeId: string, paneId: string) => void;
  } = $props();

  const tabs = $derived(pane.nodeIds.flatMap((nodeId) => {
    const node = nodes.find((item) => item.id === nodeId);
    return node ? [node] : [];
  }));

  function startTabDrag(event: DragEvent, nodeId: string): void {
    if (!event.dataTransfer) return;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('application/x-orkestrai-workbench-node', nodeId);
    event.dataTransfer.setData('text/plain', nodeId);
  }
</script>

{#snippet moveMenu(nodeId: string)}
  {#if panes.length > 1}
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        class="wt-action"
        aria-label={m['workbench.move_to']()}
        onclick={(event) => event.stopPropagation()}
      >
        <MoreHorizontal size={12} aria-hidden="true" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="end" class="min-w-36">
        <DropdownMenu.Label>{m['workbench.move_to']()}</DropdownMenu.Label>
        {#each panes.filter((candidate) => candidate.id !== pane.id) as candidate (candidate.id)}
          <DropdownMenu.Item onclick={() => onMove(nodeId, candidate.id)}>{candidate.label}</DropdownMenu.Item>
        {/each}
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  {/if}
{/snippet}

{#if placement === 'vertical'}
  <section class="px-1.5 pb-2" aria-label={label}>
    <div class="wt-section">
      <span class={`size-1.5 rounded-full ${activePane ? 'bg-[var(--app-accent)]' : 'bg-[var(--app-border-strong)]'}`}></span>
      <span>{label}</span>
      <span class="wt-count">{tabs.length}</span>
    </div>
    <div class="space-y-px">
      {#each tabs as node (node.id)}
        <div
          class="wt-row group"
          class:active={pane.activeNodeId === node.id}
          draggable="true"
          role="group"
          title={m['workbench.move_tab']()}
          ondragstart={(event) => startTabDrag(event, node.id)}
        >
          <button
            class="wt-row-button"
            aria-current={pane.activeNodeId === node.id ? 'page' : undefined}
            onclick={() => onSelect(node.id)}
          >
            <span class={pane.activeNodeId === node.id ? 'text-[var(--app-accent)]' : 'text-[var(--app-text-muted)]'}>
              <WorkbenchNodeIcon type={node.type} size={13} />
            </span>
            <span data-testid="workbench-vertical-tab-name" class="min-w-0 flex-1 break-words text-[12.5px] leading-[16px]">{node.title || node.type}</span>
            {#if dirtyNodeIds.includes(node.id)}<span class="size-1.5 shrink-0 rounded-full bg-[var(--app-warning)]" aria-label={m['editor.unsaved']()}></span>{/if}
          </button>
          {@render moveMenu(node.id)}
          <Tooltip.Root>
            <Tooltip.Trigger>
              {#snippet child({ props })}
                <button
                  {...props}
                  class="wt-action close"
                  aria-label={m['workbench.close_tab']({ name: node.title || node.type })}
                  onclick={() => onClose(node.id)}
                >
                  <X size={12} aria-hidden="true" />
                </button>
              {/snippet}
            </Tooltip.Trigger>
            <Tooltip.Content side="right">{m['workbench.close']()}</Tooltip.Content>
          </Tooltip.Root>
        </div>
      {/each}
    </div>
  </section>
{:else}
  <div class="wt-strip" class:pane-active={activePane} role="tablist" aria-label={label}>
    {#each tabs as node (node.id)}
      <div
        class="wt-tab group"
        class:active={pane.activeNodeId === node.id}
        draggable="true"
        role="presentation"
        title={m['workbench.move_tab']()}
        ondragstart={(event) => startTabDrag(event, node.id)}
      >
        <button
          class="wt-tab-button"
          role="tab"
          aria-selected={pane.activeNodeId === node.id}
          onclick={() => onSelect(node.id)}
        >
          <WorkbenchNodeIcon type={node.type} size={13} />
          <span class="min-w-0 flex-1 truncate text-[12.5px]" title={node.title || node.type}>{node.title || node.type}</span>
          {#if dirtyNodeIds.includes(node.id)}<span class="size-1.5 shrink-0 rounded-full bg-[var(--app-warning)]" aria-label={m['editor.unsaved']()}></span>{/if}
        </button>
        {@render moveMenu(node.id)}
        <Tooltip.Root>
          <Tooltip.Trigger>
            {#snippet child({ props })}
              <button
                {...props}
                class="wt-action close"
                aria-label={m['workbench.close_tab']({ name: node.title || node.type })}
                onclick={() => onClose(node.id)}
              >
                <X size={12} aria-hidden="true" />
              </button>
            {/snippet}
          </Tooltip.Trigger>
          <Tooltip.Content>{m['workbench.close']()}</Tooltip.Content>
        </Tooltip.Root>
      </div>
    {/each}
  </div>
{/if}

<style>
  /* Itens abertos (lista vertical): mesmo idioma de selecao da arvore. */
  .wt-section {
    display: flex;
    align-items: center;
    gap: 7px;
    height: 26px;
    padding: 0 8px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--app-text-muted);
  }

  .wt-count {
    margin-left: auto;
    font-family: var(--font-mono);
    font-size: 10.5px;
    font-weight: 500;
    letter-spacing: 0;
    font-variant-numeric: tabular-nums;
  }

  .wt-row {
    position: relative;
    display: flex;
    align-items: center;
    min-width: 0;
    min-height: 30px;
    border-radius: 6px;
    color: var(--app-text-soft);
    cursor: grab;
    transition: background-color var(--duration-quick) ease-out, color var(--duration-quick) ease-out;
  }

  .wt-row:active {
    cursor: grabbing;
  }

  .wt-row:hover {
    background: var(--app-hover);
    color: var(--app-text);
  }

  .wt-row.active {
    background: var(--app-active);
    color: var(--app-text);
  }

  .wt-row.active::before {
    content: '';
    position: absolute;
    left: 0;
    top: 8px;
    bottom: 8px;
    width: 2px;
    border-radius: 0 2px 2px 0;
    background: var(--app-accent);
  }

  .wt-row-button {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    min-height: 30px;
    flex: 1;
    padding: 6px 8px 6px 10px;
    border: 0;
    background: transparent;
    color: inherit;
    text-align: left;
    cursor: pointer;
  }

  .wt-row-button:focus-visible,
  .wt-tab-button:focus-visible {
    outline: 2px solid var(--app-accent);
    outline-offset: -2px;
    border-radius: 6px;
  }

  /* Acoes de aba: aparecem ao apontar ou focar; fechar fica visivel na ativa. */
  .wt-action {
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    flex-shrink: 0;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--app-text-muted);
    cursor: pointer;
    opacity: 0;
    transition: opacity var(--duration-quick) ease-out, background-color var(--duration-quick) ease-out, color var(--duration-quick) ease-out;
  }

  .wt-action.close {
    margin-right: 3px;
  }

  .group:hover .wt-action,
  .group:focus-within .wt-action,
  .active .wt-action.close {
    opacity: 1;
  }

  .wt-action:hover {
    background: var(--app-active);
    color: var(--app-text);
  }

  .wt-action:focus-visible {
    opacity: 1;
    outline: 2px solid var(--app-accent);
    outline-offset: 1px;
  }

  /* Abas horizontais: a ativa se funde ao conteudo e ganha linha de acento
     no topo (neutra quando o painel nao esta ativo). */
  .wt-strip {
    display: flex;
    align-items: stretch;
    min-width: 0;
    height: 36px;
    overflow-x: auto;
    scrollbar-width: none;
    border-bottom: 1px solid var(--app-border);
    background: var(--app-surface-subtle);
  }

  .wt-strip::-webkit-scrollbar {
    display: none;
  }

  .wt-tab {
    position: relative;
    display: flex;
    align-items: center;
    min-width: 128px;
    max-width: 224px;
    flex-shrink: 0;
    border-right: 1px solid var(--app-border);
    color: var(--app-text-muted);
    cursor: grab;
    transition: background-color var(--duration-quick) ease-out, color var(--duration-quick) ease-out;
  }

  .wt-tab:hover {
    background: var(--app-hover);
    color: var(--app-text-soft);
  }

  .wt-tab.active {
    margin-bottom: -1px;
    background: var(--app-canvas);
    color: var(--app-text);
    box-shadow: inset 0 2px 0 var(--app-border-strong);
  }

  .pane-active .wt-tab.active {
    box-shadow: inset 0 2px 0 var(--app-accent);
  }

  .wt-tab-button {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    height: 100%;
    flex: 1;
    padding: 0 6px 0 10px;
    border: 0;
    background: transparent;
    color: inherit;
    text-align: left;
    cursor: pointer;
  }
</style>
