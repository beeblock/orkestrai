<script lang="ts">
  import { onMount } from 'svelte';
  import type { NodeProps } from '@xyflow/svelte';
  import { CircleAlert, CircleCheck, FileCode2, FileDiff, GitBranch, GitCompareArrows, LoaderCircle, Minus, Plus, RefreshCw, Undo2, X } from '@lucide/svelte';
  import NodeShell from './NodeShell.svelte';
  import HeaderIconButton from './HeaderIconButton.svelte';
  import NodeEmptyState from './NodeEmptyState.svelte';
  import { Button } from '$lib/components/ui/button';
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
  // So estado de tela: nao anunciar "tudo limpo" antes do primeiro status chegar.
  let loaded = $state(false);
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
    } finally {
      loaded = true;
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

  // Marcador git -> tom e nome legivel; a letra (e o * de preparado) continua no chip.
  function statusTone(change: GitChange): 'modified' | 'added' | 'deleted' | 'conflict' | 'renamed' {
    const code = change.status.charAt(0);
    if (code === 'A' || code === '?') return 'added';
    if (code === 'D') return 'deleted';
    if (code === 'U') return 'conflict';
    if (code === 'R' || code === 'C') return 'renamed';
    return 'modified';
  }

  function statusName(change: GitChange): string {
    const code = change.status.charAt(0);
    const name = code === 'A' ? m['git.status_added']()
      : code === '?' ? m['git.status_untracked']()
        : code === 'D' ? m['git.status_deleted']()
          : code === 'U' ? m['git.status_conflict']()
            : code === 'R' ? m['git.status_renamed']()
              : code === 'C' ? m['git.status_copied']()
                : code === 'T' ? m['git.status_type']()
                  : m['git.status_modified']();
    return change.staged ? m['git.status_staged']({ status: name }) : name;
  }

  function splitPath(path: string): { name: string; dir: string } {
    const index = path.lastIndexOf('/');
    return index < 0 ? { name: path, dir: '' } : { name: path.slice(index + 1), dir: path.slice(0, index) };
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
      <span class="branch-badge" title={branch}><GitBranch size={11} aria-hidden="true" /><span class="branch-name">{branch}</span></span>
    {/if}
  {/snippet}
  {#snippet actions()}
    <HeaderIconButton class="node-action-btn" label={m['diff.reload']()} onclick={refresh}><RefreshCw size={13} /></HeaderIconButton>
    <HeaderIconButton class="node-action-btn" label={m['diff.remove']()} danger onclick={() => data.onDelete(id)}><X size={13} /></HeaderIconButton>
  {/snippet}

  {#if !isRepo}
    <NodeEmptyState icon={GitBranch} title={m['diff.not_repo']()} description={m['git.not_repo_hint']()} />
  {:else if !loaded}
    <div class="diff-loading" role="status">
      <span class="loading-pill"><LoaderCircle size={13} class="animate-spin" aria-hidden="true" />{m['review_center.loading']()}</span>
    </div>
  {:else if changes.length === 0}
    <NodeEmptyState icon={CircleCheck} title={m['diff.clean_title']()} description={m['diff.clean_hint']()} />
  {:else}
    <div class="diff-columns nodrag nowheel">
      <aside class="change-list" aria-label={m['git.changes']()}>
        <header class="list-head">
          <span class="section-label">{m['git.changes']()}</span>
          <span class="list-count">{changes.length}</span>
        </header>
        {#each changes as change (change.path + change.staged)}
          {@const parts = splitPath(change.path)}
          <div class="change-row" class:active={selectedPath === change.path}>
            <button
              class="change-open"
              onclick={() => openDiff(change)}
              aria-label={`${m['diff.view_diff']()}: ${change.path}`}
              aria-current={selectedPath === change.path ? 'true' : undefined}
              title={change.path}
            >
              <!-- O texto do chip segue "M" / "M*"; o * vira um ponto verde so no visual. -->
              <span class="change-status" class:staged={change.staged} data-tone={statusTone(change)} title={statusName(change)}>{change.status}{#if change.staged}<span class="staged-mark">*</span>{/if}</span>
              <span class="change-name">{parts.name}</span>
              {#if parts.dir}<span class="change-dir">{parts.dir}</span>{/if}
            </button>
            <!-- Acoes da linha aparecem ao apontar/focar, sobre o fim do caminho. -->
            <span class="change-actions">
              {#if change.staged}
                <HeaderIconButton class="row-action" label="Unstage" onclick={() => gitAction('unstage', change.path)}><Minus size={13} /></HeaderIconButton>
              {:else}
                <HeaderIconButton class="row-action" label="Stage" onclick={() => gitAction('stage', change.path)}><Plus size={13} /></HeaderIconButton>
                <HeaderIconButton class="row-action danger" label={m['diff.discard_label']()} onclick={() => gitAction('discard', change.path)}><Undo2 size={13} /></HeaderIconButton>
              {/if}
              <HeaderIconButton class="row-action" label={m['diff.open_editor_label']()} onclick={() => data.onOpenFile?.(change.path)}><FileCode2 size={13} /></HeaderIconButton>
            </span>
          </div>
        {/each}
      </aside>

      <div class="diff-view">
        {#if selectedPath}
          <div class="diff-head">
            <FileDiff size={13} aria-hidden="true" />
            <p class="diff-path" title={selectedPath}>{selectedPath}</p>
            {#if data.onOpenFile && diffText !== m['diff.empty_diff']()}
              <HeaderIconButton class="row-action" label={m['diff.open_editor_label']()} side="left" onclick={() => data.onOpenFile?.(selectedPath!)}><FileCode2 size={13} /></HeaderIconButton>
            {/if}
          </div>
          {#if diffText === m['diff.empty_diff']()}
            <!-- Diff vazio (arquivo novo): explica e oferece o proximo passo em vez de uma linha solta. -->
            <NodeEmptyState icon={FileDiff} compact title={m['diff.empty_title']()} description={m['diff.empty_hint']()} class="h-auto! flex-1">
              {#snippet actions()}
                {#if data.onOpenFile}
                  <Button variant="outline" size="sm" onclick={() => data.onOpenFile?.(selectedPath!)}><FileCode2 />{m['diff.open_editor_label']()}</Button>
                {/if}
              {/snippet}
            </NodeEmptyState>
          {:else}
            <pre class="diff-text">{#each diffText.split('\n') as line}<span class={lineClass(line)}>{line}
</span>{/each}</pre>
          {/if}
        {:else}
          <NodeEmptyState icon={FileDiff} compact title={m['diff.select_title']()} description={m['diff.select_hint']()} />
        {/if}
      </div>
    </div>
  {/if}
  {#if errorMessage}
    <p class="error" role="alert"><CircleAlert size={13} aria-hidden="true" /><span>{errorMessage}</span></p>
  {/if}
</NodeShell>

<style>
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

  .diff-loading {
    display: grid;
    flex: 1;
    place-items: center;
  }

  .loading-pill {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    height: 28px;
    padding: 0 12px;
    border-radius: 999px;
    background: var(--app-hover);
    color: var(--app-text-soft);
    font-size: 12px;
  }

  .diff-columns {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: minmax(170px, 38%) 1fr;
  }

  .change-list {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
    overflow-y: auto;
    border-right: 1px solid color-mix(in srgb, var(--app-border) 80%, transparent);
    padding: 4px 6px 8px;
  }

  .list-head {
    display: flex;
    flex: none;
    align-items: center;
    justify-content: space-between;
    height: 28px;
    padding: 0 8px;
  }

  .list-count {
    color: var(--app-text-muted);
    font-family: var(--font-mono);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
  }

  .change-row {
    position: relative;
    display: flex;
    flex: none;
    align-items: center;
    min-height: 30px;
    border-radius: 6px;
    transition: background-color var(--duration-quick) ease-out;
  }

  .change-row:hover {
    background: var(--app-hover);
  }

  .change-row.active {
    background: var(--app-active);
  }

  .change-open {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    height: 30px;
    padding: 0 8px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--app-text-soft);
    font-size: 12px;
    cursor: pointer;
    text-align: left;
  }

  .change-open:focus-visible {
    outline: 2px solid var(--app-accent);
    outline-offset: -2px;
  }

  .change-row.active .change-open,
  .change-open:hover {
    color: var(--app-text);
  }

  .change-name {
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .change-dir {
    flex: 1 1 0;
    min-width: 0;
    overflow: hidden;
    color: var(--app-text-muted);
    font-size: 11px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Marcador git como chip legivel: a cor diz o tipo, a letra continua igual. */
  .change-status {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 2px;
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

  .change-status[data-tone='added'] {
    background: var(--app-success-soft);
    color: var(--app-success);
  }

  .change-status[data-tone='deleted'],
  .change-status[data-tone='conflict'] {
    background: var(--app-danger-soft);
    color: var(--app-danger);
  }

  .change-status[data-tone='renamed'] {
    background: var(--app-info-soft);
    color: var(--app-info);
  }

  /* Preparado: o "*" continua no texto, mas aparece como um ponto verde. */
  .staged-mark {
    display: inline-block;
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--app-success);
    font-size: 0;
  }

  .change-actions {
    position: absolute;
    top: 50%;
    right: 3px;
    display: inline-flex;
    align-items: center;
    gap: 1px;
    padding: 1px;
    border-radius: 7px;
    background: var(--app-surface-raised);
    box-shadow: var(--app-shadow-border);
    opacity: 0;
    transform: translateY(-50%);
    transition: opacity var(--duration-quick) ease-out;
  }

  .change-row:hover .change-actions,
  .change-row:focus-within .change-actions {
    opacity: 1;
  }

  .diff-columns :global(.row-action) {
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

  .diff-columns :global(.row-action:hover) {
    background: var(--app-hover);
    color: var(--app-text);
  }

  .diff-columns :global(.row-action.danger:hover) {
    background: var(--app-danger-soft);
    color: var(--app-danger);
  }

  .diff-columns :global(.row-action:active) {
    transform: scale(var(--scale-press));
  }

  .diff-columns :global(.row-action:focus-visible) {
    outline: 2px solid var(--app-accent);
    outline-offset: 1px;
  }

  .diff-view {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    overflow: auto;
  }

  .diff-head {
    position: sticky;
    top: 0;
    z-index: 1;
    display: flex;
    flex: none;
    align-items: center;
    gap: 7px;
    min-height: 34px;
    padding: 0 6px 0 12px;
    border-bottom: 1px solid color-mix(in srgb, var(--app-border) 80%, transparent);
    background: var(--app-surface);
    color: var(--app-text-muted);
  }

  .diff-path {
    flex: 1;
    min-width: 0;
    margin: 0;
    overflow: hidden;
    color: var(--app-text-soft);
    font-family: var(--font-mono);
    font-size: 11px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .diff-text {
    margin: 0;
    padding: 6px 0 10px;
    font-family: var(--font-mono);
    font-size: 11.5px;
    /* Sem ligaduras: num diff, "=>" e "+++" precisam aparecer como foram escritos. */
    font-variant-ligatures: none;
    line-height: 1.55;
    white-space: pre-wrap;
    word-break: break-all;
    color: var(--app-text-soft);
  }

  .diff-text > span {
    display: block;
    padding: 0 12px;
  }

  .diff-add {
    color: var(--app-success);
    background: color-mix(in srgb, var(--app-success) 9%, transparent);
    box-shadow: inset 2px 0 0 color-mix(in srgb, var(--app-success) 55%, transparent);
  }

  .diff-del {
    color: var(--app-danger);
    background: color-mix(in srgb, var(--app-danger) 9%, transparent);
    box-shadow: inset 2px 0 0 color-mix(in srgb, var(--app-danger) 55%, transparent);
  }

  .diff-hunk {
    margin: 6px 0 2px;
    color: var(--app-info);
    background: var(--app-info-soft);
  }

  .diff-meta {
    color: var(--app-text-muted);
  }

  .error {
    display: flex;
    flex: none;
    align-items: flex-start;
    gap: 7px;
    margin: 0;
    padding: 8px 12px;
    border-top: 1px solid color-mix(in srgb, var(--app-danger) 30%, transparent);
    background: var(--app-danger-soft);
    color: var(--app-text);
    font-size: 12px;
    line-height: 1.45;
  }

  .error :global(svg) {
    flex: none;
    margin-top: 2px;
    color: var(--app-danger);
  }
</style>
