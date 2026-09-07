<script lang="ts">
  import {
    ChevronDown,
    ChevronRight,
    Circle,
    Copy,
    Eye,
    EyeOff,
    Frame,
    GripVertical,
    Group,
    Image,
    Layers3,
    Lock,
    MoreHorizontal,
    PenTool,
    Plus,
    RectangleHorizontal,
    Scissors,
    Search,
    TextCursorInput,
    Trash2,
    Unlock,
  } from '@lucide/svelte';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import * as AlertDialog from '$lib/components/ui/alert-dialog';
  import * as ContextMenu from '$lib/components/ui/context-menu';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
  import * as m from '$lib/paraglide/messages.js';
  import type { DesignElement, DesignPage } from '$lib/modules/agent-room/contracts/schemas/designSchemas.js';
  import { designLayerRows, rootDesignLayerIds } from './design-layer-tree.js';

  type LayerDropPlacement = 'before' | 'inside' | 'after';

  let {
    pages,
    activePageId,
    elements,
    selectedIds,
    saving = false,
    canPaste = false,
    onActivatePage,
    onCreatePage,
    onRenamePage,
    onDuplicatePage,
    onDeletePage,
    onReorderPage,
    onSelect,
    onRenameLayer,
    onToggleVisibility,
    onToggleLock,
    onDropLayers,
    onCopy,
    onCut,
    onPaste,
    onDuplicate,
    onDelete,
    onMoveLayer,
  }: {
    pages: DesignPage[];
    activePageId: string;
    elements: DesignElement[];
    selectedIds: string[];
    saving?: boolean;
    canPaste?: boolean;
    onActivatePage: (pageId: string) => void | Promise<void>;
    onCreatePage: () => void | Promise<void>;
    onRenamePage: (page: DesignPage, name: string) => void | Promise<void>;
    onDuplicatePage: (page: DesignPage) => void | Promise<void>;
    onDeletePage: (page: DesignPage) => void | Promise<void>;
    onReorderPage: (sourceId: string, targetId: string, placement: 'before' | 'after') => void | Promise<void>;
    onSelect: (elementId: string, additive: boolean) => void;
    onRenameLayer: (element: DesignElement, name: string) => void | Promise<void>;
    onToggleVisibility: (element: DesignElement) => void | Promise<void>;
    onToggleLock: (element: DesignElement) => void | Promise<void>;
    onDropLayers: (elementIds: string[], targetId: string | null, placement: LayerDropPlacement) => void | Promise<void>;
    onCopy: () => void;
    onCut: () => void | Promise<void>;
    onPaste: () => void | Promise<void>;
    onDuplicate: (elementId?: string) => void | Promise<void>;
    onDelete: (elementId?: string) => void | Promise<void>;
    onMoveLayer: (elementId: string, direction: -1 | 1) => void | Promise<void>;
  } = $props();

  let query = $state('');
  let collapsedIds = $state(new Set<string>());
  let editingLayerId = $state<string | null>(null);
  let editingPageId = $state<string | null>(null);
  let renameDraft = $state('');
  let draggedLayerIds = $state<string[]>([]);
  let layerDrop = $state<{ id: string | null; placement: LayerDropPlacement } | null>(null);
  let draggedPageId = $state<string | null>(null);
  let pageDrop = $state<{ id: string; placement: 'before' | 'after' } | null>(null);
  let pendingPageDelete = $state<DesignPage | null>(null);
  let renameInput = $state<HTMLInputElement | null>(null);

  const orderedPages = $derived([...pages].sort((left, right) => left.order - right.order || left.name.localeCompare(right.name)));
  const rows = $derived(designLayerRows(elements, collapsedIds, query));

  $effect(() => {
    if ((!editingPageId && !editingLayerId) || !renameInput) return;
    queueMicrotask(() => {
      renameInput?.focus();
      renameInput?.select();
    });
  });

  function iconFor(element: DesignElement) {
    if (element.type === 'frame') return Frame;
    if (element.type === 'group') return Group;
    if (element.type === 'rectangle') return RectangleHorizontal;
    if (element.type === 'ellipse') return Circle;
    if (element.type === 'text') return TextCursorInput;
    if (element.type === 'path') return PenTool;
    return Image;
  }

  function toggleCollapse(id: string): void {
    const next = new Set(collapsedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    collapsedIds = next;
  }

  function beginLayerRename(element: DesignElement): void {
    editingPageId = null;
    editingLayerId = element.id;
    renameDraft = element.name;
  }

  function beginPageRename(page: DesignPage): void {
    editingLayerId = null;
    editingPageId = page.id;
    renameDraft = page.name;
  }

  async function commitRename(): Promise<void> {
    const name = renameDraft.trim();
    const layer = elements.find((element) => element.id === editingLayerId);
    const page = pages.find((candidate) => candidate.id === editingPageId);
    editingLayerId = null;
    editingPageId = null;
    if (!name) return;
    if (layer && name !== layer.name) await onRenameLayer(layer, name);
    if (page && name !== page.name) await onRenamePage(page, name);
  }

  function cancelRename(): void {
    editingLayerId = null;
    editingPageId = null;
    renameDraft = '';
  }

  function updateLayerDrop(event: DragEvent, element: DesignElement): void {
    if (!draggedLayerIds.length || draggedLayerIds.includes(element.id)) return;
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const ratio = (event.clientY - rect.top) / Math.max(rect.height, 1);
    const container = element.type === 'frame' || element.type === 'group';
    const placement: LayerDropPlacement = container && ratio >= 0.28 && ratio <= 0.72
      ? 'inside'
      : ratio < 0.5 ? 'before' : 'after';
    layerDrop = { id: element.id, placement };
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  }

  async function dropLayers(targetId: string | null, fallback: LayerDropPlacement): Promise<void> {
    if (!draggedLayerIds.length) return;
    const placement = layerDrop?.id === targetId ? layerDrop.placement : fallback;
    const ids = [...draggedLayerIds];
    draggedLayerIds = [];
    layerDrop = null;
    await onDropLayers(ids, targetId, placement);
  }

  function finishLayerDrag(): void {
    draggedLayerIds = [];
    layerDrop = null;
  }

  function updatePageDrop(event: DragEvent, page: DesignPage): void {
    if (!draggedPageId || draggedPageId === page.id) return;
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    pageDrop = { id: page.id, placement: event.clientY < rect.top + rect.height / 2 ? 'before' : 'after' };
  }

  async function dropPage(page: DesignPage): Promise<void> {
    if (!draggedPageId || draggedPageId === page.id) return;
    const sourceId = draggedPageId;
    const placement = pageDrop?.id === page.id ? pageDrop.placement : 'before';
    draggedPageId = null;
    pageDrop = null;
    await onReorderPage(sourceId, page.id, placement);
  }
</script>

<div class="grid min-h-0 flex-1 grid-rows-[auto_auto_minmax(0,1fr)]" data-testid="design-file-panel">
  <section class="border-b border-[var(--app-border)]" aria-label={m['design.pages']()}>
    <div class="flex h-8 items-center gap-2 px-2 text-ui-sm font-semibold text-[var(--app-text-soft)]">
      <span class="min-w-0 flex-1">{m['design.pages']()}</span>
      <span class="text-ui-xs tabular-nums text-[var(--app-text-muted)]">{pages.length}</span>
      <Button variant="ghost" size="icon-sm" class="size-7" disabled={saving || pages.length >= 100} aria-label={m['design.add_page']()} onclick={() => void onCreatePage()}><Plus size={13} /></Button>
    </div>
    <div class="max-h-36 overflow-y-auto px-1 pb-1" role="list">
      {#each orderedPages as item, index (item.id)}
        <ContextMenu.Root>
          <ContextMenu.Trigger
            class={`group/page relative flex h-8 min-w-0 items-center rounded px-1 ${item.id === activePageId ? 'bg-[var(--app-accent-soft)] text-[var(--app-text)]' : 'text-[var(--app-text-soft)] hover:bg-[var(--app-surface-raised)]'}`}
            data-testid={`design-page-${item.id}`}
            role="listitem"
            ondragover={(event) => { event.preventDefault(); event.stopPropagation(); updatePageDrop(event, item); }}
            ondrop={(event) => { event.preventDefault(); event.stopPropagation(); void dropPage(item); }}
          >
            {#if pageDrop?.id === item.id}
              <span class={`pointer-events-none absolute inset-x-1 z-10 h-0.5 rounded-full bg-[var(--app-accent)] ${pageDrop.placement === 'before' ? 'top-0 -translate-y-1/2' : 'bottom-0 translate-y-1/2'}`}></span>
            {/if}
            <button class="grid size-7 shrink-0 cursor-grab place-items-center text-[var(--app-text-muted)] opacity-40 group-hover/page:opacity-100" draggable="true" aria-label={m['design.reorder_page']()} onpointerdown={(event) => event.stopPropagation()} ondragstart={(event) => { draggedPageId = item.id; if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'; }} ondragend={() => { draggedPageId = null; pageDrop = null; }}><GripVertical size={12} /></button>
            {#if editingPageId === item.id}
              <Input bind:ref={renameInput} data-testid="design-page-rename" class="h-7 min-w-0 flex-1 px-1.5 text-ui-sm" bind:value={renameDraft} onblur={() => void commitRename()} onkeydown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void commitRename(); } else if (event.key === 'Escape') { event.preventDefault(); cancelRename(); } }} />
            {:else}
              <button class="min-w-0 flex-1 truncate text-left text-ui-sm" aria-current={item.id === activePageId ? 'page' : undefined} onclick={() => void onActivatePage(item.id)} ondblclick={() => beginPageRename(item)}>{item.name}</button>
            {/if}
            <DropdownMenu.Root>
              <DropdownMenu.Trigger class="grid size-7 shrink-0 place-items-center rounded text-[var(--app-text-muted)] opacity-0 hover:bg-[var(--app-border)] group-hover/page:opacity-100 focus:opacity-100" aria-label={m['design.page_actions']()}><MoreHorizontal size={13} /></DropdownMenu.Trigger>
              <DropdownMenu.Content align="start" class="w-48">
                <DropdownMenu.Item onclick={() => beginPageRename(item)}>{m['design.rename']()}</DropdownMenu.Item>
                <DropdownMenu.Item onclick={() => void onDuplicatePage(item)}><Copy />{m['design.duplicate']()}</DropdownMenu.Item>
                <DropdownMenu.Item disabled={index === 0} onclick={() => void onReorderPage(item.id, orderedPages[index - 1].id, 'before')}>{m['design.page_move_up']()}</DropdownMenu.Item>
                <DropdownMenu.Item disabled={index === orderedPages.length - 1} onclick={() => void onReorderPage(item.id, orderedPages[index + 1].id, 'after')}>{m['design.page_move_down']()}</DropdownMenu.Item>
                <DropdownMenu.Separator />
                <DropdownMenu.Item variant="destructive" disabled={pages.length <= 1} onclick={() => (pendingPageDelete = item)}><Trash2 />{m['design.delete_page']()}</DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Root>
          </ContextMenu.Trigger>
          <ContextMenu.Content class="w-48">
            <ContextMenu.Item onclick={() => beginPageRename(item)}>{m['design.rename']()}</ContextMenu.Item>
            <ContextMenu.Item onclick={() => void onDuplicatePage(item)}><Copy />{m['design.duplicate']()}</ContextMenu.Item>
            <ContextMenu.Separator />
            <ContextMenu.Item variant="destructive" disabled={pages.length <= 1} onclick={() => (pendingPageDelete = item)}><Trash2 />{m['design.delete_page']()}</ContextMenu.Item>
          </ContextMenu.Content>
        </ContextMenu.Root>
      {/each}
    </div>
  </section>

  <div class="border-b border-[var(--app-border)] p-2">
    <div class="relative">
      <Search class="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-[var(--app-text-muted)]" />
      <Input class="h-8 pl-7 text-ui-sm" bind:value={query} placeholder={m['design.search_layers']()} aria-label={m['design.search_layers']()} />
    </div>
  </div>

  <section class="min-h-0 overflow-y-auto p-1" aria-label={m['design.layers']()} ondragover={(event) => { event.preventDefault(); if (event.target === event.currentTarget) layerDrop = { id: null, placement: 'inside' }; }} ondrop={(event) => { event.preventDefault(); if (event.target === event.currentTarget) void dropLayers(null, 'inside'); }}>
    {#if !rows.length}
      <div class="grid min-h-24 place-items-center px-4 text-center text-ui-sm leading-5 text-[var(--app-text-muted)]">{query ? m['design.no_layers_found']() : m['design.no_layers']()}</div>
    {:else}
      <div role="tree" aria-multiselectable="true">
        {#each rows as row (row.element.id)}
          {@const element = row.element}
          {@const LayerIcon = iconFor(element)}
          <ContextMenu.Root>
            <ContextMenu.Trigger
              class={`group/layer relative mb-0.5 flex h-8 min-w-0 items-center rounded pr-1 ${selectedIds.includes(element.id) ? 'bg-[var(--app-accent-soft)] text-[var(--app-text)]' : 'text-[var(--app-text-soft)] hover:bg-[var(--app-surface-raised)]'}`}
              style={`padding-left: ${4 + row.depth * 14}px`}
              role="treeitem"
              aria-level={row.depth + 1}
              aria-selected={selectedIds.includes(element.id)}
              aria-expanded={row.hasChildren ? row.expanded : undefined}
              data-testid={`design-layer-${element.id}`}
              ondragover={(event) => { event.preventDefault(); event.stopPropagation(); updateLayerDrop(event, element); }}
              ondrop={(event) => { event.preventDefault(); event.stopPropagation(); void dropLayers(element.id, element.type === 'frame' || element.type === 'group' ? 'inside' : 'before'); }}
            >
              {#if layerDrop?.id === element.id}
                {#if layerDrop.placement === 'inside'}
                  <span class="pointer-events-none absolute inset-0 rounded ring-1 ring-inset ring-[var(--app-accent)]"></span>
                {:else}
                  <span class={`pointer-events-none absolute inset-x-1 z-10 h-0.5 rounded-full bg-[var(--app-accent)] ${layerDrop.placement === 'before' ? 'top-0 -translate-y-1/2' : 'bottom-0 translate-y-1/2'}`}></span>
                {/if}
              {/if}
              <button class="grid size-7 shrink-0 cursor-grab place-items-center text-[var(--app-text-muted)] opacity-0 group-hover/layer:opacity-70 focus:opacity-100" draggable="true" aria-label={m['design.reorder_layer']()} onpointerdown={(event) => event.stopPropagation()} ondragstart={(event) => { draggedLayerIds = selectedIds.includes(element.id) ? rootDesignLayerIds(elements, selectedIds) : [element.id]; layerDrop = null; if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'; }} ondragend={finishLayerDrag}><GripVertical size={12} /></button>
              {#if row.hasChildren}
                <button class="grid size-6 shrink-0 place-items-center rounded hover:bg-[var(--app-border)]" aria-label={row.expanded ? m['design.collapse_layer']() : m['design.expand_layer']()} onclick={(event) => { event.stopPropagation(); toggleCollapse(element.id); }}>{#if row.expanded}<ChevronDown size={12} />{:else}<ChevronRight size={12} />{/if}</button>
              {:else}
                <span class="size-6 shrink-0"></span>
              {/if}
              <LayerIcon size={13} class={`shrink-0 ${element.componentId ? 'text-[var(--app-accent)]' : element.instanceRootId === element.id ? 'text-[var(--app-info)]' : 'text-[var(--app-text-muted)]'}`} />
              {#if editingLayerId === element.id}
                <Input bind:ref={renameInput} data-testid="design-layer-rename" class="h-7 min-w-0 flex-1 px-1.5 text-ui-sm" bind:value={renameDraft} onblur={() => void commitRename()} onkeydown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void commitRename(); } else if (event.key === 'Escape') { event.preventDefault(); cancelRename(); } }} />
              {:else}
                <button class="min-w-0 flex-1 truncate px-1.5 text-left text-ui-sm" onclick={(event) => onSelect(element.id, event.shiftKey)} ondblclick={() => beginLayerRename(element)}>{element.name}</button>
              {/if}
              <button class="grid size-7 shrink-0 place-items-center rounded text-[var(--app-text-muted)] opacity-0 hover:bg-[var(--app-border)] hover:text-[var(--app-text)] group-hover/layer:opacity-100 focus:opacity-100" aria-label={element.visible ? m['design.hide']() : m['design.show']()} onclick={() => void onToggleVisibility(element)}>{#if element.visible}<Eye size={12} />{:else}<EyeOff size={12} />{/if}</button>
              <button class={`grid size-7 shrink-0 place-items-center rounded hover:bg-[var(--app-border)] hover:text-[var(--app-text)] ${element.locked ? 'text-[var(--app-text-soft)] opacity-100' : 'text-[var(--app-text-muted)] opacity-0 group-hover/layer:opacity-100 focus:opacity-100'}`} aria-label={element.locked ? m['design.unlock']() : m['design.lock']()} onclick={() => void onToggleLock(element)}>{#if element.locked}<Lock size={12} />{:else}<Unlock size={12} />{/if}</button>
            </ContextMenu.Trigger>
            <ContextMenu.Content class="w-52">
              <ContextMenu.Item onclick={() => { onSelect(element.id, false); onCopy(); }}><Copy />{m['design.copy_layers']()}</ContextMenu.Item>
              <ContextMenu.Item onclick={() => { onSelect(element.id, false); void onCut(); }}><Scissors />{m['design.cut_layers']()}</ContextMenu.Item>
              <ContextMenu.Item disabled={!canPaste} onclick={() => void onPaste()}>{m['design.paste_layers']()}</ContextMenu.Item>
              <ContextMenu.Item onclick={() => void onDuplicate(element.id)}><Copy />{m['design.duplicate']()}</ContextMenu.Item>
              <ContextMenu.Separator />
              <ContextMenu.Item onclick={() => beginLayerRename(element)}>{m['design.rename']()}</ContextMenu.Item>
              <ContextMenu.Item onclick={() => void onMoveLayer(element.id, 1)}>{m['design.move_up']()}</ContextMenu.Item>
              <ContextMenu.Item onclick={() => void onMoveLayer(element.id, -1)}>{m['design.move_down']()}</ContextMenu.Item>
              <ContextMenu.Separator />
              <ContextMenu.Item variant="destructive" disabled={element.locked} onclick={() => void onDelete(element.id)}><Trash2 />{m['design.delete']()}</ContextMenu.Item>
            </ContextMenu.Content>
          </ContextMenu.Root>
        {/each}
      </div>
    {/if}
  </section>
</div>

<AlertDialog.Root open={Boolean(pendingPageDelete)} onOpenChange={(open) => { if (!open) pendingPageDelete = null; }}>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>{m['design.delete_page_title']()}</AlertDialog.Title>
      <AlertDialog.Description>{m['design.delete_page_description']({ name: pendingPageDelete?.name ?? '' })}</AlertDialog.Description>
    </AlertDialog.Header>
    <AlertDialog.Footer>
      <AlertDialog.Cancel>{m['settings.cancel']()}</AlertDialog.Cancel>
      <AlertDialog.Action
        class="bg-[var(--app-danger)] text-white hover:opacity-90"
        onclick={() => {
          const page = pendingPageDelete;
          pendingPageDelete = null;
          if (page) void onDeletePage(page);
        }}
      >{m['design.confirm_delete_page']()}</AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>
