<script lang="ts">
  import { onMount } from 'svelte';
  import {
    ChevronDown,
    ChevronRight,
    ChevronsUp,
    File,
    Files,
    Folder,
    FolderOpen,
    PanelBottomOpen,
    PanelRightOpen,
    RefreshCw,
  } from '@lucide/svelte';
  import * as Tooltip from '$lib/components/ui/tooltip';
  import { Button } from '$lib/components/ui/button';
  import type { WorkbenchSplitDirection } from './workbench-layout.js';
  import * as m from '$lib/paraglide/messages.js';

  type FsEntry = {
    name: string;
    path: string;
    type: 'file' | 'directory';
    size: number;
  };

  type FileRow = FsEntry & { depth: number };

  let {
    workspaceId,
    rootPath,
    activePath = null,
    onOpen,
  }: {
    workspaceId: string;
    rootPath: string;
    activePath?: string | null;
    onOpen: (path: string, direction: WorkbenchSplitDirection | null) => void;
  } = $props();

  let childrenByPath = $state<Record<string, FsEntry[]>>({});
  let expandedPaths = $state<string[]>([]);
  let loadingPaths = $state<string[]>([]);
  let errorMessage = $state('');
  let sectionExpanded = $state(true);

  const rows = $derived.by(() => {
    const result: FileRow[] = [];
    const visit = (path: string, depth: number) => {
      for (const entry of childrenByPath[path] ?? []) {
        result.push({ ...entry, depth });
        if (entry.type === 'directory' && expandedPaths.includes(entry.path)) visit(entry.path, depth + 1);
      }
    };
    visit(rootPath, 0);
    return result;
  });

  async function loadDirectory(path: string, force = false): Promise<void> {
    if (!force && childrenByPath[path]) return;
    if (loadingPaths.includes(path)) return;
    loadingPaths = [...loadingPaths, path];
    errorMessage = '';
    try {
      const response = await fetch(
        `/api/agent-room/workspaces/${workspaceId}/fs/list?path=${encodeURIComponent(path)}`,
      );
      const payload = await response.json();
      if (!response.ok || payload.error) throw new Error(payload.error || m['workbench_files.error']());
      childrenByPath = { ...childrenByPath, [path]: payload.data as FsEntry[] };
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : m['workbench_files.error']();
    } finally {
      loadingPaths = loadingPaths.filter((candidate) => candidate !== path);
    }
  }

  async function toggleDirectory(path: string): Promise<void> {
    if (expandedPaths.includes(path)) {
      expandedPaths = expandedPaths.filter((candidate) => candidate !== path);
      return;
    }
    expandedPaths = [...expandedPaths, path];
    await loadDirectory(path);
  }

  async function refresh(): Promise<void> {
    childrenByPath = {};
    expandedPaths = [];
    await loadDirectory(rootPath, true);
  }

  function collapseAll(): void {
    expandedPaths = [];
  }

  onMount(() => {
    void loadDirectory(rootPath);
  });
</script>

<section class="pb-1" data-testid="workbench-file-explorer">
  <header class="group flex h-7 items-center gap-1 pr-1 text-ui-xs font-semibold uppercase text-[var(--app-text-muted)]">
    <button
      class="flex h-full min-w-0 flex-1 items-center gap-1 px-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--app-accent)]"
      aria-expanded={sectionExpanded}
      onclick={() => (sectionExpanded = !sectionExpanded)}
    >
      {#if sectionExpanded}
        <ChevronDown size={11} aria-hidden="true" />
      {:else}
        <ChevronRight size={11} aria-hidden="true" />
      {/if}
      <Files size={12} strokeWidth={1.7} aria-hidden="true" />
      <span>{m['workbench_files.title']()}</span>
    </button>
    <span class="ml-auto tabular-nums">{rows.length}</span>
    <Tooltip.Root>
      <Tooltip.Trigger>
        {#snippet child({ props })}
          <Button {...props} variant="ghost" size="icon-xs" class="opacity-0 focus-visible:opacity-100 group-hover:opacity-100" aria-label={m['workbench_files.collapse']()} onclick={collapseAll}>
            <ChevronsUp size={12} />
          </Button>
        {/snippet}
      </Tooltip.Trigger>
      <Tooltip.Content side="right">{m['workbench_files.collapse']()}</Tooltip.Content>
    </Tooltip.Root>
    <Tooltip.Root>
      <Tooltip.Trigger>
        {#snippet child({ props })}
          <Button {...props} variant="ghost" size="icon-xs" class="opacity-0 focus-visible:opacity-100 group-hover:opacity-100" aria-label={m['workbench_files.refresh']()} onclick={refresh}>
            <RefreshCw size={12} class={loadingPaths.includes(rootPath) ? 'animate-spin' : ''} />
          </Button>
        {/snippet}
      </Tooltip.Trigger>
      <Tooltip.Content side="right">{m['workbench_files.refresh']()}</Tooltip.Content>
    </Tooltip.Root>
  </header>

  {#if sectionExpanded}
    {#if errorMessage}
      <p class="px-3 py-2 text-ui-xs leading-4 text-[var(--app-danger)]">{errorMessage}</p>
    {:else if loadingPaths.includes(rootPath) && !childrenByPath[rootPath]}
      <div class="space-y-1 px-2 py-1" role="status" aria-label={m['workbench_files.loading']()}>
        {#each [0, 1, 2, 3] as row (row)}
          <div class="h-6 animate-pulse rounded-[4px] bg-[var(--app-surface-raised)]" style:width={`${88 - row * 7}%`}></div>
        {/each}
      </div>
    {:else if childrenByPath[rootPath]?.length === 0}
      <p class="px-3 py-2 text-ui-xs text-[var(--app-text-muted)]">{m['workbench_files.empty']()}</p>
    {:else}
      <div role="tree" aria-label={m['workbench_files.aria']()}>
      {#each rows as entry (entry.path)}
        {@const expanded = entry.type === 'directory' && expandedPaths.includes(entry.path)}
        <div
          class={`group flex h-7 min-w-0 items-center text-ui-sm transition-[background-color,color] hover:bg-[var(--app-surface-raised)] ${activePath === entry.path ? 'bg-[var(--app-accent-soft)] text-[var(--app-text)]' : 'text-[var(--app-text-soft)]'}`}
          role="treeitem"
          aria-level={entry.depth + 1}
          aria-expanded={entry.type === 'directory' ? expanded : undefined}
          aria-selected={entry.type === 'file' ? activePath === entry.path : undefined}
          style:padding-left={`${6 + entry.depth * 12}px`}
        >
          <button
            class="flex h-full min-w-0 flex-1 items-center gap-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--app-accent)]"
            title={entry.path}
            onclick={() => entry.type === 'directory' ? void toggleDirectory(entry.path) : onOpen(entry.path, null)}
          >
            {#if entry.type === 'directory'}
              {#if expanded}<ChevronDown size={12} class="shrink-0 text-[var(--app-text-muted)]" />{:else}<ChevronRight size={12} class="shrink-0 text-[var(--app-text-muted)]" />{/if}
              {#if expanded}<FolderOpen size={13} class="shrink-0 text-[var(--app-accent)]" />{:else}<Folder size={13} class="shrink-0 text-[var(--app-text-muted)]" />{/if}
            {:else}
              <span class="w-3 shrink-0"></span>
              <File size={13} class={`shrink-0 ${activePath === entry.path ? 'text-[var(--app-accent)]' : 'text-[var(--app-text-muted)]'}`} />
            {/if}
            <span class="min-w-0 flex-1 truncate">{entry.name}</span>
            {#if entry.type === 'directory' && loadingPaths.includes(entry.path)}
              <RefreshCw size={11} class="mr-1 shrink-0 animate-spin text-[var(--app-text-muted)]" />
            {/if}
          </button>

          {#if entry.type === 'file'}
            <Tooltip.Root>
              <Tooltip.Trigger>
                {#snippet child({ props })}
                  <button {...props} class="grid size-6 shrink-0 place-items-center text-[var(--app-text-muted)] opacity-0 hover:text-[var(--app-text)] focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--app-accent)] group-hover:opacity-100" aria-label={m['workbench.open_right_named']({ name: entry.name })} onclick={() => onOpen(entry.path, 'horizontal')}>
                    <PanelRightOpen size={12} />
                  </button>
                {/snippet}
              </Tooltip.Trigger>
              <Tooltip.Content side="right">{m['workbench.open_right']()}</Tooltip.Content>
            </Tooltip.Root>
            <Tooltip.Root>
              <Tooltip.Trigger>
                {#snippet child({ props })}
                  <button {...props} class="mr-1 grid size-6 shrink-0 place-items-center text-[var(--app-text-muted)] opacity-0 hover:text-[var(--app-text)] focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--app-accent)] group-hover:opacity-100" aria-label={m['workbench.open_below_named']({ name: entry.name })} onclick={() => onOpen(entry.path, 'vertical')}>
                    <PanelBottomOpen size={12} />
                  </button>
                {/snippet}
              </Tooltip.Trigger>
              <Tooltip.Content side="right">{m['workbench.open_below']()}</Tooltip.Content>
            </Tooltip.Root>
          {/if}
        </div>
      {/each}
      </div>
    {/if}
  {/if}
</section>
