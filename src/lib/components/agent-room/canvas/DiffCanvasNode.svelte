<script lang="ts">
  import { onMount } from 'svelte';
  import type { NodeProps } from '@xyflow/svelte';
  import { GitCompareArrows, RefreshCw, X } from '@lucide/svelte';
  import NodeShell from './NodeShell.svelte';
  import HeaderIconButton from './HeaderIconButton.svelte';
  import * as m from '$lib/paraglide/messages.js';

  export type DiffNodeData = {
    title: string;
    workspaceId: string;
    onDelete: (id: string) => void;
    onResize?: (id: string, params: { x: number; y: number; width: number; height: number }) => void;
    onOpenFile?: (path: string) => void;
  };

  type GitChange = { path: string; status: string; staged: boolean };

  let { id, data, selected } = $props<NodeProps & { data: DiffNodeData }>();

  let changes = $state<GitChange[]>([]);
  let branch = $state<string | null>(null);
  let isRepo = $state(true);
  let selectedPath = $state<string | null>(null);
  let diffText = $state('');
  let errorMessage = $state('');
  let refreshTimer: ReturnType<typeof setInterval> | null = null;

  async function api<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(path, {
      ...init,
      headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    });
    const payload = await response.json();
    if (!response.ok || payload.error) throw new Error(payload.error || m['diff.error_api']());
    return payload.data as T;
  }

  async function refresh() {
    try {
      const status = await api<{ isRepo: boolean; branch: string | null; changes: GitChange[] }>(
        `/api/agent-room/workspaces/${data.workspaceId}/git/status`
      );
      changes = status.changes;
      branch = status.branch;
      isRepo = status.isRepo;
      if (selectedPath && !changes.some((change) => change.path === selectedPath)) {
        selectedPath = null;
        diffText = '';
      }
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : m['diff.error_status']();
    }
  }

  async function openDiff(change: GitChange) {
    selectedPath = change.path;
    errorMessage = '';
    try {
      const result = await api<{ diff: string }>(
        `/api/agent-room/workspaces/${data.workspaceId}/git/diff?path=${encodeURIComponent(change.path)}&staged=${change.staged}`
      );
      diffText = result.diff || m['diff.empty_diff']();
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : m['diff.error_read']();
    }
  }

  async function gitAction(action: 'stage' | 'unstage' | 'discard', path: string) {
    errorMessage = '';
    try {
      await api(`/api/agent-room/workspaces/${data.workspaceId}/git/${action}`, {
        method: 'POST',
        body: JSON.stringify({ path }),
      });
      await refresh();
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : m['diff.error_action']({ action });
    }
  }

  function stageChange() {
    const change = changes.find((item) => item.path === selectedPath);
    if (change) gitAction('stage', change.path);
  }

  function statusLabel(change: GitChange): string {
    return change.staged ? change.status + '*' : change.status;
  }

  function lineClass(line: string): string {
    if (line.startsWith('+') && !line.startsWith('+++')) return 'diff-add';
    if (line.startsWith('-') && !line.startsWith('---')) return 'diff-del';
    if (line.startsWith('@@')) return 'diff-hunk';
    if (line.startsWith('diff --git') || line.startsWith('index')) return 'diff-meta';
    return '';
  }

  onMount(() => {
    refresh();
    refreshTimer = setInterval(refresh, 8_000);
    return () => {
      if (refreshTimer) clearInterval(refreshTimer);
    };
  });
</script>

<NodeShell
  {id}
  {selected}
  class="canvas-diff"
  accent="var(--app-secondary)"
  minWidth={380}
  minHeight={240}
  onResize={data.onResize}
  connections={data.connections ?? []}
  titleText={data.title}
  onRename={data.onRename}
  onJumpToNode={data.onJumpToNode}
  onRemoveConnection={data.onRemoveConnection}
>
  {#snippet icon()}<GitCompareArrows size={13} />{/snippet}
  {#snippet title()}
    {data.title || 'Diff'}
    {#if branch}
      <span class="branch-badge">{branch}</span>
    {/if}
  {/snippet}
  {#snippet actions()}
    <HeaderIconButton class="node-action-btn" label={m['diff.reload']()} onclick={refresh}><RefreshCw size={13} /></HeaderIconButton>
    <HeaderIconButton class="node-action-btn" label={m['diff.remove']()} danger onclick={() => data.onDelete(id)}><X size={13} /></HeaderIconButton>
  {/snippet}

  {#if !isRepo}
    <p class="empty">{m['diff.not_repo']()}</p>
  {:else}
    <div class="diff-columns nodrag nowheel">
      <aside class="change-list">
        {#each changes as change (change.path + change.staged)}
          <div class="change-row" class:active={selectedPath === change.path}>
            <button class="change-open" onclick={() => openDiff(change)} aria-label={m['diff.view_diff']()}>
              <span class="change-status" class:staged={change.staged}>{statusLabel(change)}</span>
              {change.path}
            </button>
            <span class="change-actions">
              {#if change.staged}
                <button aria-label="Unstage" onclick={() => gitAction('unstage', change.path)}>unstage</button>
              {:else}
                <button aria-label="Stage" onclick={() => gitAction('stage', change.path)}>stage</button>
                <button aria-label={m['diff.discard_label']()} onclick={() => gitAction('discard', change.path)}>{m['diff.discard']()}</button>
              {/if}
              <button aria-label={m['diff.open_editor_label']()} onclick={() => data.onOpenFile?.(change.path)}>{m['diff.open']()}</button>
            </span>
          </div>
        {/each}
        {#if changes.length === 0}
          <p class="empty">{m['diff.clean']()}</p>
        {/if}
      </aside>

      <div class="diff-view">
        {#if selectedPath}
          <p class="diff-path">{selectedPath}</p>
          <pre class="diff-text">{#each diffText.split('\n') as line}<span class={lineClass(line)}>{line}
</span>{/each}</pre>
        {:else}
          <p class="empty">{m['diff.select_file']()}</p>
        {/if}
      </div>
    </div>
  {/if}
  {#if errorMessage}
    <p class="error">{errorMessage}</p>
  {/if}
</NodeShell>

<style>
  .branch-badge {
    font-size: 11px;
    color: var(--app-success);
    background: color-mix(in srgb, var(--app-success) 12%, transparent);
    padding: 1px 7px;
    border-radius: 8px;
  }

  .diff-columns {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: minmax(140px, 38%) 1fr;
  }

  .change-list {
    overflow-y: auto;
    border-right: 1px solid var(--app-surface-raised);
    padding: 4px;
  }

  .change-row {
    display: flex;
    align-items: center;
    border-radius: 5px;
  }

  .change-row.active {
    background: var(--app-surface-raised);
  }

  .change-open {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 3px 6px;
    border: none;
    background: transparent;
    color: var(--app-text-soft);
    font-size: 11px;
    cursor: pointer;
    text-align: left;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .change-status {
    color: var(--app-warning);
    font-weight: 700;
  }

  .change-status.staged {
    color: var(--app-success);
  }

  .change-actions {
    display: flex;
  }

  .change-actions button {
    border: none;
    background: transparent;
    color: var(--app-text-muted);
    cursor: pointer;
    font-size: 11px;
    padding: 1px 3px;
  }

  .change-actions button:hover {
    color: var(--app-text);
  }

  .diff-view {
    overflow: auto;
    padding: 6px;
  }

  .diff-path {
    margin: 0 0 6px;
    font-size: 10px;
    color: var(--app-text-muted);
  }

  .diff-text {
    margin: 0;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 11px;
    line-height: 1.45;
    white-space: pre-wrap;
    word-break: break-all;
  }

  .diff-add {
    color: var(--app-success);
    background: color-mix(in srgb, var(--app-success) 8%, transparent);
    display: block;
  }

  .diff-del {
    color: var(--app-danger);
    background: color-mix(in srgb, var(--app-danger) 8%, transparent);
    display: block;
  }

  .diff-hunk {
    color: var(--app-secondary);
    display: block;
  }

  .diff-meta {
    color: var(--app-text-muted);
    display: block;
  }

  .empty {
    color: var(--app-text-muted);
    font-size: 11px;
    padding: 8px;
  }

  .error {
    margin: 0;
    padding: 4px 10px;
    font-size: 11px;
    color: var(--app-danger);
    border-top: 1px solid var(--app-surface-raised);
  }
</style>
