<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import {
    Activity,
    AlertTriangle,
    ArrowRight,
    CheckCircle2,
    CircleDot,
    GitBranch,
    GitPullRequestArrow,
    ListTodo,
    MessageCircleMore,
    RefreshCw,
    Route,
    Scale,
    Search,
    UserRound,
  } from '@lucide/svelte';
  import { Button } from '$lib/components/ui/button';
  import * as InputGroup from '$lib/components/ui/input-group';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import * as Tooltip from '$lib/components/ui/tooltip';
  import { SegmentedControl } from '$lib/components/ui/segmented';
  import NodeEmptyState from './canvas/NodeEmptyState.svelte';
  import type { AgentActivity, AgentWorkstream, AgentWorkstreamStage, WorkstreamSnapshot } from '$lib/modules/agent-room/domain/types.js';
  import { workbenchReviewCenterItemId } from './workbench-review-center.js';
  import { workbenchHuddlesItemId } from './workbench-huddles.js';
  import * as m from '$lib/paraglide/messages.js';

  let { workspaceId }: { workspaceId: string } = $props();
  let snapshot = $state<WorkstreamSnapshot | null>(null);
  let loading = $state(true);
  let errorMessage = $state('');
  let selectedId = $state<string | null>(null);
  let query = $state('');
  let stage = $state<'all' | AgentWorkstreamStage>('all');
  let refreshTimer: ReturnType<typeof setTimeout> | null = null;

  const workstreams = $derived(snapshot?.workstreams ?? []);
  const filtered = $derived(workstreams.filter((item) => {
    if (stage !== 'all' && item.stage !== stage) return false;
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return true;
    return [item.title, item.description, item.assigneeTitle, item.floor?.name, item.floor?.branch, item.taskStatusLabel]
      .some((value) => String(value ?? '').toLocaleLowerCase().includes(normalized));
  }));
  const selected = $derived(filtered.find((item) => item.id === selectedId) ?? filtered[0] ?? null);

  function stageLabel(value: AgentWorkstreamStage): string {
    if (value === 'backlog') return m['workstreams.stage_backlog']();
    if (value === 'active') return m['workstreams.stage_active']();
    if (value === 'review') return m['workstreams.stage_review']();
    if (value === 'blocked') return m['workstreams.stage_blocked']();
    return m['workstreams.stage_done']();
  }

  function taskStatusLabel(item: AgentWorkstream): string {
    if (item.taskStatus === 'todo') return m['floor.task_todo']();
    if (item.taskStatus === 'doing') return m['floor.task_doing']();
    if (item.taskStatus === 'done') return m['floor.task_done']();
    return item.taskStatusLabel;
  }

  function councilStatusLabel(status: string): string {
    if (status === 'running') return m['council.status_running']();
    if (status === 'ready') return m['council.status_ready']();
    if (status === 'partial') return m['council.status_partial']();
    if (status === 'failed') return m['council.status_failed']();
    if (status === 'selected') return m['council.status_selected']();
    if (status === 'consensus_requested') return m['council.status_consensus_requested']();
    if (status === 'rejected') return m['council.status_rejected']();
    return status;
  }

  function reviewStatusLabel(status: string): string {
    if (status === 'pending') return m['review_center.status_pending']();
    if (status === 'approved') return m['review_center.status_approved']();
    if (status === 'changes_requested') return m['review_center.status_changes_requested']();
    if (status === 'rejected') return m['review_center.status_rejected']();
    return status;
  }

  function eventLabel(event: AgentActivity): string {
    const object = event.objectTitle || event.action || event.objectType || m['workstreams.event']();
    if (event.verb === 'started') return m['workstreams.event_started']({ object });
    if (event.verb === 'completed') return m['workstreams.event_completed']({ object });
    if (event.verb === 'requested') return m['workstreams.event_requested']({ object });
    if (event.verb === 'failed') return m['workstreams.event_failed']({ object });
    if (event.verb === 'decided') return m['workstreams.event_decided']({ object });
    return object;
  }

  function stageColor(item: AgentWorkstream): string {
    if (item.stage === 'blocked') return 'var(--app-danger)';
    if (item.stage === 'done') return 'var(--app-success)';
    return item.taskStatusColor;
  }

  function formatDate(value: string): string {
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
  }

  async function load(silent = false): Promise<void> {
    if (!silent) loading = true;
    try {
      const response = await fetch(`/api/agent-room/workspaces/${workspaceId}/workstreams`, { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? m['workstreams.load_error']());
      snapshot = payload.data;
      if (selectedId && !payload.data.workstreams.some((item: AgentWorkstream) => item.id === selectedId)) selectedId = null;
      errorMessage = '';
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : m['workstreams.load_error']();
    } finally {
      if (!silent) loading = false;
    }
  }

  function scheduleRefresh(): void {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => void load(true), 180);
  }

  function openTask(): void {
    if (!snapshot?.taskBoardNodeId) return;
    void goto(`/canvas?workspace=${workspaceId}&node=${snapshot.taskBoardNodeId}`);
  }

  function openCouncil(item: AgentWorkstream): void {
    window.dispatchEvent(new CustomEvent('orkestrai:open-council', {
      detail: { workspaceId, source: { taskId: item.id, taskTitle: item.title, taskDescription: item.description } },
    }));
  }

  function openReviews(): void {
    void goto(`/terminal?workspace=${workspaceId}&node=${encodeURIComponent(workbenchReviewCenterItemId(workspaceId))}`);
  }

  function openHuddles(): void {
    void goto(`/terminal?workspace=${workspaceId}&node=${encodeURIComponent(workbenchHuddlesItemId(workspaceId))}`);
  }

  onMount(() => {
    void load();
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
    const socket = new WebSocket(`${protocol}://${location.host}/ws/agent-room/pty`);
    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(String(event.data));
        if (message.workspaceId === workspaceId && ['workspaceChanged', 'gitReviewChanged', 'councilChanged', 'huddleChanged', 'controlCenterChanged'].includes(message.type)) scheduleRefresh();
      } catch {
        // Ignore terminal frames.
      }
    };
    return () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      socket.close();
    };
  });
</script>

<section class="flex h-full min-h-0 flex-col bg-[var(--app-canvas)] text-[var(--app-text)]" data-testid="workstreams-view">
  <header class="shrink-0 border-b border-[var(--app-border)] bg-[var(--app-surface)] px-5 pb-3 pt-4">
    <div class="flex min-w-0 items-start gap-3">
      <span class="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-[var(--app-accent-soft)] text-[var(--app-accent)]" aria-hidden="true"><Route size={17} /></span>
      <div class="min-w-0 flex-1">
        <h1 class="truncate font-display text-[15px] font-semibold tracking-[-0.01em]">{m['workstreams.title']()}</h1>
        <p class="mt-0.5 truncate text-ui-sm text-[var(--app-text-muted)]" title={m['workstreams.description']()}>{m['workstreams.description']()}</p>
      </div>
      <Tooltip.Root>
        <Tooltip.Trigger>
          {#snippet child({ props })}
            <Button {...props} variant="ghost" size="icon-sm" class="shrink-0" aria-label={m['workstreams.refresh']()} onclick={() => void load()} disabled={loading}>
              <RefreshCw size={14} class={loading ? 'animate-spin' : ''} />
            </Button>
          {/snippet}
        </Tooltip.Trigger>
        <Tooltip.Content>{m['workstreams.refresh']()}</Tooltip.Content>
      </Tooltip.Root>
    </div>
    <div class="mt-3 flex flex-wrap items-center gap-2">
      <SegmentedControl
        size="sm"
        label={m['workstreams.title']()}
        bind:value={stage}
        options={[
          { value: 'all', label: m['workstreams.stage_all'](), count: workstreams.length },
          { value: 'active', label: m['workstreams.stage_active'](), count: snapshot?.counts.active ?? 0 },
          { value: 'review', label: m['workstreams.stage_review'](), count: snapshot?.counts.review ?? 0 },
          { value: 'blocked', label: m['workstreams.stage_blocked'](), count: snapshot?.counts.blocked ?? 0 },
          { value: 'done', label: m['workstreams.stage_done'](), count: snapshot?.counts.done ?? 0 },
        ]}
      />
      <InputGroup.Root class="ml-auto h-8 min-w-[180px] max-w-[280px] flex-1 border-[var(--app-border)] bg-[var(--app-canvas)] shadow-none">
        <InputGroup.Addon><Search size={13} /></InputGroup.Addon>
        <InputGroup.Input bind:value={query} class="text-ui-md" placeholder={m['workstreams.search']()} aria-label={m['workstreams.search']()} />
      </InputGroup.Root>
    </div>
  </header>

  {#if snapshot && (snapshot.unlinked.councils || snapshot.unlinked.reviews || snapshot.unlinked.activities || snapshot.unlinked.changedPaths.length)}
    <div class="flex shrink-0 items-center gap-2 border-b border-[var(--app-border)] bg-[var(--app-warning-soft)] px-5 py-2 text-ui-sm text-[var(--app-text-soft)]">
      <AlertTriangle size={13} class="shrink-0 text-[var(--app-warning)]" aria-hidden="true" />
      <span class="min-w-0 truncate" title={m['workstreams.unlinked_summary']({ councils: snapshot.unlinked.councils, reviews: snapshot.unlinked.reviews, activities: snapshot.unlinked.activities, files: snapshot.unlinked.changedPaths.length })}>{m['workstreams.unlinked_summary']({ councils: snapshot.unlinked.councils, reviews: snapshot.unlinked.reviews, activities: snapshot.unlinked.activities, files: snapshot.unlinked.changedPaths.length })}</span>
    </div>
  {/if}

  {#if errorMessage}
    <NodeEmptyState icon={AlertTriangle} tone="danger" title={m['workstreams.load_error']()} description={errorMessage === m['workstreams.load_error']() ? undefined : errorMessage}>
      {#snippet actions()}<Button variant="outline" size="sm" onclick={() => void load()}><RefreshCw size={13} />{m['automation.retry']()}</Button>{/snippet}
    </NodeEmptyState>
  {:else if loading && !snapshot}
    <div class="grid min-h-0 flex-1 grid-cols-[minmax(220px,300px)_minmax(0,1fr)]" role="status" aria-label={m['workstreams.loading']()}>
      <div class="space-y-1.5 border-r border-[var(--app-border)] p-2">
        {#each [0, 1, 2, 3, 4] as row (row)}<Skeleton class="h-[52px] w-full rounded-lg bg-[var(--app-hover)]" />{/each}
      </div>
      <div class="space-y-3 p-6">
        <Skeleton class="h-4 w-24 bg-[var(--app-hover)]" />
        <Skeleton class="h-6 w-1/2 bg-[var(--app-hover)]" />
        <Skeleton class="h-32 w-full rounded-lg bg-[var(--app-hover)]" />
      </div>
    </div>
  {:else if !workstreams.length}
    {#if snapshot?.taskBoardNodeId}
      <NodeEmptyState icon={ListTodo} title={m['workstreams.empty_title']()} description={m['workstreams.empty_body']()}>
        {#snippet actions()}<Button size="sm" onclick={openTask}><ListTodo size={13} />{m['workstreams.open_task']()}</Button>{/snippet}
      </NodeEmptyState>
    {:else}
      <NodeEmptyState icon={ListTodo} title={m['workstreams.empty_title']()} description={m['workstreams.empty_body']()} />
    {/if}
  {:else}
    <div class="grid min-h-0 flex-1 grid-cols-[minmax(220px,300px)_minmax(0,1fr)] max-[760px]:grid-cols-[210px_minmax(360px,1fr)]">
      <aside class="min-h-0 overflow-y-auto border-r border-[var(--app-border)] p-2">
        {#each filtered as item (item.id)}
          <button type="button" class="hub-row" class:selected={selected?.id === item.id} aria-current={selected?.id === item.id ? 'true' : undefined} onclick={() => (selectedId = item.id)}>
            <span class="flex min-w-0 items-center gap-2">
              <span class="size-2 shrink-0 rounded-full" style:background={stageColor(item)} aria-hidden="true"></span>
              <strong class="min-w-0 flex-1 truncate text-ui-md font-semibold text-[var(--app-text)]">{item.title}</strong>
            </span>
            <span class="mt-1 flex min-w-0 items-center gap-1.5 pl-4 text-ui-sm text-[var(--app-text-muted)]">
              <span class="shrink-0">{stageLabel(item.stage)}</span><span aria-hidden="true">·</span><span class="truncate">{item.assigneeTitle ?? m['workstreams.unassigned']()}</span>
            </span>
          </button>
        {:else}
          <NodeEmptyState compact icon={Search} title={m['workstreams.no_matches']()} />
        {/each}
      </aside>

      {#if selected}
        <div class="min-h-0 overflow-y-auto">
          <div class="border-b border-[var(--app-border)] px-6 py-5">
            <div class="flex items-start justify-between gap-4">
              <div class="min-w-0">
                <span class="inline-flex items-center gap-1.5 rounded-md bg-[var(--app-hover)] px-1.5 py-0.5 text-ui-xs font-medium text-[var(--app-text-soft)]">
                  <span class="size-1.5 rounded-full" style:background={stageColor(selected)} aria-hidden="true"></span>{stageLabel(selected.stage)}
                </span>
                <h2 class="mt-2 text-balance font-display text-[16px] font-semibold leading-snug">{selected.title}</h2>
                {#if selected.description}<p class="mt-1.5 max-w-3xl whitespace-pre-wrap text-pretty text-ui-md leading-5 text-[var(--app-text-soft)]">{selected.description}</p>{/if}
              </div>
              <Button variant="outline" size="sm" class="shrink-0" onclick={openTask} disabled={!snapshot?.taskBoardNodeId}><ListTodo size={13} />{m['workstreams.open_task']()}</Button>
            </div>
            <div class="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-ui-sm text-[var(--app-text-muted)]">
              <span class="flex items-center gap-1.5"><UserRound size={12} aria-hidden="true" />{selected.assigneeTitle ?? m['workstreams.unassigned']()}</span>
              {#if selected.floor}<span class="flex min-w-0 items-center gap-1.5"><GitBranch size={12} aria-hidden="true" /><span class="truncate">{selected.floor.name} · <span class="font-mono text-ui-xs">{selected.floor.branch}</span></span></span>{/if}
              <span class="flex items-center gap-1.5"><CircleDot size={12} style={`color:${selected.taskStatusColor}`} aria-hidden="true" />{taskStatusLabel(selected)}</span>
              <span class="tabular-nums">{m['workstreams.updated']({ date: formatDate(selected.updatedAt) })}</span>
            </div>
          </div>

          <div class="grid gap-0 lg:grid-cols-2">
            <section class="border-b border-[var(--app-border)] px-6 py-5 lg:border-r">
              <div class="mb-3 flex h-7 items-center justify-between gap-2"><h3 class="flex items-center gap-2 section-label"><Activity size={13} aria-hidden="true" />{m['workstreams.activity']()}</h3><span class="font-mono text-[11px] tabular-nums text-[var(--app-text-muted)]">{selected.timeline.length}</span></div>
              {#if selected.timeline.length}
                <ol class="space-y-0">
                  {#each [...selected.timeline].reverse() as event (event.id)}
                    <li class="relative border-l border-[var(--app-border)] pb-4 pl-4 last:pb-0">
                      <span class="absolute -left-1 top-1 size-2 rounded-full ring-2 ring-[var(--app-canvas)]" style:background={event.severity === 'error' ? 'var(--app-danger)' : event.severity === 'success' ? 'var(--app-success)' : event.severity === 'warning' ? 'var(--app-warning)' : 'var(--app-text-muted)'} aria-hidden="true"></span>
                      <p class="text-ui-md font-medium leading-4">{eventLabel(event)}</p>
                      {#if event.outcome}<p class="mt-1 line-clamp-3 text-ui-sm leading-[1.45] text-[var(--app-text-muted)]">{event.outcome}</p>{/if}
                      <time class="mt-1 block text-ui-xs tabular-nums text-[var(--app-text-muted)]">{formatDate(event.createdAt)}</time>
                    </li>
                  {/each}
                </ol>
              {:else}<p class="text-pretty text-ui-sm leading-5 text-[var(--app-text-muted)]">{m['workstreams.no_activity']()}</p>{/if}
            </section>

            <div>
              <section class="border-b border-[var(--app-border)] px-6 py-5">
                <div class="mb-3 flex h-7 items-center justify-between gap-2"><h3 class="flex items-center gap-2 section-label"><MessageCircleMore size={13} aria-hidden="true" />{m['huddle.title']()}</h3><Button variant="ghost" size="sm" class="-mr-2 text-ui-sm" onclick={openHuddles}>{m['workstreams.open_huddles']()}<ArrowRight size={12} /></Button></div>
                {#if selected.huddles.length}<div class="space-y-2">{#each selected.huddles as huddle (huddle.id)}<div class="evidence-card"><div class="flex items-center gap-2"><strong class="min-w-0 flex-1 truncate text-ui-md font-semibold">{huddle.title}</strong><span class="status-chip" class:live={huddle.status === 'active'}>{huddle.status === 'active' ? m['huddle.live']() : m['huddle.finished']()}</span></div><p class="mt-1 text-ui-sm tabular-nums text-[var(--app-text-muted)]">{m['workstreams.huddle_evidence']({ people: huddle.participantCount, turns: huddle.turnCount })}</p></div>{/each}</div>{:else}<p class="text-pretty text-ui-sm leading-5 text-[var(--app-text-muted)]">{m['workstreams.no_huddles']()}</p>{/if}
              </section>
              <section class="border-b border-[var(--app-border)] px-6 py-5">
                <div class="mb-3 flex h-7 items-center justify-between gap-2"><h3 class="flex items-center gap-2 section-label"><Scale size={13} aria-hidden="true" />{m['workstreams.councils']()}</h3><Button variant="ghost" size="sm" class="-mr-2 text-ui-sm" onclick={() => openCouncil(selected)}>{m['workstreams.open_council']()}<ArrowRight size={12} /></Button></div>
                {#if selected.councils.length}<div class="space-y-2">{#each selected.councils as council (council.id)}<div class="evidence-card"><div class="flex items-center gap-2"><strong class="min-w-0 flex-1 truncate text-ui-md font-semibold">{council.title}</strong><span class="status-chip">{councilStatusLabel(council.status)}</span></div><p class="mt-1 text-ui-sm tabular-nums text-[var(--app-text-muted)]">{m['workstreams.perspectives']({ done: council.completedPerspectives, total: council.totalPerspectives })}</p></div>{/each}</div>{:else}<p class="text-pretty text-ui-sm leading-5 text-[var(--app-text-muted)]">{m['workstreams.no_councils']()}</p>{/if}
              </section>
              <section class="border-b border-[var(--app-border)] px-6 py-5">
                <div class="mb-3 flex h-7 items-center justify-between gap-2"><h3 class="flex items-center gap-2 section-label"><GitPullRequestArrow size={13} aria-hidden="true" />{m['workstreams.reviews']()}</h3><Button variant="ghost" size="sm" class="-mr-2 text-ui-sm" onclick={openReviews}>{m['workstreams.open_reviews']()}<ArrowRight size={12} /></Button></div>
                {#if selected.reviews.length}<div class="space-y-2">{#each selected.reviews as review (review.id)}<div class="evidence-card"><div class="flex items-center gap-2"><strong class="min-w-0 flex-1 truncate text-ui-md font-semibold">{review.title}</strong><span class="status-chip" data-status={review.status}>{reviewStatusLabel(review.status)}</span></div><p class="mt-1 text-ui-sm tabular-nums text-[var(--app-text-muted)]">{m['workstreams.review_evidence']({ evidence: review.evidenceCount, tests: review.testCount, risks: review.riskCount })}</p></div>{/each}</div>{:else}<p class="text-pretty text-ui-sm leading-5 text-[var(--app-text-muted)]">{m['workstreams.no_reviews']()}</p>{/if}
              </section>
              <section class="px-6 py-5">
                <div class="mb-3 flex h-7 items-center"><h3 class="flex items-center gap-2 section-label"><GitBranch size={13} aria-hidden="true" />{m['workstreams.git']()}</h3></div>
                {#if selected.git.paths.length}
                  <div class="space-y-0.5">
                    {#each selected.git.paths as path}
                      {@const changed = selected.git.changedPaths.includes(path)}
                      <div class="flex h-7 items-center gap-2 rounded-md px-2 text-ui-sm transition-colors hover:bg-[var(--app-hover)]">
                        <CheckCircle2 size={12} class={`shrink-0 ${changed ? 'text-[var(--app-warning)]' : 'text-[var(--app-success)]'}`} aria-hidden="true" />
                        <span class="min-w-0 flex-1 truncate font-mono text-ui-xs text-[var(--app-text-soft)]" title={path}>{path}</span>
                        <span class="status-chip" class:changed>{changed ? m['workstreams.changed']() : m['workstreams.tracked']()}</span>
                      </div>
                    {/each}
                  </div>
                {:else}<p class="text-pretty text-ui-sm leading-5 text-[var(--app-text-muted)]">{m['workstreams.no_files']()}</p>{/if}
              </section>
            </div>
          </div>
        </div>
      {/if}
    </div>
  {/if}
</section>

<style>
  /* Linha da lista: selecao neutra com indicador de acento, como no Workbench. */
  .hub-row {
    position: relative;
    display: block;
    width: 100%;
    margin-bottom: 2px;
    padding: 9px 10px 9px 12px;
    border: 0;
    border-radius: 8px;
    background: transparent;
    text-align: left;
    cursor: pointer;
    transition: background-color var(--duration-quick) ease-out;
  }

  .hub-row:hover {
    background: var(--app-hover);
  }

  .hub-row.selected {
    background: var(--app-active);
  }

  .hub-row.selected::before {
    content: '';
    position: absolute;
    left: 0;
    top: 10px;
    bottom: 10px;
    width: 2px;
    border-radius: 0 2px 2px 0;
    background: var(--app-accent);
  }

  .hub-row:focus-visible {
    outline: 2px solid var(--app-accent);
    outline-offset: -2px;
  }

  /* Evidencia vinculada: cartao leve com contorno por sombra, sem borda dupla. */
  .evidence-card {
    padding: 10px 12px;
    border-radius: 8px;
    background: var(--app-surface);
    box-shadow: var(--app-shadow-border);
  }

  /* Chip neutro de estado; cor so quando o estado pede atencao. */
  .status-chip {
    flex-shrink: 0;
    padding: 1px 6px;
    border-radius: 5px;
    background: var(--app-hover);
    color: var(--app-text-soft);
    font-size: 11px;
    font-weight: 500;
    line-height: 16px;
    white-space: nowrap;
  }

  .status-chip.live,
  .status-chip[data-status='approved'] {
    background: var(--app-success-soft);
    color: var(--app-success);
  }

  .status-chip.changed,
  .status-chip[data-status='changes_requested'] {
    background: var(--app-warning-soft);
    color: var(--app-warning);
  }

  .status-chip[data-status='rejected'] {
    background: var(--app-danger-soft);
    color: var(--app-danger);
  }
</style>
