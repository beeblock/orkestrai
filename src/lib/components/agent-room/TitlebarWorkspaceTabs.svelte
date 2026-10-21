<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { goto } from '$app/navigation';
  import { ChevronDown, FolderCog, Plus, Search, X } from '@lucide/svelte';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
  import * as Tooltip from '$lib/components/ui/tooltip';
  import { agentColor, agentInitials } from './agent-identity.js';
  import { requestWorkspace, workspaceContext } from './workspace-context.svelte.js';
  import { closeWorkspaceTab, ensureWorkspaceTab, retainWorkspaceTabs, workspaceTabs } from './workspace-tabs.svelte.js';
  import { runCanvasAction } from './canvas-actions.js';
  import type { Workspace } from '$lib/modules/agent-room/domain/types.js';
  import * as m from '$lib/paraglide/messages.js';

  /**
   * Open workspaces as tabs (like browser tabs): the active one is outlined in
   * gold and every tab carries its own "needs you" count. The chevron lists
   * every workspace; folders and editing stay in the Canvas manager.
   */
  const activeId = $derived(workspaceContext.workspaceId);
  $effect(() => ensureWorkspaceTab(activeId));
  onMount(retainWorkspaceTabs);

  const byId = $derived(new Map(workspaceTabs.workspaces.map((workspace) => [workspace.id, workspace])));
  const tabs = $derived(workspaceTabs.tabIds.map((id) => byId.get(id)).filter((workspace): workspace is Workspace => Boolean(workspace)));
  let query = $state('');
  let searchInput = $state<HTMLInputElement | null>(null);
  const matches = $derived.by(() => {
    const needle = query.trim().toLocaleLowerCase();
    const list = needle ? workspaceTabs.workspaces.filter((workspace) => workspace.name.toLocaleLowerCase().includes(needle)) : workspaceTabs.workspaces;
    return list.slice(0, 40);
  });

  function open(workspaceId: string) {
    if (workspaceId === activeId) return;
    ensureWorkspaceTab(workspaceId);
    if (!requestWorkspace(workspaceId)) void goto(`/canvas?workspace=${encodeURIComponent(workspaceId)}`);
  }

  function close(event: MouseEvent, workspaceId: string) {
    event.stopPropagation();
    const index = tabs.findIndex((workspace) => workspace.id === workspaceId);
    closeWorkspaceTab(workspaceId);
    if (workspaceId !== activeId) return;
    const next = tabs[index + 1] ?? tabs[index - 1];
    if (next) open(next.id);
  }

  function mark(workspace: Workspace): string {
    const color = agentColor(workspace.id);
    return `--mark-bg:${color.bg};--mark-ink:${color.ink}`;
  }
</script>

<nav class="ws-tabs" aria-label={m['topbar.tabs_label']()}>
  {#each tabs as workspace (workspace.id)}
    {@const count = workspaceTabs.attention[workspace.id] ?? 0}
    <div class="ws-tab" class:active={workspace.id === activeId}>
      <button
        type="button"
        class="ws-tab-main"
        aria-current={workspace.id === activeId ? 'page' : undefined}
        onclick={() => open(workspace.id)}
        title={workspace.name}
      >
        <span class="ws-mark" style={mark(workspace)} aria-hidden="true">{agentInitials(workspace.name).slice(0, 1)}</span>
        <span class="ws-name">{workspace.name}</span>
        {#if count > 0}<span class="ws-count" aria-label={m['topbar.needs_you_badge']({ count })}>{count > 99 ? '99+' : count}</span>{/if}
      </button>
      {#if tabs.length > 1}
        <button type="button" class="ws-close" aria-label={m['topbar.close_tab']({ name: workspace.name })} onclick={(event) => close(event, workspace.id)}>
          <X size={11} strokeWidth={2.2} />
        </button>
      {/if}
    </div>
  {/each}

  <Tooltip.Root>
    <Tooltip.Trigger>
      {#snippet child({ props })}
        <button {...props} type="button" class="ws-icon" aria-label={m['topbar.new_workspace']()} onclick={() => runCanvasAction('new-workspace', activeId)}>
          <Plus size={14} strokeWidth={2} />
        </button>
      {/snippet}
    </Tooltip.Trigger>
    <Tooltip.Content side="bottom">{m['topbar.new_workspace']()}</Tooltip.Content>
  </Tooltip.Root>

  <DropdownMenu.Root onOpenChange={(value) => { if (value) { query = ''; void tick().then(() => searchInput?.focus()); } }}>
    <DropdownMenu.Trigger class="ws-icon" aria-label={m['topbar.all_workspaces']()} data-testid="workspace-switcher">
      <ChevronDown size={14} strokeWidth={2} />
    </DropdownMenu.Trigger>
    <DropdownMenu.Content align="start" sideOffset={8} class="ws-menu w-[280px] p-1.5">
      <label class="ws-search">
        <Search size={13} aria-hidden="true" />
        <input bind:this={searchInput} bind:value={query} placeholder={m['topbar.find_workspace']()} aria-label={m['topbar.find_workspace']()} autocomplete="off" spellcheck="false" onkeydown={(event) => event.stopPropagation()} />
      </label>
      <div class="ws-list">
        {#each matches as workspace (workspace.id)}
          {@const count = workspaceTabs.attention[workspace.id] ?? 0}
          <DropdownMenu.Item class="gap-2.5" onclick={() => open(workspace.id)}>
            <span class="ws-mark" style={mark(workspace)} aria-hidden="true">{agentInitials(workspace.name).slice(0, 1)}</span>
            <span class="min-w-0 flex-1 truncate">{workspace.name}</span>
            {#if count > 0}<span class="ws-count">{count}</span>{/if}
          </DropdownMenu.Item>
        {:else}
          <p class="ws-empty">{m['topbar.no_workspaces']()}</p>
        {/each}
      </div>
      <DropdownMenu.Separator />
      <DropdownMenu.Item class="gap-2.5" onclick={() => runCanvasAction('new-workspace', activeId)}><Plus size={14} />{m['topbar.new_workspace']()}</DropdownMenu.Item>
      <DropdownMenu.Item class="gap-2.5" onclick={() => runCanvasAction('workspaces', activeId)}><FolderCog size={14} />{m['topbar.manage_workspaces']()}</DropdownMenu.Item>
    </DropdownMenu.Content>
  </DropdownMenu.Root>
</nav>

<style>
  .ws-tabs {
    min-width: 0;
    height: 100%;
    display: flex;
    align-items: center;
    gap: 4px;
    overflow: hidden;
  }

  .ws-tab {
    position: relative;
    min-width: 0;
    flex: 0 1 auto;
    display: flex;
    align-items: center;
    height: 28px;
    border-radius: 9px;
    border: 1px solid transparent;
    transition: background-color var(--duration-quick) ease-out, border-color var(--duration-quick) ease-out;
  }

  .ws-tab:hover {
    background: var(--app-hover);
  }

  .ws-tab.active {
    background: color-mix(in srgb, var(--app-accent) 9%, transparent);
    border-color: color-mix(in srgb, var(--app-accent) 46%, transparent);
  }

  .ws-tab-main {
    min-width: 0;
    height: 100%;
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 0 9px 0 6px;
    border: 0;
    background: transparent;
    color: var(--app-text-soft);
    font-size: 12.5px;
    font-weight: 500;
  }

  .ws-tab.active .ws-tab-main {
    color: var(--app-text);
    font-weight: 600;
  }

  .ws-tab:has(.ws-close) .ws-tab-main {
    padding-right: 4px;
  }

  .ws-name {
    max-width: 150px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ws-mark {
    width: 17px;
    height: 17px;
    flex: none;
    display: inline-grid;
    place-items: center;
    border-radius: 5px;
    background: var(--mark-bg);
    color: var(--mark-ink);
    font-size: 10.5px;
    font-weight: 700;
  }

  .ws-count {
    min-width: 17px;
    height: 16px;
    padding: 0 5px;
    display: inline-grid;
    place-items: center;
    border-radius: 6px;
    background: color-mix(in srgb, var(--app-warning) 18%, transparent);
    color: var(--app-warning);
    font-family: var(--font-mono);
    font-size: 10.5px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }

  .ws-close {
    width: 18px;
    height: 18px;
    margin-right: 5px;
    display: grid;
    place-items: center;
    border: 0;
    border-radius: 5px;
    background: transparent;
    color: var(--app-text-muted);
    opacity: 0;
    transition: opacity var(--duration-quick) ease-out, background-color var(--duration-quick) ease-out;
  }

  .ws-tab:hover .ws-close,
  .ws-tab.active .ws-close,
  .ws-close:focus-visible {
    opacity: 1;
  }

  .ws-close:hover {
    background: var(--app-hover);
    color: var(--app-text);
  }

  :global(.ws-icon) {
    width: 26px;
    height: 26px;
    flex: none;
    display: grid;
    place-items: center;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: var(--app-text-muted);
    transition: background-color var(--duration-quick) ease-out, color var(--duration-quick) ease-out;
  }

  :global(.ws-icon:hover),
  :global(.ws-icon[data-state='open']) {
    background: var(--app-hover);
    color: var(--app-text);
  }

  .ws-search {
    display: flex;
    align-items: center;
    gap: 7px;
    height: 32px;
    margin-bottom: 4px;
    padding: 0 9px;
    border-radius: 8px;
    background: var(--app-hover);
    color: var(--app-text-muted);
  }

  .ws-search input {
    flex: 1;
    min-width: 0;
    border: 0;
    outline: none;
    background: transparent;
    color: var(--app-text);
    font-size: 12.5px;
  }

  .ws-list {
    max-height: 320px;
    overflow-y: auto;
  }

  .ws-empty {
    margin: 0;
    padding: 12px 8px;
    color: var(--app-text-muted);
    font-size: 12px;
  }
</style>
