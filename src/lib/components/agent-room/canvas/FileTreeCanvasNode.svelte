<script lang="ts">
  import { onMount } from 'svelte';
  import type { NodeProps } from '@xyflow/svelte';
  import { ArrowUp, File, Folder, FolderTree, GitBranch, GitCommitHorizontal, RefreshCw, Search, X } from '@lucide/svelte';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
  import * as Dialog from '$lib/components/ui/dialog';
  import { Input } from '$lib/components/ui/input';
  import { Button } from '$lib/components/ui/button';
  import NodeShell from './NodeShell.svelte';
  import HeaderIconButton from './HeaderIconButton.svelte';
  import * as m from '$lib/paraglide/messages.js';

  export type FileTreeNodeData = {
    title: string;
    workspaceId: string;
    payload: { path?: string };
    onDelete: (id: string) => void;
    onOpenFile: (path: string) => void;
    onResize?: (id: string, params: { x: number; y: number; width: number; height: number }) => void;
  };

  type FsEntry = { name: string; path: string; type: 'file' | 'directory'; size: number };
  type GitChange = { path: string; status: string; staged: boolean };

  let { id, data, selected } = $props<NodeProps & { data: FileTreeNodeData }>();

  let entries = $state<FsEntry[]>([]);
  let changes = $state<GitChange[]>([]);
  let branch = $state<string | null>(null);
  let currentPath = $state(data.payload.path ?? '');
  let errorMessage = $state('');
  let branches = $state<string[]>([]);
  let commitOpen = $state(false);
  let commitMessage = $state('');
  let branchOpen = $state(false);
  let newBranchName = $state('');
  let searchQuery = $state('');
  let searchResults = $state<Array<{ path: string; line?: number; preview?: string }> | null>(null);
  let searchTimer: ReturnType<typeof setTimeout> | null = null;
  let refreshTimer: ReturnType<typeof setInterval> | null = null;
  let graphMode = $state(false);
  let graphText = $state('');

  async function toggleGraph() {
    graphMode = !graphMode;
    if (graphMode) {
      try {
        const result = await api<{ graph: string }>(`/api/agent-room/workspaces/${data.workspaceId}/git/graph`);
        graphText = result.graph || m['files.graph_no_commits']();
      } catch {
        graphText = m['files.graph_error']();
      }
    }
  }

  async function api<T>(path: string): Promise<T> {
    const response = await fetch(path);
    const payload = await response.json();
    if (!response.ok || payload.error) throw new Error(payload.error || m['files.error_api']());
    return payload.data as T;
  }

  async function refresh() {
    errorMessage = '';
    try {
      const [list, status] = await Promise.all([
        api<FsEntry[]>(`/api/agent-room/workspaces/${data.workspaceId}/fs/list?path=${encodeURIComponent(currentPath)}`),
        api<{ isRepo: boolean; branch: string | null; changes: GitChange[] }>(
          `/api/agent-room/workspaces/${data.workspaceId}/git/status`
        ),
      ]);
      entries = list;
      changes = status.changes;
      branch = status.branch;
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : m['files.error_list']();
    }
  }

  function statusFor(entry: FsEntry): string | null {
    const change = changes.find((item) => item.path === entry.name || entry.path.endsWith(`/${item.path}`));
    return change ? (change.staged ? `${change.status}*` : change.status) : null;
  }

  function openEntry(entry: FsEntry) {
    if (entry.type === 'directory') {
      currentPath = entry.path;
      refresh();
    } else {
      data.onOpenFile(entry.path);
    }
  }

  async function post<T>(path: string, body?: unknown): Promise<T> {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    });
    const payload = await response.json();
    if (!response.ok || payload.error) throw new Error(payload.error || m['files.error_api']());
    return payload.data as T;
  }

  async function gitActionLabel(action: string, fn: () => Promise<unknown>) {
    errorMessage = '';
    try {
      await fn();
      await refresh();
    } catch (error) {
      errorMessage = `${action}: ${error instanceof Error ? error.message : m['files.error_failed']()}`;
    }
  }

  const doCommit = () => gitActionLabel('commit', async () => {
    await post(`/api/agent-room/workspaces/${data.workspaceId}/git/commit`, { message: commitMessage });
    commitMessage = '';
    commitOpen = false;
  });

  const doPull = () => gitActionLabel('pull', () => post(`/api/agent-room/workspaces/${data.workspaceId}/git/pull`));
  const doPush = () => gitActionLabel('push', () => post(`/api/agent-room/workspaces/${data.workspaceId}/git/push`));
  const doStash = () => gitActionLabel('stash', () => post(`/api/agent-room/workspaces/${data.workspaceId}/git/stash`));
  const doStashPop = () => gitActionLabel('stash pop', () => post(`/api/agent-room/workspaces/${data.workspaceId}/git/stash`, { pop: true }));

  async function loadBranches() {
    try {
      branches = await api<string[]>(`/api/agent-room/workspaces/${data.workspaceId}/git/branches`);
    } catch {
      branches = [];
    }
  }

  const doCheckout = (name: string) => gitActionLabel('checkout', () => post(`/api/agent-room/workspaces/${data.workspaceId}/git/checkout`, { branch: name }));

  const doCreateBranch = () => gitActionLabel(m['files.new_branch'](), async () => {
    await post(`/api/agent-room/workspaces/${data.workspaceId}/git/branch`, { branch: newBranchName });
    newBranchName = '';
    branchOpen = false;
    await loadBranches();
  });

  function handleSearch() {
    if (searchTimer) clearTimeout(searchTimer);
    if (!searchQuery.trim()) {
      searchResults = null;
      return;
    }
    searchTimer = setTimeout(async () => {
      const byContent = searchQuery.startsWith('>');
      const needle = byContent ? searchQuery.slice(1) : searchQuery;
      if (!needle.trim()) {
        searchResults = null;
        return;
      }
      searchResults = await api<Array<{ path: string; line?: number; preview?: string }>>(
        `/api/agent-room/workspaces/${data.workspaceId}/fs/search?q=${encodeURIComponent(needle)}&content=${byContent}`
      );
    }, 350);
  }

  function openSearchResult(result: { path: string }) {
    data.onOpenFile(result.path);
    searchResults = null;
    searchQuery = '';
  }

  function goUp() {
    if (!currentPath) return;
    const parts = currentPath.replace(/\/+$/, '').split('/');
    parts.pop();
    currentPath = parts.join('/');
    refresh();
  }

  onMount(() => {
    refresh();
    loadBranches();
    refreshTimer = setInterval(refresh, 10_000);
    return () => {
      if (refreshTimer) clearInterval(refreshTimer);
    };
  });
</script>

<NodeShell
  {id}
  {selected}
  class="canvas-filetree"
  accent="var(--app-success)"
  minWidth={260}
  minHeight={200}
  onResize={data.onResize}
  connections={data.connections ?? []}
  titleText={data.title}
  onRename={data.onRename}
  onJumpToNode={data.onJumpToNode}
  onRemoveConnection={data.onRemoveConnection}
>
  {#snippet icon()}<FolderTree size={13} />{/snippet}
  {#snippet title()}
    {data.title || m['files.default_title']()}
    {#if branch}
      <span class="branch-badge"><GitBranch size={10} /> {branch}</span>
    {/if}
  {/snippet}
  {#snippet actions()}
    {#if branch}
      <HeaderIconButton class="node-action-btn" label={graphMode ? m['files.view_files']() : m['files.view_graph']()} onclick={toggleGraph}>
        <GitCommitHorizontal size={13} />
      </HeaderIconButton>
    {/if}
    <HeaderIconButton class="node-action-btn" label={m['onboarding.back']()} disabled={!currentPath} onclick={goUp}><ArrowUp size={13} /></HeaderIconButton>
    <HeaderIconButton class="node-action-btn" label={m['files.reload']()} onclick={refresh}><RefreshCw size={13} /></HeaderIconButton>
    <HeaderIconButton class="node-action-btn" label={m['files.remove']()} danger onclick={() => data.onDelete(id)}><X size={13} /></HeaderIconButton>
  {/snippet}

  {#if currentPath && !graphMode}
    <p class="current-path">{currentPath.split('/').slice(-2).join('/')}</p>
  {/if}

  {#if graphMode}
    <div class="graph-view nodrag nowheel">
      <pre>{graphText}</pre>
    </div>
  {/if}

  <div class="tree-search nodrag">
    <Search size={11} />
    <input
      bind:value={searchQuery}
      oninput={handleSearch}
      placeholder={m['ph.file_search']()}
      spellcheck="false"
    />
  </div>
  {#if searchResults}
    <div class="search-results nodrag nowheel">
      {#each searchResults as result}
        <button class="search-result" onclick={() => openSearchResult(result)}>
          <span class="result-path">{result.path.split('/').slice(-2).join('/')}{result.line ? `:${result.line}` : ''}</span>
          {#if result.preview}
            <span class="result-preview">{result.preview}</span>
          {/if}
        </button>
      {:else}
        <p class="empty">{m['files.search_empty']()}</p>
      {/each}
    </div>
  {/if}

  <div class="tree-body nodrag nowheel" class:hidden={graphMode}>
    {#if errorMessage}
      <p class="error">{errorMessage}</p>
    {/if}
    {#each entries as entry (entry.path)}
      <button class="tree-entry" ondblclick={() => openEntry(entry)} onclick={() => entry.type === 'directory' && openEntry(entry)}>
        <span class="entry-icon">
          {#if entry.type === 'directory'}<Folder size={12} />{:else}<File size={12} />{/if}
        </span>
        <span class="entry-name">{entry.name}</span>
        {#if statusFor(entry)}
          <span class="entry-status">{statusFor(entry)}</span>
        {/if}
      </button>
    {/each}
    {#if entries.length === 0 && !errorMessage}
      <p class="empty">{m['files.empty_dir']()}</p>
    {/if}
  </div>
</NodeShell>

<Dialog.Root open={commitOpen} onOpenChange={(open) => !open && (commitOpen = false)}>
  <Dialog.Content class="sm:max-w-sm">
    <Dialog.Header>
      <Dialog.Title>Commit</Dialog.Title>
      <Dialog.Description>{m['files.commit_desc']({ branch: branch ?? '' })}</Dialog.Description>
    </Dialog.Header>
    <div class="space-y-3">
      <Input bind:value={commitMessage} placeholder={m['ph.commit_message']()} />
      {#if errorMessage}
        <p class="text-sm text-destructive">{errorMessage}</p>
      {/if}
    </div>
    <Dialog.Footer>
      <Button variant="outline" onclick={() => (commitOpen = false)}>{m['settings.cancel']()}</Button>
      <Button onclick={doCommit} disabled={!commitMessage.trim()}>Commit</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

<Dialog.Root open={branchOpen} onOpenChange={(open) => !open && (branchOpen = false)}>
  <Dialog.Content class="sm:max-w-sm">
    <Dialog.Header>
      <Dialog.Title>{m['files.new_branch']()}</Dialog.Title>
      <Dialog.Description>{m['files.new_branch_desc']()}</Dialog.Description>
    </Dialog.Header>
    <div class="space-y-3">
      <Input bind:value={newBranchName} placeholder="minha-branch" />
      {#if errorMessage}
        <p class="text-sm text-destructive">{errorMessage}</p>
      {/if}
    </div>
    <Dialog.Footer>
      <Button variant="outline" onclick={() => (branchOpen = false)}>{m['settings.cancel']()}</Button>
      <Button onclick={doCreateBranch} disabled={!newBranchName.trim()}>{m['files.create']()}</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

<style>
  .git-menu-trigger {
    display: inline-flex;
    align-items: center;
    border: none;
    background: transparent;
    color: var(--app-success);
    cursor: pointer;
    padding: 2px;
    border-radius: 5px;
  }

  .git-menu-trigger:hover {
    background: var(--app-border);
  }

  .tree-search {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 4px 8px;
    border-bottom: 1px solid var(--app-border);
    color: var(--app-text-muted);
  }

  .tree-search input {
    flex: 1;
    border: none;
    outline: none;
    background: transparent;
    color: var(--app-text-soft);
    font-size: 11px;
  }

  .search-results {
    max-height: 160px;
    overflow-y: auto;
    border-bottom: 1px solid var(--app-border);
  }

  .search-result {
    display: flex;
    flex-direction: column;
    width: 100%;
    padding: 4px 8px;
    border: none;
    background: transparent;
    cursor: pointer;
    text-align: left;
  }

  .search-result:hover {
    background: var(--app-border);
  }

  .result-path {
    font-size: 11px;
    color: var(--app-secondary);
  }

  .result-preview {
    font-size: 10px;
    color: var(--app-text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .graph-view {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 8px 10px;
  }

  .graph-view pre {
    margin: 0;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 11px;
    line-height: 1.5;
    color: var(--app-text-soft);
  }

  .hidden {
    display: none;
  }

  .branch-badge {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    font-size: 10px;
    font-weight: 400;
    color: var(--app-success);
    background: color-mix(in srgb, var(--app-success) 12%, transparent);
    padding: 1px 7px;
    border-radius: 8px;
    margin-left: 6px;
  }

  .current-path {
    margin: 0;
    padding: 3px 10px;
    font-size: 10px;
    color: var(--app-text-muted);
    border-bottom: 1px solid var(--app-border);
  }

  .tree-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 4px;
  }

  .tree-entry {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 3px 6px;
    border: none;
    border-radius: 5px;
    background: transparent;
    color: var(--app-text-soft);
    font-size: 12px;
    cursor: pointer;
    text-align: left;
  }

  .tree-entry:hover {
    background: var(--app-border);
  }

  .entry-icon {
    display: inline-flex;
    color: var(--app-text-muted);
  }

  .entry-name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .entry-status {
    font-size: 10px;
    color: var(--app-warning);
    font-weight: 600;
  }

  .error {
    color: var(--app-danger);
    font-size: 11px;
    padding: 6px;
  }

  .empty {
    color: var(--app-text-muted);
    font-size: 11px;
    padding: 6px;
  }
</style>
