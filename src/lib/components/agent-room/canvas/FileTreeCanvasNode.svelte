<script lang="ts">
  import { onMount } from 'svelte';
  import type { NodeProps } from '@xyflow/svelte';
  import { ArrowUp, ChevronRight, CircleAlert, File, Folder, FolderOpen, FolderTree, GitBranch, GitCommitHorizontal, RefreshCw, Search, X } from '@lucide/svelte';
  import * as Dialog from '$lib/components/ui/dialog';
  import { Input } from '$lib/components/ui/input';
  import { Button } from '$lib/components/ui/button';
  import NodeShell from './NodeShell.svelte';
  import HeaderIconButton from './HeaderIconButton.svelte';
  import NodeEmptyState from './NodeEmptyState.svelte';
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
  // So estado de tela: evita mostrar "pasta vazia" antes da primeira listagem chegar.
  let loaded = $state(false);
  let searchInput: HTMLInputElement | null = $state(null);

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
    } finally {
      loaded = true;
    }
  }

  function statusFor(entry: FsEntry): string | null {
    const change = changes.find((item) => item.path === entry.name || entry.path.endsWith(`/${item.path}`));
    return change ? (change.staged ? `${change.status}*` : change.status) : null;
  }

  // Marcador git -> tom e nome legivel (a letra continua visivel; o nome vai no title/leitor de tela).
  function statusTone(status: string): 'modified' | 'added' | 'deleted' | 'conflict' | 'renamed' {
    const code = status.charAt(0);
    if (code === 'A' || code === '?') return 'added';
    if (code === 'D') return 'deleted';
    if (code === 'U') return 'conflict';
    if (code === 'R' || code === 'C') return 'renamed';
    return 'modified';
  }

  function statusName(status: string): string {
    const code = status.charAt(0);
    const name = code === 'A' ? m['git.status_added']()
      : code === '?' ? m['git.status_untracked']()
        : code === 'D' ? m['git.status_deleted']()
          : code === 'U' ? m['git.status_conflict']()
            : code === 'R' ? m['git.status_renamed']()
              : code === 'C' ? m['git.status_copied']()
                : code === 'T' ? m['git.status_type']()
                  : m['git.status_modified']();
    return status.endsWith('*') ? m['git.status_staged']({ status: name }) : name;
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

  function clearSearch() {
    searchQuery = '';
    handleSearch();
    searchInput?.focus();
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
      <span class="branch-badge" title={branch}><GitBranch size={11} aria-hidden="true" /><span class="branch-name">{branch}</span></span>
    {/if}
  {/snippet}
  {#snippet actions()}
    {#if branch}
      <HeaderIconButton class="node-action-btn" label={graphMode ? m['files.view_files']() : m['files.view_graph']()} active={graphMode} onclick={toggleGraph}>
        <GitCommitHorizontal size={13} />
      </HeaderIconButton>
    {/if}
    <HeaderIconButton class="node-action-btn" label={m['files.reload']()} onclick={refresh}><RefreshCw size={13} /></HeaderIconButton>
    <HeaderIconButton class="node-action-btn" label={m['files.remove']()} danger onclick={() => data.onDelete(id)}><X size={13} /></HeaderIconButton>
  {/snippet}

  <!-- Busca no topo: e o primeiro gesto de quem procura um arquivo. -->
  <div class="tree-search nodrag">
    <label class="search-field">
      <Search size={13} aria-hidden="true" />
      <input
        bind:this={searchInput}
        bind:value={searchQuery}
        oninput={handleSearch}
        onkeydown={(event) => {
          if (event.key === 'Escape' && searchQuery) {
            event.preventDefault();
            clearSearch();
          }
        }}
        placeholder={m['ph.file_search']()}
        aria-label={m['files.search_aria']()}
        spellcheck="false"
        autocomplete="off"
      />
      {#if searchQuery}
        <button type="button" class="search-clear" aria-label={m['files.clear_search']()} title={m['files.clear_search']()} onclick={clearSearch}>
          <X size={12} />
        </button>
      {/if}
    </label>
  </div>

  {#if searchResults}
    <div class="search-results nodrag nowheel">
      {#each searchResults as result}
        <button class="search-result" title={result.path} onclick={() => openSearchResult(result)}>
          <span class="result-path">{result.path.split('/').slice(-2).join('/')}{#if result.line}<span class="result-line">:{result.line}</span>{/if}</span>
          {#if result.preview}
            <span class="result-preview">{result.preview}</span>
          {/if}
        </button>
      {:else}
        <p class="search-empty">{m['files.search_empty']()}</p>
      {/each}
    </div>
  {/if}

  {#if currentPath && !graphMode}
    <!-- Onde estou + como voltar, juntos: o botao de subir so existe quando ha para onde subir. -->
    <div class="path-bar nodrag">
      <HeaderIconButton class="path-up" label={m['api_client.parent_folder']()} side="bottom" onclick={goUp}><ArrowUp size={13} /></HeaderIconButton>
      <p class="current-path" title={currentPath}>{currentPath.split('/').slice(-2).join('/')}</p>
    </div>
  {/if}

  {#if graphMode}
    <div class="graph-view nodrag nowheel">
      <pre>{graphText}</pre>
    </div>
  {/if}

  <div class="tree-body nodrag nowheel" class:hidden={graphMode}>
    {#if errorMessage}
      <div class="tree-error" role="alert">
        <CircleAlert size={14} aria-hidden="true" />
        <span class="error">{errorMessage}</span>
        <button type="button" class="tree-error-retry" onclick={refresh}>{m['workspace_access.retry']()}</button>
      </div>
    {/if}
    {#if !loaded && !errorMessage}
      <div class="tree-loading" aria-busy="true" aria-label={m['workbench_files.loading']()}>
        {#each [72, 54, 64, 46, 58] as width, index (index)}
          <span class="tree-skeleton" style:--w={`${width}%`}></span>
        {/each}
      </div>
    {:else}
      {#each entries as entry (entry.path)}
        {@const status = statusFor(entry)}
        <button
          class="tree-entry"
          class:directory={entry.type === 'directory'}
          title={entry.path}
          ondblclick={() => openEntry(entry)}
          onclick={() => entry.type === 'directory' && openEntry(entry)}
          onkeydown={(event) => {
            // Enter no arquivo abre como o duplo clique (o clique simples so navega pastas).
            if (event.key === 'Enter' && entry.type === 'file') {
              event.preventDefault();
              openEntry(entry);
            }
          }}
        >
          <span class="entry-icon" aria-hidden="true">
            {#if entry.type === 'directory'}<Folder size={14} />{:else}<File size={14} />{/if}
          </span>
          <span class="entry-name">{entry.name}</span>
          {#if status}
            <span class="entry-status" data-tone={statusTone(status)} title={statusName(status)} aria-hidden="true">{status}</span>
            <span class="sr-only">{statusName(status)}</span>
          {/if}
          {#if entry.type === 'directory'}
            <ChevronRight size={13} class="entry-chevron" aria-hidden="true" />
          {/if}
        </button>
      {/each}
      {#if entries.length === 0 && !errorMessage}
        {#if currentPath}
          <NodeEmptyState icon={FolderOpen} compact title={m['files.empty_dir_title']()}>
            {#snippet actions()}
              <Button variant="outline" size="sm" onclick={goUp}><ArrowUp />{m['api_client.parent_folder']()}</Button>
            {/snippet}
          </NodeEmptyState>
        {:else}
          <NodeEmptyState icon={FolderOpen} compact title={m['files.empty_dir_title']()} />
        {/if}
      {/if}
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
  /* Busca: campo de 28px com foco visivel, dentro de uma faixa com respiro. */
  .tree-search {
    flex: none;
    padding: 8px 8px 6px;
  }

  .search-field {
    display: flex;
    align-items: center;
    gap: 7px;
    height: 28px;
    padding: 0 4px 0 9px;
    border-radius: 7px;
    background: var(--app-surface-subtle);
    box-shadow: var(--app-shadow-border);
    color: var(--app-text-muted);
    cursor: text;
    transition: box-shadow var(--duration-quick) ease-out, background-color var(--duration-quick) ease-out;
  }

  .search-field:hover {
    box-shadow: var(--app-shadow-border-hover);
  }

  .search-field:focus-within {
    background: var(--app-surface);
    box-shadow: 0 0 0 1px var(--app-accent), 0 0 0 3px color-mix(in srgb, var(--app-accent) 16%, transparent);
  }

  .search-field input {
    flex: 1;
    min-width: 0;
    height: 100%;
    border: none;
    outline: none;
    background: transparent;
    color: var(--app-text);
    font-size: 12px;
  }

  .search-field input::placeholder {
    color: var(--app-text-muted);
  }

  .search-clear {
    display: grid;
    place-items: center;
    width: 20px;
    height: 20px;
    flex: none;
    border: none;
    border-radius: 5px;
    background: transparent;
    color: var(--app-text-muted);
    cursor: pointer;
    transition: background-color var(--duration-quick) ease-out, color var(--duration-quick) ease-out;
  }

  .search-clear:hover {
    background: var(--app-hover);
    color: var(--app-text);
  }

  .search-clear:focus-visible {
    outline: 2px solid var(--app-accent);
    outline-offset: 1px;
  }

  .search-results {
    flex: none;
    max-height: 180px;
    overflow-y: auto;
    padding: 0 6px 6px;
    border-bottom: 1px solid var(--app-border);
  }

  .search-result {
    display: flex;
    flex-direction: column;
    gap: 1px;
    width: 100%;
    min-height: 30px;
    justify-content: center;
    padding: 4px 8px;
    border: none;
    border-radius: 6px;
    background: transparent;
    cursor: pointer;
    text-align: left;
    transition: background-color var(--duration-quick) ease-out;
  }

  .search-result:hover {
    background: var(--app-hover);
  }

  .search-result:focus-visible {
    outline: 2px solid var(--app-accent);
    outline-offset: -2px;
  }

  .result-path {
    overflow: hidden;
    color: var(--app-text);
    font-size: 12px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .result-line {
    color: var(--app-text-muted);
    font-family: var(--font-mono);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
  }

  .result-preview {
    overflow: hidden;
    color: var(--app-text-muted);
    font-family: var(--font-mono);
    font-size: 11px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .search-empty {
    margin: 0;
    padding: 6px 8px;
    color: var(--app-text-muted);
    font-size: 12px;
  }

  /* Caminho atual + subir: uma linha, alinhada ao inicio das linhas da arvore. */
  .path-bar {
    display: flex;
    flex: none;
    align-items: center;
    gap: 4px;
    min-height: 30px;
    padding: 0 8px 0 6px;
    border-bottom: 1px solid color-mix(in srgb, var(--app-border) 80%, transparent);
  }

  .path-bar :global(.path-up) {
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    flex: none;
    padding: 0;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--app-text-muted);
    cursor: pointer;
    transition: background-color var(--duration-quick) ease-out, color var(--duration-quick) ease-out, transform var(--duration-quick) var(--ease-smooth-out);
  }

  .path-bar :global(.path-up:hover) {
    background: var(--app-hover);
    color: var(--app-text);
  }

  .path-bar :global(.path-up:active) {
    transform: scale(var(--scale-press));
  }

  .path-bar :global(.path-up:focus-visible) {
    outline: 2px solid var(--app-accent);
    outline-offset: 1px;
  }

  .current-path {
    min-width: 0;
    margin: 0;
    overflow: hidden;
    color: var(--app-text-soft);
    font-family: var(--font-mono);
    font-size: 11px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .graph-view {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 8px 12px;
  }

  .graph-view pre {
    margin: 0;
    font-family: var(--font-mono);
    font-size: 11px;
    font-variant-ligatures: none;
    line-height: 1.55;
    color: var(--app-text-soft);
  }

  .hidden {
    display: none;
  }

  /* Branch e informacao, nao estado: chip neutro com texto mono. */
  .branch-badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 20px;
    max-width: 140px;
    margin-left: 8px;
    padding: 0 7px;
    overflow: hidden;
    border-radius: 6px;
    background: var(--app-hover);
    color: var(--app-text-soft);
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 400;
    text-overflow: ellipsis;
    vertical-align: 1px;
    white-space: nowrap;
  }

  .branch-badge :global(svg) {
    flex: none;
    color: var(--app-success);
  }

  .branch-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .tree-body {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
    overflow-y: auto;
    padding: 6px;
  }

  .tree-entry {
    display: flex;
    flex: none;
    align-items: center;
    gap: 8px;
    width: 100%;
    min-height: 28px;
    padding: 0 8px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--app-text-soft);
    font-size: 12.5px;
    cursor: pointer;
    text-align: left;
    transition: background-color var(--duration-quick) ease-out, color var(--duration-quick) ease-out;
  }

  .tree-entry:hover {
    background: var(--app-hover);
    color: var(--app-text);
  }

  .tree-entry:active {
    background: var(--app-active);
  }

  .tree-entry:focus-visible {
    outline: 2px solid var(--app-accent);
    outline-offset: -2px;
  }

  .entry-icon {
    display: inline-flex;
    flex: none;
    color: var(--app-text-muted);
  }

  .directory .entry-icon {
    color: color-mix(in srgb, var(--app-success) 70%, var(--app-text-muted));
  }

  .entry-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* A seta so aparece ao apontar: diz "entra aqui" sem poluir a lista em repouso. */
  .tree-entry :global(.entry-chevron) {
    flex: none;
    color: var(--app-text-muted);
    opacity: 0;
    transition: opacity var(--duration-quick) ease-out;
  }

  .tree-entry:hover :global(.entry-chevron),
  .tree-entry:focus-visible :global(.entry-chevron) {
    opacity: 1;
  }

  /* Marcador git como chip legivel: a cor diz o tipo, a letra continua igual. */
  .entry-status {
    display: inline-grid;
    place-items: center;
    min-width: 18px;
    height: 18px;
    flex: none;
    padding: 0 4px;
    border-radius: 5px;
    background: var(--app-warning-soft);
    color: var(--app-warning);
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 600;
    line-height: 1;
  }

  .entry-status[data-tone='added'] {
    background: var(--app-success-soft);
    color: var(--app-success);
  }

  .entry-status[data-tone='deleted'],
  .entry-status[data-tone='conflict'] {
    background: var(--app-danger-soft);
    color: var(--app-danger);
  }

  .entry-status[data-tone='renamed'] {
    background: var(--app-info-soft);
    color: var(--app-info);
  }

  .tree-loading {
    display: grid;
    gap: 6px;
    padding: 6px 8px;
  }

  .tree-skeleton {
    display: block;
    width: var(--w);
    height: 12px;
    margin: 4px 0;
    border-radius: 4px;
    background: var(--app-hover);
    animation: tree-pulse 1.4s ease-in-out infinite;
  }

  @keyframes tree-pulse {
    50% {
      opacity: 0.45;
    }
  }

  .tree-error {
    display: flex;
    flex: none;
    align-items: flex-start;
    gap: 8px;
    margin-bottom: 4px;
    padding: 8px 10px;
    border-radius: 8px;
    background: var(--app-danger-soft);
    color: var(--app-danger);
  }

  .tree-error :global(svg) {
    flex: none;
    margin-top: 1px;
  }

  .error {
    flex: 1;
    min-width: 0;
    color: var(--app-text);
    font-size: 12px;
    line-height: 1.45;
    overflow-wrap: anywhere;
  }

  .tree-error-retry {
    flex: none;
    height: 24px;
    margin: -3px 0;
    padding: 0 8px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--app-danger);
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: background-color var(--duration-quick) ease-out;
  }

  .tree-error-retry:hover {
    background: color-mix(in srgb, var(--app-danger) 14%, transparent);
  }

  .tree-error-retry:focus-visible {
    outline: 2px solid var(--app-accent);
    outline-offset: 1px;
  }

  @media (prefers-reduced-motion: reduce) {
    .tree-skeleton {
      animation: none;
    }
  }
</style>
