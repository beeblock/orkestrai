<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { getCsrfToken } from '@beeblock/svelar/http';
  import {
    ArrowDownToLine, ArrowUpFromLine, Check, ChevronRight, GitBranch, GitCommitHorizontal,
    GitFork, GitMerge, History, LoaderCircle, Minus, MoreHorizontal, Plus, RefreshCw, RotateCcw, Tag, Trash2,
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

<div class="grid h-full min-h-0 grid-rows-[auto_auto_minmax(0,1fr)] bg-[var(--app-canvas)] text-[var(--app-text)]">
  <header class="flex min-h-10 items-center gap-2 border-b border-[var(--app-border)] bg-[var(--app-surface)] px-2.5">
    <GitBranch size={14} class="shrink-0 text-[var(--app-accent)]" />
    <div class="min-w-0 flex-1">
      <p class="truncate text-[11px] font-semibold">{snapshot?.status.branch ?? m['git.detached']()}</p>
      <p class="text-[9px] tabular-nums text-[var(--app-text-muted)]">
        {snapshot?.status.head?.slice(0, 8) ?? m['git.no_commits']()}
        {#if snapshot?.status.upstream} · {snapshot.status.ahead}↑ {snapshot.status.behind}↓{/if}
      </p>
    </div>
    <Button variant="ghost" size="icon-sm" aria-label={m['git.fetch']()} onclick={() => void prepare({ operation: 'fetch', force: false, setUpstream: false })}><RefreshCw class={busy ? 'animate-spin' : ''} /></Button>
    <Button variant="ghost" size="icon-sm" aria-label={m['git.pull']()} onclick={() => void prepare({ operation: 'pull', force: false, setUpstream: false })}><ArrowDownToLine /></Button>
    <Button variant="ghost" size="icon-sm" aria-label={m['git.push']()} onclick={() => void prepare({ operation: 'push', force: false, setUpstream: false })}><ArrowUpFromLine /></Button>
  </header>

  {#if errorMessage}
    <button class="border-b border-[var(--app-danger)]/30 bg-[var(--app-danger)]/10 px-3 py-2 text-left text-[10px] text-[var(--app-danger)]" onclick={() => (errorMessage = '')}>{errorMessage}</button>
  {/if}

  {#if loading}
    <div class="grid place-items-center"><LoaderCircle class="animate-spin text-[var(--app-text-muted)]" /></div>
  {:else if !snapshot?.status.isRepo}
    <div class="grid place-items-center p-6 text-center"><div><GitFork class="mx-auto mb-2 text-[var(--app-text-muted)]" /><p class="text-xs font-semibold">{m['git.not_repo']()}</p><p class="mt-1 text-[10px] text-[var(--app-text-muted)]">{m['git.not_repo_hint']()}</p></div></div>
  {:else}
    <Tabs.Root bind:value={activeTab} class="grid min-h-0 grid-rows-[34px_minmax(0,1fr)] gap-0">
      <Tabs.List class="h-8 justify-start overflow-x-auto rounded-none border-b border-[var(--app-border)] bg-[var(--app-surface-muted)] px-1" variant="line">
        <Tabs.Trigger value="changes" class="h-7 flex-none text-[10px]"><GitCommitHorizontal />{m['git.changes']()} <span class="tabular-nums">{snapshot.status.changes.length}</span></Tabs.Trigger>
        <Tabs.Trigger value="graph" class="h-7 flex-none text-[10px]"><History />{m['git.graph']()}</Tabs.Trigger>
        <Tabs.Trigger value="branches" class="h-7 flex-none text-[10px]"><GitBranch />{m['git.branches']()}</Tabs.Trigger>
        <Tabs.Trigger value="worktrees" class="h-7 flex-none text-[10px]"><GitFork />{m['git.worktrees']()}</Tabs.Trigger>
      </Tabs.List>

      <Tabs.Content value="changes" class="m-0 min-h-0 overflow-y-auto">
        <div class="sticky top-0 z-10 flex gap-1.5 border-b border-[var(--app-border)] bg-[var(--app-canvas)] p-2">
          <Input class="h-7 min-w-0 flex-1 text-[10px]" bind:value={commitMessage} placeholder={m['git.commit_placeholder']()} onkeydown={(event: KeyboardEvent) => event.key === 'Enter' && void commit()} />
          <Button size="sm" class="h-7 px-2 text-[10px]" disabled={busy || !commitMessage.trim() || staged.length === 0} onclick={() => void commit()}><Check />{m['git.commit']()}</Button>
          <Button variant="outline" size="sm" class="h-7 px-2 text-[10px]" onclick={openReviewCenter}>{m['git.review']()}</Button>
        </div>
        {#each [{ title: m['git.staged'](), items: staged }, { title: m['git.unstaged'](), items: unstaged }] as section}
          <section class="border-b border-[var(--app-border)]">
            <div class="flex items-center justify-between px-3 py-1.5 text-[9px] font-semibold uppercase text-[var(--app-text-muted)]"><span>{section.title}</span><span>{section.items.length}</span></div>
            {#each section.items as change (change.id)}
              <div class="group flex h-7 items-center gap-2 px-3 text-[10px] hover:bg-[var(--app-surface-muted)]">
                <span class="w-3 font-mono font-bold text-[var(--app-warning)]">{change.status}</span>
                <button class="min-w-0 flex-1 truncate text-left" onclick={openReviewCenter}>{change.path}</button>
                <Button variant="ghost" size="icon-sm" class="h-6 w-6 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100" aria-label={change.staged ? m['git.unstage']() : m['git.stage']()} onclick={() => void toggleStage(change)}>{#if change.staged}<Minus />{:else}<Plus />{/if}</Button>
              </div>
            {:else}
              <p class="px-3 pb-2 text-[10px] text-[var(--app-text-muted)]">{m['git.no_changes']()}</p>
            {/each}
          </section>
        {/each}
        <div class="flex flex-wrap gap-1.5 p-2">
          <Button variant="outline" size="sm" class="h-7 text-[10px]" onclick={() => void prepare({ operation: 'stash', force: false, setUpstream: false })}><RotateCcw />{m['git.stash']()}</Button>
          {#if snapshot.stashes[0]}<Button variant="outline" size="sm" class="h-7 text-[10px]" onclick={() => void prepare({ operation: 'stashPop', ref: snapshot?.stashes[0]?.ref, force: false, setUpstream: false })}>{m['git.stash_pop']()}</Button>{/if}
        </div>
      </Tabs.Content>

      <Tabs.Content value="graph" class="m-0 min-h-0 overflow-y-auto p-2">
        {#each snapshot.commits as commit, index (commit.hash)}
          <div class="relative grid min-h-12 grid-cols-[24px_minmax(0,1fr)_auto] gap-2 border-b border-[var(--app-border)]/70 py-2">
            {#if index < snapshot.commits.length - 1}<span class="absolute bottom-0 left-[11px] top-6 w-px bg-[var(--app-border-strong)]"></span>{/if}
            <span class="relative mt-1 h-3 w-3 place-self-start rounded-full border-2 border-[var(--app-accent)] bg-[var(--app-canvas)]"></span>
            <div class="min-w-0"><p class="truncate text-[10px] font-medium">{commit.subject}</p><p class="mt-0.5 truncate text-[9px] text-[var(--app-text-muted)]">{commit.author} · {new Date(commit.authoredAt).toLocaleString()}</p><div class="mt-1 flex flex-wrap gap-1">{#each commit.decorations as decoration}<span class="rounded-sm border border-[var(--app-border)] px-1 text-[8px] text-[var(--app-text-muted)]">{decoration}</span>{/each}</div></div>
            <div class="flex items-center gap-1"><code class="text-[9px] text-[var(--app-text-muted)]">{commit.shortHash}</code><DropdownMenu.Root><DropdownMenu.Trigger class="grid h-6 w-6 place-items-center rounded hover:bg-[var(--app-surface-muted)]" aria-label={m['git.commit_actions']()}><MoreHorizontal size={13} /></DropdownMenu.Trigger><DropdownMenu.Content align="end"><DropdownMenu.Item onclick={() => void prepare({ operation: 'cherryPick', ref: commit.hash, force: false, setUpstream: false })}>{m['git.cherry_pick']()}</DropdownMenu.Item><DropdownMenu.Item onclick={() => void prepare({ operation: 'revert', ref: commit.hash, force: false, setUpstream: false })}>{m['git.revert_commit']()}</DropdownMenu.Item></DropdownMenu.Content></DropdownMenu.Root></div>
          </div>
        {:else}<p class="p-3 text-[10px] text-[var(--app-text-muted)]">{m['git.no_commits']()}</p>{/each}
      </Tabs.Content>

      <Tabs.Content value="branches" class="m-0 min-h-0 overflow-y-auto">
        <div class="sticky top-0 z-10 flex justify-between border-b border-[var(--app-border)] bg-[var(--app-canvas)] p-2"><span class="text-[10px] font-semibold">{m['git.local_and_remote']()}</span><div class="flex gap-1"><Button variant="outline" size="sm" class="h-7 text-[10px]" onclick={() => (tagDialogOpen = true)}><Tag />{m['git.new_tag']()}</Button><Button size="sm" class="h-7 text-[10px]" onclick={() => (branchDialogOpen = true)}><Plus />{m['git.new_branch']()}</Button></div></div>
        {#each snapshot.branches as branch (branch.name)}
          <div class="group flex min-h-9 items-center gap-2 border-b border-[var(--app-border)]/70 px-3 text-[10px]">
            <GitBranch size={12} class={branch.current ? 'text-[var(--app-success)]' : 'text-[var(--app-text-muted)]'} />
            <button class="min-w-0 flex-1 truncate text-left font-medium" disabled={branch.current || branch.remote} onclick={() => void prepare({ operation: 'checkout', ref: branch.name, force: false, setUpstream: false })}>{branch.name}</button>
            {#if branch.remote}<span class="rounded-sm border border-[var(--app-border)] px-1 text-[8px] text-[var(--app-text-muted)]">{m['git.remote_branch']()}</span>{/if}
            {#if branch.upstream}<span class="text-[9px] tabular-nums text-[var(--app-text-muted)]">{branch.ahead}↑ {branch.behind}↓</span>{/if}
            {#if branch.current}<Check size={12} class="text-[var(--app-success)]" />{:else if !branch.remote}<DropdownMenu.Root><DropdownMenu.Trigger class="grid h-6 w-6 place-items-center rounded opacity-0 hover:bg-[var(--app-surface-muted)] group-hover:opacity-100 group-focus-within:opacity-100" aria-label={m['git.branch_actions']()}><MoreHorizontal size={13} /></DropdownMenu.Trigger><DropdownMenu.Content align="end"><DropdownMenu.Item onclick={() => void prepare({ operation: 'merge', ref: branch.name, force: false, setUpstream: false })}>{m['git.merge_branch']()}</DropdownMenu.Item><DropdownMenu.Item onclick={() => void prepare({ operation: 'rebase', ref: branch.name, force: false, setUpstream: false })}>{m['git.rebase_branch']()}</DropdownMenu.Item><DropdownMenu.Separator /><DropdownMenu.Item class="text-[var(--app-danger)]" onclick={() => void prepare({ operation: 'deleteBranch', ref: branch.name, force: false, setUpstream: false })}><Trash2 />{m['git.delete_branch']()}</DropdownMenu.Item></DropdownMenu.Content></DropdownMenu.Root>{/if}
          </div>
        {/each}
        {#if snapshot.tags.length}<div class="px-3 py-2 text-[9px] font-semibold uppercase text-[var(--app-text-muted)]">{m['git.tags']()}</div>{#each snapshot.tags as tag}<div class="group flex h-7 items-center gap-2 px-3 text-[10px]"><Tag size={11} class="text-[var(--app-warning)]"/><span class="flex-1">{tag.name}</span><code class="text-[9px] text-[var(--app-text-muted)]">{tag.target.slice(0, 8)}</code><Button variant="ghost" size="icon-sm" class="h-6 w-6 text-[var(--app-danger)] opacity-0 group-hover:opacity-100 group-focus-within:opacity-100" aria-label={m['git.delete_tag']()} onclick={() => void prepare({ operation: 'deleteTag', ref: tag.name, force: false, setUpstream: false })}><Trash2 /></Button></div>{/each}{/if}
      </Tabs.Content>

      <Tabs.Content value="worktrees" class="m-0 min-h-0 overflow-y-auto p-2">
        {#if snapshot.operation}<div class="mb-2 flex items-center gap-2 border-l-2 border-[var(--app-warning)] bg-[var(--app-warning)]/10 p-2 text-[10px]"><GitMerge size={13}/><span class="min-w-0 flex-1">{m['git.operation_in_progress']({ operation: snapshot.operation })}</span>{#if snapshot.operation === 'merge'}<Button variant="outline" size="sm" class="h-6 text-[9px]" onclick={() => void prepare({ operation: 'abortMerge', force: false, setUpstream: false })}>{m['git.abort']()}</Button>{:else if snapshot.operation === 'rebase'}<Button variant="outline" size="sm" class="h-6 text-[9px]" onclick={() => void prepare({ operation: 'abortRebase', force: false, setUpstream: false })}>{m['git.abort']()}</Button>{/if}</div>{/if}
        <p class="mb-2 text-[10px] text-[var(--app-text-muted)]">{m['git.worktrees_hint']()}</p>
        {#each snapshot.worktrees as worktree}
          <div class="mb-1 border-l-2 border-[var(--app-accent)] bg-[var(--app-surface)] p-2"><div class="flex items-center gap-2"><GitFork size={12}/><span class="truncate text-[10px] font-medium">{worktree.branch ?? m['git.detached']()}</span></div><p class="mt-1 truncate font-mono text-[9px] text-[var(--app-text-muted)]">{worktree.path}</p></div>
        {/each}
        {#if snapshot.remotes.length}<p class="mb-1 mt-3 text-[9px] font-semibold uppercase text-[var(--app-text-muted)]">{m['git.remotes']()}</p>{#each snapshot.remotes as remote}<div class="border-b border-[var(--app-border)] px-1 py-2"><p class="text-[10px] font-medium">{remote.name}</p><p class="truncate text-[9px] text-[var(--app-text-muted)]">{remote.fetchUrl}</p></div>{/each}{/if}
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
  <AlertDialog.Content><AlertDialog.Header><AlertDialog.Title>{m['git.confirm_title']()}</AlertDialog.Title><AlertDialog.Description>{pendingPreview?.summary}</AlertDialog.Description></AlertDialog.Header>{#if pendingPreview}<code class="block overflow-x-auto rounded-sm bg-[var(--app-canvas)] p-2 text-[10px]">{pendingPreview.command.join(' ')}</code>{/if}<AlertDialog.Footer><AlertDialog.Cancel>{m['settings.cancel']()}</AlertDialog.Cancel><AlertDialog.Action onclick={() => void confirmOperation()}>{m['git.confirm_action']()}</AlertDialog.Action></AlertDialog.Footer></AlertDialog.Content>
</AlertDialog.Root>
