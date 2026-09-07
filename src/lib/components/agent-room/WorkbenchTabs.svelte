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
        class="grid size-6 shrink-0 place-items-center rounded-[4px] text-[var(--app-text-muted)] opacity-0 transition-[background-color,color,opacity] hover:bg-[var(--app-accent-soft)] hover:text-[var(--app-text)] focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-accent)] group-hover:opacity-100"
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
    <div class="flex h-6 items-center gap-2 px-2 text-ui-xs font-semibold uppercase text-[var(--app-text-muted)]">
      <span class={`size-1.5 rounded-full ${activePane ? 'bg-[var(--app-accent)]' : 'bg-[var(--app-border-strong)]'}`}></span>
      <span>{label}</span>
      <span class="ml-auto tabular-nums">{tabs.length}</span>
    </div>
    <div class="space-y-0.5">
      {#each tabs as node (node.id)}
        <div
          class={`group flex min-h-8 min-w-0 cursor-grab items-center rounded-[5px] border transition-[background-color,border-color,color] active:cursor-grabbing ${pane.activeNodeId === node.id ? 'border-[var(--app-border-strong)] bg-[var(--app-surface-raised)] text-[var(--app-text)]' : 'border-transparent text-[var(--app-text-soft)] hover:bg-[var(--app-surface-subtle)] hover:text-[var(--app-text)]'}`}
          draggable="true"
          role="group"
          title={m['workbench.move_tab']()}
          ondragstart={(event) => startTabDrag(event, node.id)}
        >
          <button
            class="flex min-h-8 min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--app-accent)]"
            aria-current={pane.activeNodeId === node.id ? 'page' : undefined}
            onclick={() => onSelect(node.id)}
          >
            <span class={pane.activeNodeId === node.id ? 'text-[var(--app-accent)]' : 'text-[var(--app-text-muted)]'}>
              <WorkbenchNodeIcon type={node.type} size={13} />
            </span>
            <span data-testid="workbench-vertical-tab-name" class="min-w-0 flex-1 break-words text-ui-sm leading-[14px]">{node.title || node.type}</span>
            {#if dirtyNodeIds.includes(node.id)}<span class="size-1.5 shrink-0 rounded-full bg-[var(--app-warning)]" aria-label={m['editor.unsaved']()}></span>{/if}
          </button>
          {@render moveMenu(node.id)}
          <Tooltip.Root>
            <Tooltip.Trigger>
              {#snippet child({ props })}
                <button
                  {...props}
                  class="mr-1 grid size-6 shrink-0 place-items-center rounded-[4px] text-[var(--app-text-muted)] opacity-0 transition-[background-color,color,opacity] hover:bg-[var(--app-accent-soft)] hover:text-[var(--app-text)] focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-accent)] group-hover:opacity-100"
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
  <div class={`flex h-9 min-w-0 items-stretch overflow-x-auto border-b bg-[var(--app-surface-subtle)] ${activePane ? 'border-b-[var(--app-accent)]' : 'border-[var(--app-border)]'}`} role="tablist" aria-label={label}>
    {#each tabs as node (node.id)}
      <div
        class={`group flex min-w-32 max-w-56 shrink-0 cursor-grab items-center border-r border-[var(--app-border)] active:cursor-grabbing ${pane.activeNodeId === node.id ? 'bg-[var(--app-surface)] text-[var(--app-text)]' : 'text-[var(--app-text-muted)] hover:bg-[var(--app-surface-raised)] hover:text-[var(--app-text-soft)]'}`}
        draggable="true"
        role="presentation"
        title={m['workbench.move_tab']()}
        ondragstart={(event) => startTabDrag(event, node.id)}
      >
        <button
          class="flex h-full min-w-0 flex-1 items-center gap-2 px-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--app-accent)]"
          role="tab"
          aria-selected={pane.activeNodeId === node.id}
          onclick={() => onSelect(node.id)}
        >
          <WorkbenchNodeIcon type={node.type} size={13} />
          <span class="min-w-0 flex-1 truncate text-ui-sm" title={node.title || node.type}>{node.title || node.type}</span>
          {#if dirtyNodeIds.includes(node.id)}<span class="size-1.5 shrink-0 rounded-full bg-[var(--app-warning)]" aria-label={m['editor.unsaved']()}></span>{/if}
        </button>
        {@render moveMenu(node.id)}
        <Tooltip.Root>
          <Tooltip.Trigger>
            {#snippet child({ props })}
              <button
                {...props}
                class="mr-1 grid size-6 shrink-0 place-items-center rounded-[4px] text-[var(--app-text-muted)] opacity-0 transition-[background-color,color,opacity] hover:bg-[var(--app-accent-soft)] hover:text-[var(--app-text)] focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-accent)] group-hover:opacity-100"
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
