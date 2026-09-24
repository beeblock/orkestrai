<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { getCsrfToken } from '@beeblock/svelar/http';
  import {
    Archive, ArchiveRestore, ArrowDownToLine, ArrowUpFromLine, Check, CircleAlert, FileDiff, GitBranch, GitCommitHorizontal,
    GitFork, GitMerge, History, LoaderCircle, Minus, MoreHorizontal, Plus, RefreshCw, Tag, Trash2, X,
  } from '@lucide/svelte';
  import * as AlertDialog from '$lib/components/ui/alert-dialog';
  import * as Dialog from '$lib/components/ui/dialog';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
  import * as Tabs from '$lib/components/ui/tabs';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import type {
    GitChange, GitOperationPreview, GitWorkspaceSnapshot,
  } from '$lib/modules/agent-room/application/services/GitService.js';
  import type { GitOperationInput } from '$lib/modules/agent-room/contracts/schemas/fsSchemas.js';
  import { workbenchReviewCenterItemId } from './workbench-review-center.js';
  import HeaderIconButton from './canvas/HeaderIconButton.svelte';
  import NodeEmptyState from './canvas/NodeEmptyState.svelte';
  import * as m from '$lib/paraglide/messages.js';

  let {
    workspaceId,
    compact = false,
  }: {
    workspaceId: string;
    compact?: boolean;
  } = $props();

  let snapshot = $state<GitWorkspaceSnapshot | null>(null);
  let loading = $state(true);
  let busy = $state(false);
  let errorMessage = $state('');
  let activeTab = $state('changes');
  let commitMessage = $state('');
  let branchDialogOpen = $state(false);
  let branchName = $state('');
  let tagDialogOpen = $state(false);
  let tagName = $state('');
  let tagMessage = $state('');
  let pendingInput = $state<GitOperationInput | null>(null);
  let pendingPreview = $state<GitOperationPreview | null>(null);
  let refreshTimer: ReturnType<typeof setInterval> | null = null;

  const staged = $derived(snapshot?.status.changes.filter((change) => change.staged) ?? []);
  const unstaged = $derived(snapshot?.status.changes.filter((change) => !change.staged) ?? []);
  // Mesma condicao do botao Commitar; aqui so decide a aparencia (acende quando esta pronto).
  const canCommit = $derived(!busy && Boolean(commitMessage.trim()) && staged.length > 0);

  // Marcador git -> tom e nome legivel; a letra continua visivel no chip.
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
    return code === 'A' ? m['git.status_added']()
      : code === '?' ? m['git.status_untracked']()
        : code === 'D' ? m['git.status_deleted']()
          : code === 'U' ? m['git.status_conflict']()
            : code === 'R' ? m['git.status_renamed']()
              : code === 'C' ? m['git.status_copied']()
                : code === 'T' ? m['git.status_type']()
                  : m['git.status_modified']();
  }

  function splitPath(path: string): { name: string; dir: string } {
    const index = path.lastIndexOf('/');
    return index < 0 ? { name: path, dir: '' } : { name: path.slice(index + 1), dir: path.slice(0, index) };
  }

  function headers(): HeadersInit {
    const csrf = getCsrfToken();
    return { 'content-type': 'application/json', ...(csrf ? { 'X-CSRF-Token': csrf } : {}) };
  }

  async function api<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(path, init);
    const payload = await response.json();
    if (!response.ok || payload.error) throw new Error(payload.error || m['git.error_api']());
    return payload.data as T;
  }

  async function refresh(): Promise<void> {
    try {
      snapshot = await api<GitWorkspaceSnapshot>(`/api/agent-room/workspaces/${workspaceId}/git/workspace`);
      errorMessage = '';
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : m['git.error_load']();
    } finally {
      loading = false;
    }
  }

  async function mutate(endpoint: string, body: Record<string, unknown> = {}): Promise<void> {
    if (busy) return;
    busy = true;
    try {
      await api(`/api/agent-room/workspaces/${workspaceId}/git/${endpoint}`, {
        method: 'POST', headers: headers(), body: JSON.stringify(body),
      });
      await refresh();
      errorMessage = '';
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : m['git.error_action']();
    } finally {
      busy = false;
    }
  }

  async function prepare(input: GitOperationInput): Promise<void> {
    if (busy) return;
    busy = true;
    try {
      const preview = await api<GitOperationPreview>(`/api/agent-room/workspaces/${workspaceId}/git/preview`, {
        method: 'POST', headers: headers(), body: JSON.stringify(input),
      });
      if (preview.confirmationRequired) {
        pendingInput = input;
        pendingPreview = preview;
      } else {
        await execute(input, preview, false);
      }
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : m['git.error_action']();
    } finally {
      busy = false;
    }
  }

  async function execute(input: GitOperationInput, preview: GitOperationPreview, confirmed: boolean): Promise<void> {
    const result = await api<{ snapshot: GitWorkspaceSnapshot }>(`/api/agent-room/workspaces/${workspaceId}/git/execute`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ ...input, expectedRevision: preview.revision, confirmed }),
    });
    snapshot = result.snapshot;
    errorMessage = '';
    pendingInput = null;
    pendingPreview = null;
  }

  async function confirmOperation(): Promise<void> {
    if (!pendingInput || !pendingPreview || busy) return;
    busy = true;
    try {
      await execute(pendingInput, pendingPreview, true);
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : m['git.error_action']();
    } finally {
      busy = false;
    }
  }

  async function createBranch(): Promise<void> {
    const name = branchName.trim();
    if (!name) return;
    await prepare({ operation: 'createBranch', name, force: false, setUpstream: false });
    if (!errorMessage) {
      branchName = '';
      branchDialogOpen = false;
    }
  }

  async function createTag(): Promise<void> {
    const name = tagName.trim();
    if (!name) return;
    await prepare({ operation: 'createTag', name, message: tagMessage.trim() || undefined, force: false, setUpstream: false });
    if (!errorMessage) {
      tagName = '';
      tagMessage = '';
      tagDialogOpen = false;
    }
  }

  async function commit(): Promise<void> {
    const message = commitMessage.trim();
    if (!message) return;
    await mutate('commit', { message });
    if (!errorMessage) commitMessage = '';
  }

  async function toggleStage(change: GitChange): Promise<void> {
    await mutate(change.staged ? 'unstage' : 'stage', { path: change.path });
  }

  function openReviewCenter(): void {
    void goto(`/terminal?workspace=${encodeURIComponent(workspaceId)}&node=${encodeURIComponent(workbenchReviewCenterItemId(workspaceId))}`);
  }

  onMount(() => {
    void refresh();
    refreshTimer = setInterval(() => void refresh(), 10_000);
    return () => refreshTimer && clearInterval(refreshTimer);
  });
</script>

<!-- Coluna flex: cabecalho e erro com altura propria, abas ocupam o resto e rolam. -->
<div class="gw flex h-full min-h-0 flex-col bg-[var(--app-canvas)] text-[var(--app-text)]">
  <header class="gw-head">
    <span class="gw-head-icon" aria-hidden="true"><GitBranch size={14} /></span>
    <div class="min-w-0 flex-1">
      <p class="gw-branch" title={snapshot?.status.branch ?? undefined}>{snapshot?.status.branch ?? m['git.detached']()}</p>
      <p class="gw-meta">
        {#if snapshot?.status.head}<span class="font-mono text-[10.5px] tabular-nums">{snapshot.status.head.slice(0, 8)}</span>{:else}<span>{m['git.no_commits']()}</span>{/if}
        {#if snapshot?.status.upstream}
          <span class="gw-sync" title={snapshot.status.upstream}><span>{snapshot.status.ahead}↑</span><span>{snapshot.status.behind}↓</span></span>
        {/if}
      </p>
    </div>
    <div class="gw-head-actions">
      <HeaderIconButton class="node-action-btn" side="bottom" label={m['git.fetch']()} onclick={() => void prepare({ operation: 'fetch', force: false, setUpstream: false })}><RefreshCw class={busy ? 'animate-spin' : ''} /></HeaderIconButton>
      <HeaderIconButton class="node-action-btn" side="bottom" label={m['git.pull']()} onclick={() => void prepare({ operation: 'pull', force: false, setUpstream: false })}><ArrowDownToLine /></HeaderIconButton>
      <HeaderIconButton class="node-action-btn" side="bottom" label={m['git.push']()} onclick={() => void prepare({ operation: 'push', force: false, setUpstream: false })}><ArrowUpFromLine /></HeaderIconButton>
    </div>
  </header>

  {#if errorMessage}
    <div class="gw-error" role="alert">
      <CircleAlert size={14} aria-hidden="true" />
      <p>{errorMessage}</p>
      <button type="button" class="gw-error-close" aria-label={m['git.dismiss_error']()} title={m['git.dismiss_error']()} onclick={() => (errorMessage = '')}><X size={13} /></button>
    </div>
  {/if}

  {#if loading}
    <div class="grid min-h-0 flex-1 place-items-center">
      <span class="gw-loading" role="status"><LoaderCircle size={13} class="animate-spin" aria-hidden="true" />{m['review_center.loading']()}</span>
    </div>
  {:else if !snapshot?.status.isRepo}
    <div class="min-h-0 flex-1"><NodeEmptyState icon={GitFork} title={m['git.not_repo']()} description={m['git.not_repo_hint']()} /></div>
  {:else}
    <Tabs.Root bind:value={activeTab} class="flex min-h-0 flex-1 flex-col gap-0">
      <Tabs.List class="gw-tabs h-9 w-full shrink-0 justify-start gap-0.5 overflow-x-auto rounded-none border-b border-[var(--app-border)] bg-[var(--app-surface)] px-1.5" variant="line">
        <Tabs.Trigger value="changes" class="h-7 flex-none px-2 text-ui-md"><GitCommitHorizontal class="size-3.5" />{m['git.changes']()}<span class="gw-tab-count">{snapshot.status.changes.length}</span></Tabs.Trigger>
        <Tabs.Trigger value="graph" class="h-7 flex-none px-2 text-ui-md"><History class="size-3.5" />{m['git.graph']()}</Tabs.Trigger>
        <Tabs.Trigger value="branches" class="h-7 flex-none px-2 text-ui-md"><GitBranch class="size-3.5" />{m['git.branches']()}</Tabs.Trigger>
        <Tabs.Trigger value="worktrees" class="h-7 flex-none px-2 text-ui-md"><GitFork class="size-3.5" />{m['git.worktrees']()}</Tabs.Trigger>
      </Tabs.List>

      <Tabs.Content value="changes" class="m-0 min-h-0 flex-1 overflow-y-auto">
        <!-- Compositor: mensagem + Commitar juntos; o botao so acende quando ha o que commitar. -->
        <div class="gw-composer">
          <div class="gw-composer-field">
            <input
              bind:value={commitMessage}
              placeholder={m['git.commit_placeholder']()}
              aria-label={m['git.commit_placeholder']()}
              spellcheck="false"
              autocomplete="off"
              onkeydown={(event: KeyboardEvent) => event.key === 'Enter' && void commit()}
            />
            <Button size="sm" variant={canCommit ? 'default' : 'ghost'} class="h-7 px-2.5 text-ui-md" disabled={busy || !commitMessage.trim() || staged.length === 0} onclick={() => void commit()}><Check />{m['git.commit']()}</Button>
          </div>
          <div class="gw-composer-foot">
            {#if staged.length === 0}
              <span class="gw-hint">{m['git.stage_hint']()}</span>
            {:else}
              <span></span>
            {/if}
            <Button variant="ghost" size="xs" class="text-ui-sm text-[var(--app-text-soft)]" onclick={openReviewCenter}><FileDiff />{m['git.review']()}</Button>
          </div>
        </div>
        {#each [{ title: m['git.staged'](), items: staged }, { title: m['git.unstaged'](), items: unstaged }] as section}
          <section class="gw-section">
            <header class="gw-section-head"><span class="section-label">{section.title}</span><span class="gw-count">{section.items.length}</span></header>
            {#each section.items as change (change.id)}
              {@const parts = splitPath(change.path)}
              <div class="gw-row group">
                <span class="gw-status" data-tone={statusTone(change.status)} title={statusName(change.status)} aria-hidden="true">{change.status}</span>
                <span class="sr-only">{statusName(change.status)}</span>
                <button class="gw-row-main" title={change.path} onclick={openReviewCenter}>
                  <span class="gw-row-name">{parts.name}</span>
                  {#if parts.dir}<span class="gw-row-dir">{parts.dir}</span>{/if}
                </button>
                <span class="gw-reveal">
                  <HeaderIconButton class="gw-icon-btn" label={change.staged ? m['git.unstage']() : m['git.stage']()} side="left" onclick={() => void toggleStage(change)}>{#if change.staged}<Minus />{:else}<Plus />{/if}</HeaderIconButton>
                </span>
              </div>
            {:else}
              <p class="gw-empty-line">{m['git.no_changes']()}</p>
            {/each}
          </section>
        {/each}
        <div class="gw-footer">
          <Button variant="ghost" size="sm" class="h-7 text-ui-sm text-[var(--app-text-soft)]" onclick={() => void prepare({ operation: 'stash', force: false, setUpstream: false })}><Archive />{m['git.stash']()}</Button>
          {#if snapshot.stashes[0]}<Button variant="ghost" size="sm" class="h-7 text-ui-sm text-[var(--app-text-soft)]" onclick={() => void prepare({ operation: 'stashPop', ref: snapshot?.stashes[0]?.ref, force: false, setUpstream: false })}><ArchiveRestore />{m['git.stash_pop']()}</Button>{/if}
        </div>
      </Tabs.Content>

      <Tabs.Content value="graph" class="m-0 min-h-0 flex-1 overflow-y-auto px-2 py-1.5">
        {#each snapshot.commits as commit, index (commit.hash)}
          <div class="gw-commit group">
            {#if index < snapshot.commits.length - 1}<span class="gw-commit-line" aria-hidden="true"></span>{/if}
            <span class="gw-commit-dot" class:head={index === 0} aria-hidden="true"></span>
            <div class="min-w-0">
              <p class="gw-commit-subject" title={commit.subject}>{commit.subject}</p>
              <p class="gw-commit-meta">{commit.author} · <span class="tabular-nums">{new Date(commit.authoredAt).toLocaleString()}</span></p>
              {#if commit.decorations.length}<div class="mt-1 flex flex-wrap gap-1">{#each commit.decorations as decoration}<span class="gw-chip">{decoration}</span>{/each}</div>{/if}
            </div>
            <div class="flex items-center gap-1 self-start">
              <code class="gw-hash">{commit.shortHash}</code>
              <DropdownMenu.Root>
                <DropdownMenu.Trigger class="gw-icon-btn gw-reveal-btn" aria-label={m['git.commit_actions']()}><MoreHorizontal size={13} /></DropdownMenu.Trigger>
                <DropdownMenu.Content align="end">
                  <DropdownMenu.Item onclick={() => void prepare({ operation: 'cherryPick', ref: commit.hash, force: false, setUpstream: false })}>{m['git.cherry_pick']()}</DropdownMenu.Item>
                  <DropdownMenu.Item onclick={() => void prepare({ operation: 'revert', ref: commit.hash, force: false, setUpstream: false })}>{m['git.revert_commit']()}</DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Root>
            </div>
          </div>
        {:else}
          <NodeEmptyState icon={History} compact title={m['git.no_commits']()} />
        {/each}
      </Tabs.Content>

      <Tabs.Content value="branches" class="m-0 min-h-0 flex-1 overflow-y-auto">
        <div class="gw-toolbar">
          <span class="section-label min-w-0 truncate">{m['git.local_and_remote']()}</span>
          <div class="flex shrink-0 gap-1.5">
            <Button variant="ghost" size="sm" class="h-7 text-ui-sm text-[var(--app-text-soft)]" onclick={() => (tagDialogOpen = true)}><Tag />{m['git.new_tag']()}</Button>
            <Button variant="outline" size="sm" class="h-7 text-ui-sm" onclick={() => (branchDialogOpen = true)}><Plus />{m['git.new_branch']()}</Button>
          </div>
        </div>
        {#if snapshot.branches.length === 0 && snapshot.tags.length === 0}
          <NodeEmptyState icon={GitBranch} compact title={m['git.no_branches']()} description={snapshot.status.head ? undefined : m['git.no_branches_hint']()} class="h-auto! py-10!" />
        {/if}
        <div class="px-1.5 py-1">
          {#each snapshot.branches as branch (branch.name)}
            <div class="gw-branch-row group" class:current={branch.current}>
              <GitBranch size={13} class={branch.current ? 'shrink-0 text-[var(--app-success)]' : 'shrink-0 text-[var(--app-text-muted)]'} aria-hidden="true" />
              <button class="gw-branch-name" title={branch.name} disabled={branch.current || branch.remote} onclick={() => void prepare({ operation: 'checkout', ref: branch.name, force: false, setUpstream: false })}>{branch.name}</button>
              {#if branch.remote}<span class="gw-chip">{m['git.remote_branch']()}</span>{/if}
              {#if branch.upstream}<span class="gw-sync"><span>{branch.ahead}↑</span><span>{branch.behind}↓</span></span>{/if}
              {#if branch.current}
                <span class="gw-current" title={m['git.current_branch']()}><Check size={13} aria-hidden="true" /><span class="sr-only">{m['git.current_branch']()}</span></span>
              {:else if !branch.remote}
                <DropdownMenu.Root>
                  <DropdownMenu.Trigger class="gw-icon-btn gw-reveal-btn" aria-label={m['git.branch_actions']()}><MoreHorizontal size={13} /></DropdownMenu.Trigger>
                  <DropdownMenu.Content align="end">
                    <DropdownMenu.Item onclick={() => void prepare({ operation: 'merge', ref: branch.name, force: false, setUpstream: false })}>{m['git.merge_branch']()}</DropdownMenu.Item>
                    <DropdownMenu.Item onclick={() => void prepare({ operation: 'rebase', ref: branch.name, force: false, setUpstream: false })}>{m['git.rebase_branch']()}</DropdownMenu.Item>
                    <DropdownMenu.Separator />
                    <DropdownMenu.Item class="text-[var(--app-danger)]" onclick={() => void prepare({ operation: 'deleteBranch', ref: branch.name, force: false, setUpstream: false })}><Trash2 />{m['git.delete_branch']()}</DropdownMenu.Item>
                  </DropdownMenu.Content>
                </DropdownMenu.Root>
              {/if}
            </div>
          {/each}
        </div>
        {#if snapshot.tags.length}
          <div class="px-1.5 pb-2">
            <header class="gw-section-head mt-1"><span class="section-label">{m['git.tags']()}</span><span class="gw-count">{snapshot.tags.length}</span></header>
            {#each snapshot.tags as tag}
              <div class="gw-branch-row group">
                <Tag size={12} class="shrink-0 text-[var(--app-warning)]" aria-hidden="true" />
                <span class="min-w-0 flex-1 truncate text-ui-md" title={tag.name}>{tag.name}</span>
                <code class="gw-hash">{tag.target.slice(0, 8)}</code>
                <span class="gw-reveal">
                  <HeaderIconButton class="gw-icon-btn danger" label={m['git.delete_tag']()} side="left" onclick={() => void prepare({ operation: 'deleteTag', ref: tag.name, force: false, setUpstream: false })}><Trash2 /></HeaderIconButton>
                </span>
              </div>
            {/each}
          </div>
        {/if}
      </Tabs.Content>

      <Tabs.Content value="worktrees" class="m-0 min-h-0 flex-1 overflow-y-auto p-3">
        {#if snapshot.operation}
          <div class="gw-operation" role="status">
            <GitMerge size={14} class="shrink-0 text-[var(--app-warning)]" aria-hidden="true" />
            <span class="min-w-0 flex-1">{m['git.operation_in_progress']({ operation: snapshot.operation })}</span>
            {#if snapshot.operation === 'merge'}<Button variant="outline" size="sm" class="h-7 text-ui-sm" onclick={() => void prepare({ operation: 'abortMerge', force: false, setUpstream: false })}>{m['git.abort']()}</Button>{:else if snapshot.operation === 'rebase'}<Button variant="outline" size="sm" class="h-7 text-ui-sm" onclick={() => void prepare({ operation: 'abortRebase', force: false, setUpstream: false })}>{m['git.abort']()}</Button>{/if}
          </div>
        {/if}
        <p class="gw-hint gw-worktrees-hint">{m['git.worktrees_hint']()}</p>
        <div class="grid gap-1.5">
          {#each snapshot.worktrees as worktree}
            <div class="gw-card">
              <div class="flex items-center gap-2"><GitFork size={13} class="shrink-0 text-[var(--app-text-muted)]" aria-hidden="true" /><span class="gw-card-title">{worktree.branch ?? m['git.detached']()}</span></div>
              <span class="gw-path" title={worktree.path}>{worktree.path}</span>
            </div>
          {/each}
        </div>
        {#if snapshot.remotes.length}
          <h3 class="section-label gw-remotes-label">{m['git.remotes']()}</h3>
          <div class="grid gap-1.5">
            {#each snapshot.remotes as remote}
              <div class="gw-card"><span class="gw-card-title">{remote.name}</span><span class="gw-path" title={remote.fetchUrl}>{remote.fetchUrl}</span></div>
            {/each}
          </div>
        {/if}
      </Tabs.Content>
    </Tabs.Root>
  {/if}
</div>

<Dialog.Root bind:open={branchDialogOpen}>
  <Dialog.Content class="sm:max-w-sm"><Dialog.Header><Dialog.Title>{m['git.new_branch']()}</Dialog.Title><Dialog.Description>{m['git.new_branch_hint']()}</Dialog.Description></Dialog.Header><Input bind:value={branchName} placeholder="feature/name" onkeydown={(event: KeyboardEvent) => event.key === 'Enter' && void createBranch()} /><Dialog.Footer><Button variant="outline" onclick={() => (branchDialogOpen = false)}>{m['settings.cancel']()}</Button><Button disabled={!branchName.trim() || busy} onclick={() => void createBranch()}>{m['git.create_branch']()}</Button></Dialog.Footer></Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={tagDialogOpen}>
  <Dialog.Content class="sm:max-w-sm"><Dialog.Header><Dialog.Title>{m['git.new_tag']()}</Dialog.Title><Dialog.Description>{m['git.new_tag_hint']()}</Dialog.Description></Dialog.Header><div class="grid gap-2"><Input bind:value={tagName} placeholder="v1.0.0" /><Input bind:value={tagMessage} placeholder={m['git.tag_message']()} onkeydown={(event: KeyboardEvent) => event.key === 'Enter' && void createTag()} /></div><Dialog.Footer><Button variant="outline" onclick={() => (tagDialogOpen = false)}>{m['settings.cancel']()}</Button><Button disabled={!tagName.trim() || busy} onclick={() => void createTag()}>{m['git.create_tag']()}</Button></Dialog.Footer></Dialog.Content>
</Dialog.Root>

<AlertDialog.Root open={Boolean(pendingPreview)} onOpenChange={(open) => !open && (pendingPreview = null, pendingInput = null)}>
  <AlertDialog.Content><AlertDialog.Header><AlertDialog.Title>{m['git.confirm_title']()}</AlertDialog.Title><AlertDialog.Description>{pendingPreview?.summary}</AlertDialog.Description></AlertDialog.Header>{#if pendingPreview}<code class="block overflow-x-auto rounded-sm bg-[var(--app-canvas)] p-2 text-ui-xs">{pendingPreview.command.join(' ')}</code>{/if}<AlertDialog.Footer><AlertDialog.Cancel>{m['settings.cancel']()}</AlertDialog.Cancel><AlertDialog.Action onclick={() => void confirmOperation()}>{m['git.confirm_action']()}</AlertDialog.Action></AlertDialog.Footer></AlertDialog.Content>
</AlertDialog.Root>

<style>
  /* Cabecalho do repositorio: branch em destaque, hash/sincronia como metadado. */
  .gw-head {
    display: flex;
    flex: none;
    align-items: center;
    gap: 10px;
    min-height: 46px;
    padding: 6px 6px 6px 12px;
    border-bottom: 1px solid var(--app-border);
    background: var(--app-surface);
  }

  .gw-head-icon {
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    flex: none;
    border-radius: 7px;
    background: var(--app-success-soft);
    color: var(--app-success);
  }

  .gw-branch {
    margin: 0;
    overflow: hidden;
    color: var(--app-text);
    font-size: 12.5px;
    font-weight: 600;
    line-height: 1.35;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .gw-meta {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 1px 0 0;
    color: var(--app-text-muted);
    font-size: 11px;
    line-height: 1.35;
  }

  .gw-sync {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    flex: none;
    height: 18px;
    padding: 0 6px;
    border-radius: 5px;
    background: var(--app-hover);
    color: var(--app-text-soft);
    font-family: var(--font-mono);
    font-size: 10.5px;
    font-variant-numeric: tabular-nums;
  }

  .gw-head-actions {
    display: inline-flex;
    flex: none;
    align-items: center;
    gap: 1px;
  }

  .gw-error {
    display: flex;
    flex: none;
    align-items: flex-start;
    gap: 8px;
    padding: 8px 6px 8px 12px;
    border-bottom: 1px solid color-mix(in srgb, var(--app-danger) 30%, transparent);
    background: var(--app-danger-soft);
    color: var(--app-danger);
  }

  .gw-error :global(svg) {
    flex: none;
  }

  .gw-error > :global(svg:first-child) {
    margin-top: 2px;
  }

  .gw-error p {
    flex: 1;
    min-width: 0;
    margin: 0;
    color: var(--app-text);
    font-size: 12px;
    line-height: 1.45;
    overflow-wrap: anywhere;
  }

  .gw-error-close {
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    flex: none;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--app-text-muted);
    cursor: pointer;
    transition: background-color var(--duration-quick) ease-out, color var(--duration-quick) ease-out;
  }

  .gw-error-close:hover {
    background: color-mix(in srgb, var(--app-danger) 14%, transparent);
    color: var(--app-text);
  }

  .gw-error-close:focus-visible {
    outline: 2px solid var(--app-accent);
    outline-offset: 1px;
  }

  .gw-loading {
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

  .gw-tab-count {
    min-width: 18px;
    padding: 0 5px;
    border-radius: 5px;
    background: var(--app-hover);
    color: var(--app-text-soft);
    font-family: var(--font-mono);
    font-size: 10.5px;
    font-variant-numeric: tabular-nums;
    line-height: 18px;
    text-align: center;
  }

  /* Compositor do commit: campo e acao na mesma superficie, foco realca o conjunto. */
  .gw-composer {
    position: sticky;
    top: 0;
    z-index: 10;
    display: grid;
    gap: 4px;
    padding: 10px 10px 6px;
    background: var(--app-canvas);
  }

  .gw-composer-field {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 36px;
    padding: 0 4px 0 10px;
    border-radius: 9px;
    background: var(--app-surface);
    box-shadow: var(--app-shadow-border);
    transition: box-shadow var(--duration-quick) ease-out;
  }

  .gw-composer-field:hover {
    box-shadow: var(--app-shadow-border-hover);
  }

  .gw-composer-field:focus-within {
    box-shadow: 0 0 0 1px var(--app-accent), 0 0 0 3px color-mix(in srgb, var(--app-accent) 16%, transparent);
  }

  .gw-composer-field input {
    flex: 1;
    min-width: 0;
    height: 100%;
    border: none;
    outline: none;
    background: transparent;
    color: var(--app-text);
    font-size: 12.5px;
  }

  .gw-composer-field input::placeholder {
    color: var(--app-text-muted);
  }

  .gw-composer-foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    min-height: 24px;
    padding-left: 2px;
  }

  .gw-hint {
    min-width: 0;
    margin: 0;
    color: var(--app-text-muted);
    font-size: 11.5px;
    line-height: 1.45;
    text-wrap: pretty;
  }

  .gw-section {
    padding: 4px 6px 6px;
  }

  .gw-section + .gw-section {
    border-top: 1px solid color-mix(in srgb, var(--app-border) 70%, transparent);
  }

  .gw-section-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 30px;
    padding: 0 8px;
  }

  .gw-count {
    color: var(--app-text-muted);
    font-family: var(--font-mono);
    font-size: 10.5px;
    font-variant-numeric: tabular-nums;
  }

  .gw-row {
    position: relative;
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 30px;
    padding: 0 3px 0 8px;
    border-radius: 6px;
    transition: background-color var(--duration-quick) ease-out;
  }

  .gw-row:hover {
    background: var(--app-hover);
  }

  /* Marcador git como chip legivel: a cor diz o tipo, a letra continua igual. */
  .gw-status {
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
    font-size: 10.5px;
    font-weight: 600;
    line-height: 1;
  }

  .gw-status[data-tone='added'] {
    background: var(--app-success-soft);
    color: var(--app-success);
  }

  .gw-status[data-tone='deleted'],
  .gw-status[data-tone='conflict'] {
    background: var(--app-danger-soft);
    color: var(--app-danger);
  }

  .gw-status[data-tone='renamed'] {
    background: var(--app-info-soft);
    color: var(--app-info);
  }

  .gw-row-main {
    display: flex;
    flex: 1;
    align-items: baseline;
    gap: 8px;
    min-width: 0;
    height: 30px;
    padding: 0;
    border: none;
    background: transparent;
    color: var(--app-text-soft);
    font-size: 12px;
    line-height: 30px;
    cursor: pointer;
    text-align: left;
  }

  .gw-row:hover .gw-row-main {
    color: var(--app-text);
  }

  .gw-row-main:focus-visible {
    border-radius: 4px;
    outline: 2px solid var(--app-accent);
    outline-offset: 0;
  }

  .gw-row-name {
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .gw-row-dir {
    flex: 1 1 0;
    min-width: 0;
    overflow: hidden;
    color: var(--app-text-muted);
    font-size: 11px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .gw-empty-line {
    margin: 0;
    padding: 2px 8px 6px;
    color: var(--app-text-muted);
    font-size: 12px;
  }

  .gw-footer {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    padding: 6px 8px 12px;
    border-top: 1px solid color-mix(in srgb, var(--app-border) 70%, transparent);
  }

  /* Acoes de linha: aparecem ao apontar ou focar a linha. */
  .gw-reveal {
    display: inline-flex;
    flex: none;
    opacity: 0;
    transition: opacity var(--duration-quick) ease-out;
  }

  .gw-row:hover .gw-reveal,
  .gw-row:focus-within .gw-reveal,
  .gw-branch-row:hover .gw-reveal,
  .gw-branch-row:focus-within .gw-reveal {
    opacity: 1;
  }

  .gw :global(.gw-icon-btn) {
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
    transition: background-color var(--duration-quick) ease-out, color var(--duration-quick) ease-out, opacity var(--duration-quick) ease-out, transform var(--duration-quick) var(--ease-smooth-out);
  }

  .gw :global(.gw-icon-btn svg) {
    width: 13px;
    height: 13px;
  }

  .gw :global(.gw-icon-btn:hover),
  .gw :global(.gw-icon-btn[data-state='open']) {
    background: var(--app-hover);
    color: var(--app-text);
  }

  .gw :global(.gw-icon-btn.danger:hover) {
    background: var(--app-danger-soft);
    color: var(--app-danger);
  }

  .gw :global(.gw-icon-btn:active) {
    transform: scale(var(--scale-press));
  }

  .gw :global(.gw-icon-btn:focus-visible) {
    outline: 2px solid var(--app-accent);
    outline-offset: 1px;
  }

  /* Menus "..." das linhas: discretos em repouso, visiveis ao apontar/focar ou abertos. */
  .gw :global(.gw-reveal-btn) {
    opacity: 0;
  }

  .gw :global(.group:hover .gw-reveal-btn),
  .gw :global(.group:focus-within .gw-reveal-btn),
  .gw :global(.gw-reveal-btn[data-state='open']) {
    opacity: 1;
  }

  /* Grafo: linha continua entre os pontos; o HEAD ganha o ponto preenchido. */
  .gw-commit {
    position: relative;
    display: grid;
    grid-template-columns: 22px minmax(0, 1fr) auto;
    gap: 8px;
    padding: 8px 4px 8px 2px;
    border-radius: 7px;
    transition: background-color var(--duration-quick) ease-out;
  }

  .gw-commit:hover {
    background: color-mix(in srgb, var(--app-hover) 60%, transparent);
  }

  .gw-commit-line {
    position: absolute;
    top: 22px;
    bottom: -8px;
    left: 12px;
    width: 1.5px;
    border-radius: 1px;
    background: var(--app-border-strong);
  }

  .gw-commit-dot {
    position: relative;
    justify-self: center;
    width: 11px;
    height: 11px;
    margin-top: 3px;
    border: 2px solid var(--app-success);
    border-radius: 50%;
    background: var(--app-canvas);
  }

  .gw-commit-dot.head {
    background: var(--app-success);
    box-shadow: 0 0 0 3px var(--app-success-soft);
  }

  .gw-commit-subject {
    margin: 0;
    overflow: hidden;
    color: var(--app-text);
    font-size: 12px;
    font-weight: 500;
    line-height: 1.45;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .gw-commit-meta {
    margin: 1px 0 0;
    overflow: hidden;
    color: var(--app-text-muted);
    font-size: 11px;
    line-height: 1.4;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .gw-chip {
    display: inline-flex;
    align-items: center;
    height: 18px;
    padding: 0 6px;
    border-radius: 5px;
    background: var(--app-hover);
    color: var(--app-text-soft);
    font-family: var(--font-mono);
    font-size: 10.5px;
    font-variant-ligatures: none;
    white-space: nowrap;
  }

  .gw-hash {
    color: var(--app-text-muted);
    font-family: var(--font-mono);
    font-size: 10.5px;
    font-variant-numeric: tabular-nums;
  }

  .gw-toolbar {
    position: sticky;
    top: 0;
    z-index: 10;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    min-height: 44px;
    padding: 0 8px 0 14px;
    border-bottom: 1px solid color-mix(in srgb, var(--app-border) 70%, transparent);
    background: var(--app-canvas);
  }

  .gw-branch-row {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 32px;
    padding: 0 3px 0 8px;
    border-radius: 6px;
    transition: background-color var(--duration-quick) ease-out;
  }

  .gw-branch-row:hover {
    background: var(--app-hover);
  }

  .gw-branch-row.current {
    background: var(--app-success-soft);
  }

  .gw-branch-name {
    flex: 1;
    min-width: 0;
    height: 32px;
    padding: 0;
    overflow: hidden;
    border: none;
    background: transparent;
    color: var(--app-text-soft);
    font-size: 12px;
    font-weight: 500;
    text-align: left;
    text-overflow: ellipsis;
    white-space: nowrap;
    cursor: pointer;
  }

  .gw-branch-name:hover:not(:disabled) {
    color: var(--app-text);
  }

  .gw-branch-name:disabled {
    cursor: default;
  }

  .gw-branch-row.current .gw-branch-name {
    color: var(--app-text);
  }

  .gw-branch-name:focus-visible {
    border-radius: 4px;
    outline: 2px solid var(--app-accent);
    outline-offset: 0;
  }

  .gw-current {
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    flex: none;
    color: var(--app-success);
  }

  .gw-operation {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 12px;
    padding: 8px 8px 8px 12px;
    border-radius: 8px;
    background: var(--app-warning-soft);
    color: var(--app-text);
    font-size: 12px;
  }

  .gw-card {
    display: grid;
    gap: 3px;
    min-width: 0;
    padding: 9px 12px;
    border-radius: 8px;
    background: var(--app-surface);
    box-shadow: var(--app-shadow-border);
  }

  .gw-card-title {
    min-width: 0;
    overflow: hidden;
    color: var(--app-text);
    font-size: 12px;
    font-weight: 500;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .gw-path {
    display: block;
    min-width: 0;
    overflow: hidden;
    color: var(--app-text-muted);
    font-family: var(--font-mono);
    font-size: 10.5px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .gw-worktrees-hint {
    max-width: 60ch;
    margin-bottom: 12px;
    line-height: 1.55;
  }

  .gw-remotes-label {
    margin: 20px 0 6px;
  }

  @media (prefers-reduced-motion: reduce) {
    .gw-row,
    .gw-commit,
    .gw-branch-row {
      transition: none;
    }
  }
</style>
