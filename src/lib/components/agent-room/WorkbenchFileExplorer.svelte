<script lang="ts">
  import { onMount } from 'svelte';
  import {
    ChevronRight,
    ChevronsUp,
    CircleAlert,
    File,
    Folder,
    FolderOpen,
    LoaderCircle,
    PanelBottomOpen,
    PanelRightOpen,
    RefreshCw,
  } from '@lucide/svelte';
  import * as Tooltip from '$lib/components/ui/tooltip';
  import { Button } from '$lib/components/ui/button';
  import { Skeleton } from '$lib/components/ui/skeleton';
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
  <header class="fx-header group">
    <button class="fx-header-toggle" aria-expanded={sectionExpanded} onclick={() => (sectionExpanded = !sectionExpanded)}>
      <ChevronRight size={12} class={`fx-chevron ${sectionExpanded ? 'open' : ''}`} aria-hidden="true" />
      <span>{m['workbench_files.title']()}</span>
    </button>
    <span class="fx-count">{rows.length}</span>
    <Tooltip.Root>
      <Tooltip.Trigger>
        {#snippet child({ props })}
          <button {...props} class="fx-action" aria-label={m['workbench_files.collapse']()} onclick={collapseAll}>
            <ChevronsUp size={13} />
          </button>
        {/snippet}
      </Tooltip.Trigger>
      <Tooltip.Content side="right">{m['workbench_files.collapse']()}</Tooltip.Content>
    </Tooltip.Root>
    <Tooltip.Root>
      <Tooltip.Trigger>
        {#snippet child({ props })}
          <button {...props} class="fx-action" aria-label={m['workbench_files.refresh']()} onclick={refresh}>
            <RefreshCw size={13} class={loadingPaths.includes(rootPath) ? 'animate-spin' : ''} />
          </button>
        {/snippet}
      </Tooltip.Trigger>
      <Tooltip.Content side="right">{m['workbench_files.refresh']()}</Tooltip.Content>
    </Tooltip.Root>
  </header>

  {#if sectionExpanded}
    {#if errorMessage}
      <div class="fx-message" role="alert">
        <CircleAlert size={13} class="mt-px shrink-0 text-[var(--app-danger)]" aria-hidden="true" />
        <span class="min-w-0 flex-1">{errorMessage}</span>
        <Button variant="ghost" size="xs" class="-my-0.5 shrink-0" onclick={refresh}>{m['automation.retry']()}</Button>
      </div>
    {:else if loadingPaths.includes(rootPath) && !childrenByPath[rootPath]}
      <div class="space-y-1 px-2 py-1" role="status" aria-label={m['workbench_files.loading']()}>
        {#each [0, 1, 2, 3] as row (row)}
          <Skeleton class="h-5 rounded-[5px] bg-[var(--app-hover)]" style={`width:${88 - row * 9}%`} />
        {/each}
      </div>
    {:else if childrenByPath[rootPath]?.length === 0}
      <p class="fx-message text-[var(--app-text-muted)]">{m['workbench_files.empty']()}</p>
    {:else}
      <div role="tree" aria-label={m['workbench_files.aria']()}>
      {#each rows as entry (entry.path)}
        {@const expanded = entry.type === 'directory' && expandedPaths.includes(entry.path)}
        {@const active = activePath === entry.path}
        <div
          class="fx-row"
          class:active
          role="treeitem"
          aria-level={entry.depth + 1}
          aria-expanded={entry.type === 'directory' ? expanded : undefined}
          aria-selected={entry.type === 'file' ? active : undefined}
          style:--fx-indent={`${6 + entry.depth * 12}px`}
        >
          <button
            class="fx-row-button"
            title={entry.path}
            onclick={() => entry.type === 'directory' ? void toggleDirectory(entry.path) : onOpen(entry.path, null)}
          >
            {#if entry.type === 'directory'}
              <ChevronRight size={12} class={`fx-chevron ${expanded ? 'open' : ''}`} aria-hidden="true" />
              {#if expanded}<FolderOpen size={14} class="shrink-0 text-[var(--app-text-soft)]" />{:else}<Folder size={14} class="shrink-0 text-[var(--app-text-muted)]" />{/if}
            {:else}
              <span class="w-3 shrink-0"></span>
              <File size={14} class={`shrink-0 ${active ? 'text-[var(--app-accent)]' : 'text-[var(--app-text-muted)]'}`} />
            {/if}
            <span class="min-w-0 flex-1 truncate">{entry.name}</span>
            {#if entry.type === 'directory' && loadingPaths.includes(entry.path)}
              <LoaderCircle size={12} class="mr-1 shrink-0 animate-spin text-[var(--app-text-muted)]" />
            {/if}
          </button>

          {#if entry.type === 'file'}
            <!-- Acoes da linha aparecem ao apontar/focar, sobrepostas ao nome para nao roubar largura. -->
            <div class="fx-row-actions">
              <Tooltip.Root>
                <Tooltip.Trigger>
                  {#snippet child({ props })}
                    <button {...props} class="fx-action" aria-label={m['workbench.open_right_named']({ name: entry.name })} onclick={() => onOpen(entry.path, 'horizontal')}>
                      <PanelRightOpen size={13} />
                    </button>
                  {/snippet}
                </Tooltip.Trigger>
                <Tooltip.Content side="right">{m['workbench.open_right']()}</Tooltip.Content>
              </Tooltip.Root>
              <Tooltip.Root>
                <Tooltip.Trigger>
                  {#snippet child({ props })}
                    <button {...props} class="fx-action" aria-label={m['workbench.open_below_named']({ name: entry.name })} onclick={() => onOpen(entry.path, 'vertical')}>
                      <PanelBottomOpen size={13} />
                    </button>
                  {/snippet}
                </Tooltip.Trigger>
                <Tooltip.Content side="right">{m['workbench.open_below']()}</Tooltip.Content>
              </Tooltip.Root>
            </div>
          {/if}
        </div>
      {/each}
      </div>
    {/if}
  {/if}
</section>

<style>
  /*
   * Mesmo idioma das linhas do Workbench (.wb-row): 28px, hover neutro,
   * selecao neutra com indicador de acento e acoes reveladas ao apontar.
   */
  .fx-header {
    display: flex;
    align-items: center;
    gap: 2px;
    height: 26px;
    margin-top: 6px;
    padding-right: 4px;
  }

  .fx-header-toggle {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    height: 100%;
    flex: 1;
    padding: 0 8px 0 6px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--app-text-muted);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    text-align: left;
    cursor: pointer;
    transition: color var(--duration-quick) ease-out;
  }

  .fx-header-toggle:hover {
    color: var(--app-text-soft);
  }

  .fx-header-toggle:focus-visible,
  .fx-row-button:focus-visible {
    outline: 2px solid var(--app-accent);
    outline-offset: -2px;
  }

  .fx-count {
    min-width: 18px;
    padding-right: 4px;
    color: var(--app-text-muted);
    font-family: var(--font-mono);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    text-align: right;
  }

  :global(.fx-chevron) {
    flex-shrink: 0;
    color: var(--app-text-muted);
    transition: transform var(--duration-fast) var(--ease-smooth-out);
  }

  :global(.fx-chevron.open) {
    transform: rotate(90deg);
  }

  .fx-action {
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
    transition:
      opacity var(--duration-quick) ease-out,
      background-color var(--duration-quick) ease-out,
      color var(--duration-quick) ease-out;
  }

  .fx-action:hover {
    background: var(--app-active);
    color: var(--app-text);
  }

  .fx-action:focus-visible {
    opacity: 1;
    outline: 2px solid var(--app-accent);
    outline-offset: 1px;
  }

  .fx-header .fx-action {
    opacity: 0;
  }

  .fx-header:hover .fx-action,
  .fx-header:focus-within .fx-action {
    opacity: 1;
  }

  .fx-message {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    margin: 2px 6px 4px;
    padding: 6px 8px;
    border-radius: 6px;
    font-size: 11.5px;
    line-height: 1.45;
    color: var(--app-text-soft);
  }

  .fx-row {
    /* Fundo opaco equivalente ao estado da linha, para a sobreposicao das acoes. */
    --fx-row-bg: var(--app-sidebar);
    position: relative;
    display: flex;
    align-items: center;
    min-width: 0;
    height: 28px;
    margin-bottom: 1px;
    border-radius: 6px;
    color: var(--app-text-soft);
    transition: background-color var(--duration-quick) ease-out, color var(--duration-quick) ease-out;
  }

  .fx-row:hover {
    --fx-row-bg: color-mix(in srgb, var(--app-text) 8%, var(--app-sidebar));
    background: var(--app-hover);
    color: var(--app-text);
  }

  .fx-row.active {
    --fx-row-bg: color-mix(in srgb, var(--app-text) 12%, var(--app-sidebar));
    background: var(--app-active);
    color: var(--app-text);
  }

  .fx-row.active::before {
    content: '';
    position: absolute;
    left: 0;
    top: 7px;
    bottom: 7px;
    width: 2px;
    border-radius: 0 2px 2px 0;
    background: var(--app-accent);
  }

  .fx-row-button {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    height: 100%;
    flex: 1;
    padding: 0 8px 0 var(--fx-indent);
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: inherit;
    font-size: 12.5px;
    text-align: left;
    cursor: pointer;
  }

  .fx-row-actions {
    position: absolute;
    top: 2px;
    right: 2px;
    bottom: 2px;
    display: flex;
    align-items: center;
    gap: 1px;
    padding-left: 12px;
    border-radius: 0 6px 6px 0;
    background: linear-gradient(to right, transparent, var(--fx-row-bg) 12px);
    opacity: 0;
    pointer-events: none;
    transition: opacity var(--duration-quick) ease-out;
  }

  .fx-row:hover .fx-row-actions,
  .fx-row:focus-within .fx-row-actions {
    opacity: 1;
  }

  /* So os botoes recebem clique; a faixa de degrade continua abrindo o arquivo. */
  .fx-row-actions .fx-action {
    pointer-events: auto;
  }
</style>
