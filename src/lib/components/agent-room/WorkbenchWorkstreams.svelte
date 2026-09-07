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
  import { Input } from '$lib/components/ui/input';
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
  <header class="shrink-0 border-b border-[var(--app-border)] px-5 py-4">
    <div class="flex items-start justify-between gap-4">
      <div class="min-w-0">
        <div class="flex items-center gap-2"><Route size={17} class="text-[var(--app-accent)]" /><h1 class="text-[14px] font-semibold">{m['workstreams.title']()}</h1></div>
        <p class="mt-1 max-w-2xl text-ui-xs leading-4 text-[var(--app-text-muted)]">{m['workstreams.description']()}</p>
      </div>
      <Button variant="ghost" size="icon" class="size-8 shrink-0" aria-label={m['workstreams.refresh']()} onclick={() => void load()} disabled={loading}>
        <RefreshCw size={14} class={loading ? 'animate-spin' : ''} />
      </Button>
    </div>
    <div class="mt-4 flex flex-wrap items-center gap-2">
      {#each [
        { id: 'all', label: m['workstreams.stage_all'](), count: workstreams.length },
        { id: 'active', label: m['workstreams.stage_active'](), count: snapshot?.counts.active ?? 0 },
        { id: 'review', label: m['workstreams.stage_review'](), count: snapshot?.counts.review ?? 0 },
        { id: 'blocked', label: m['workstreams.stage_blocked'](), count: snapshot?.counts.blocked ?? 0 },
        { id: 'done', label: m['workstreams.stage_done'](), count: snapshot?.counts.done ?? 0 },
      ] as option}
        <button type="button" class="inline-flex h-7 items-center gap-1.5 rounded-[5px] border px-2 text-ui-xs font-medium transition-colors" class:border-[var(--app-accent)]={stage === option.id} class:bg-[var(--app-accent-soft)]={stage === option.id} class:border-[var(--app-border)]={stage !== option.id} aria-pressed={stage === option.id} onclick={() => (stage = option.id as typeof stage)}>
          {option.label}<span class="tabular-nums text-[var(--app-text-muted)]">{option.count}</span>
        </button>
      {/each}
      <div class="relative ml-auto min-w-[180px] max-w-[280px] flex-1"><Search size={12} class="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[var(--app-text-muted)]" /><Input bind:value={query} class="h-7 pl-7 text-ui-xs" placeholder={m['workstreams.search']()} /></div>
    </div>
  </header>

  {#if snapshot && (snapshot.unlinked.councils || snapshot.unlinked.reviews || snapshot.unlinked.activities || snapshot.unlinked.changedPaths.length)}
    <div class="flex shrink-0 items-center gap-2 border-b border-[var(--app-border)] bg-[color-mix(in_srgb,var(--app-warning)_7%,transparent)] px-5 py-2 text-ui-xs text-[var(--app-text-soft)]">
      <AlertTriangle size={12} class="shrink-0 text-[var(--app-warning)]" />
      <span>{m['workstreams.unlinked_summary']({ councils: snapshot.unlinked.councils, reviews: snapshot.unlinked.reviews, activities: snapshot.unlinked.activities, files: snapshot.unlinked.changedPaths.length })}</span>
    </div>
  {/if}

  {#if errorMessage}
    <div class="m-4 flex items-center gap-2 rounded-md border border-[var(--app-danger)]/40 bg-[color-mix(in_srgb,var(--app-danger)_8%,transparent)] p-3 text-ui-sm text-[var(--app-danger)]"><AlertTriangle size={14} />{errorMessage}</div>
  {:else if loading && !snapshot}
    <div class="grid min-h-0 flex-1 place-items-center text-ui-sm text-[var(--app-text-muted)]">{m['workstreams.loading']()}</div>
  {:else if !workstreams.length}
    <div class="grid min-h-0 flex-1 place-items-center px-8 text-center"><div><ListTodo size={28} class="mx-auto text-[var(--app-text-muted)]" /><h2 class="mt-3 text-ui-lg font-semibold">{m['workstreams.empty_title']()}</h2><p class="mt-1 text-ui-sm text-[var(--app-text-muted)]">{m['workstreams.empty_body']()}</p></div></div>
  {:else}
    <div class="grid min-h-0 flex-1 grid-cols-[minmax(220px,300px)_minmax(0,1fr)] max-[760px]:grid-cols-[210px_minmax(360px,1fr)]">
      <aside class="min-h-0 overflow-y-auto border-r border-[var(--app-border)] p-2">
        {#each filtered as item (item.id)}
          <button type="button" class="mb-1 w-full rounded-md border p-2.5 text-left transition-colors" class:border-[var(--app-accent)]={selected?.id === item.id} class:bg-[var(--app-accent-soft)]={selected?.id === item.id} class:border-transparent={selected?.id !== item.id} class:hover:bg-[var(--app-surface-raised)]={selected?.id !== item.id} onclick={() => (selectedId = item.id)}>
            <span class="flex items-center gap-2"><span class="size-2 shrink-0 rounded-full" style:background={item.stage === 'blocked' ? 'var(--app-danger)' : item.stage === 'done' ? 'var(--app-success)' : item.taskStatusColor}></span><strong class="min-w-0 flex-1 truncate text-ui-xs font-semibold">{item.title}</strong></span>
            <span class="mt-1.5 flex min-w-0 items-center gap-1.5 text-ui-xs text-[var(--app-text-muted)]"><span>{stageLabel(item.stage)}</span><span>·</span><span class="truncate">{item.assigneeTitle ?? m['workstreams.unassigned']()}</span></span>
          </button>
        {:else}
          <p class="px-3 py-8 text-center text-ui-xs text-[var(--app-text-muted)]">{m['workstreams.no_matches']()}</p>
        {/each}
      </aside>

      {#if selected}
        <div class="min-h-0 overflow-y-auto">
          <div class="border-b border-[var(--app-border)] px-5 py-4">
            <div class="flex items-start justify-between gap-4"><div class="min-w-0"><span class="text-ui-xs font-semibold uppercase text-[var(--app-text-muted)]">{stageLabel(selected.stage)}</span><h2 class="mt-1 text-[16px] font-semibold leading-5">{selected.title}</h2>{#if selected.description}<p class="mt-2 max-w-3xl whitespace-pre-wrap text-ui-sm leading-5 text-[var(--app-text-soft)]">{selected.description}</p>{/if}</div><Button variant="outline" size="sm" class="h-8 shrink-0 text-ui-xs" onclick={openTask} disabled={!snapshot?.taskBoardNodeId}><ListTodo size={13} />{m['workstreams.open_task']()}</Button></div>
            <div class="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-ui-xs text-[var(--app-text-muted)]">
              <span class="flex items-center gap-1"><UserRound size={11} />{selected.assigneeTitle ?? m['workstreams.unassigned']()}</span>
              {#if selected.floor}<span class="flex items-center gap-1"><GitBranch size={11} />{selected.floor.name} · {selected.floor.branch}</span>{/if}
              <span class="flex items-center gap-1"><CircleDot size={11} style={`color:${selected.taskStatusColor}`} />{taskStatusLabel(selected)}</span>
              <span>{m['workstreams.updated']({ date: formatDate(selected.updatedAt) })}</span>
            </div>
          </div>

          <div class="grid gap-0 lg:grid-cols-2">
            <section class="border-b border-[var(--app-border)] p-5 lg:border-r">
              <div class="mb-3 flex items-center justify-between"><h3 class="flex items-center gap-2 text-ui-sm font-semibold"><Activity size={13} />{m['workstreams.activity']()}</h3><span class="text-ui-xs tabular-nums text-[var(--app-text-muted)]">{selected.timeline.length}</span></div>
              {#if selected.timeline.length}
                <ol class="space-y-0">
                  {#each [...selected.timeline].reverse() as event (event.id)}
                    <li class="relative border-l border-[var(--app-border)] pb-4 pl-4 last:pb-0"><span class="absolute -left-1 top-1 size-2 rounded-full border border-[var(--app-canvas)]" class:bg-[var(--app-danger)]={event.severity === 'error'} class:bg-[var(--app-success)]={event.severity === 'success'} class:bg-[var(--app-accent)]={event.severity === 'info' || event.severity === 'warning'}></span><p class="text-ui-xs font-medium">{eventLabel(event)}</p>{#if event.outcome}<p class="mt-1 line-clamp-3 text-ui-xs leading-4 text-[var(--app-text-muted)]">{event.outcome}</p>{/if}<time class="mt-1 block text-ui-xs text-[var(--app-text-muted)]">{formatDate(event.createdAt)}</time></li>
                  {/each}
                </ol>
              {:else}<p class="text-ui-xs text-[var(--app-text-muted)]">{m['workstreams.no_activity']()}</p>{/if}
            </section>

            <div>
              <section class="border-b border-[var(--app-border)] p-5">
                <div class="mb-3 flex items-center justify-between"><h3 class="flex items-center gap-2 text-ui-sm font-semibold"><MessageCircleMore size={13} />{m['huddle.title']()}</h3><Button variant="ghost" size="sm" class="h-7 text-ui-xs" onclick={openHuddles}>{m['workstreams.open_huddles']()}<ArrowRight size={11} /></Button></div>
                {#if selected.huddles.length}<div class="space-y-2">{#each selected.huddles as huddle (huddle.id)}<div class="rounded-md border border-[var(--app-border)] bg-[var(--app-surface-subtle)] p-2.5"><div class="flex items-center gap-2"><strong class="min-w-0 flex-1 truncate text-ui-xs">{huddle.title}</strong><span class="text-ui-xs uppercase text-[var(--app-text-muted)]">{huddle.status === 'active' ? m['huddle.live']() : m['huddle.finished']()}</span></div><p class="mt-1 text-ui-xs text-[var(--app-text-muted)]">{m['workstreams.huddle_evidence']({ people: huddle.participantCount, turns: huddle.turnCount })}</p></div>{/each}</div>{:else}<p class="text-ui-xs text-[var(--app-text-muted)]">{m['workstreams.no_huddles']()}</p>{/if}
              </section>
              <section class="border-b border-[var(--app-border)] p-5">
                <div class="mb-3 flex items-center justify-between"><h3 class="flex items-center gap-2 text-ui-sm font-semibold"><Scale size={13} />{m['workstreams.councils']()}</h3><Button variant="ghost" size="sm" class="h-7 text-ui-xs" onclick={() => openCouncil(selected)}>{m['workstreams.open_council']()}<ArrowRight size={11} /></Button></div>
                {#if selected.councils.length}<div class="space-y-2">{#each selected.councils as council (council.id)}<div class="rounded-md border border-[var(--app-border)] bg-[var(--app-surface-subtle)] p-2.5"><div class="flex items-center gap-2"><strong class="min-w-0 flex-1 truncate text-ui-xs">{council.title}</strong><span class="text-ui-xs uppercase text-[var(--app-text-muted)]">{councilStatusLabel(council.status)}</span></div><p class="mt-1 text-ui-xs text-[var(--app-text-muted)]">{m['workstreams.perspectives']({ done: council.completedPerspectives, total: council.totalPerspectives })}</p></div>{/each}</div>{:else}<p class="text-ui-xs text-[var(--app-text-muted)]">{m['workstreams.no_councils']()}</p>{/if}
              </section>
              <section class="border-b border-[var(--app-border)] p-5">
                <div class="mb-3 flex items-center justify-between"><h3 class="flex items-center gap-2 text-ui-sm font-semibold"><GitPullRequestArrow size={13} />{m['workstreams.reviews']()}</h3><Button variant="ghost" size="sm" class="h-7 text-ui-xs" onclick={openReviews}>{m['workstreams.open_reviews']()}<ArrowRight size={11} /></Button></div>
                {#if selected.reviews.length}<div class="space-y-2">{#each selected.reviews as review (review.id)}<div class="rounded-md border border-[var(--app-border)] bg-[var(--app-surface-subtle)] p-2.5"><div class="flex items-center gap-2"><strong class="min-w-0 flex-1 truncate text-ui-xs">{review.title}</strong><span class="text-ui-xs uppercase text-[var(--app-text-muted)]">{reviewStatusLabel(review.status)}</span></div><p class="mt-1 text-ui-xs text-[var(--app-text-muted)]">{m['workstreams.review_evidence']({ evidence: review.evidenceCount, tests: review.testCount, risks: review.riskCount })}</p></div>{/each}</div>{:else}<p class="text-ui-xs text-[var(--app-text-muted)]">{m['workstreams.no_reviews']()}</p>{/if}
              </section>
              <section class="p-5">
                <h3 class="mb-3 flex items-center gap-2 text-ui-sm font-semibold"><GitBranch size={13} />{m['workstreams.git']()}</h3>
                {#if selected.git.paths.length}<div class="space-y-1">{#each selected.git.paths as path}<div class="flex items-center gap-2 rounded px-1.5 py-1 text-ui-xs" class:bg-[var(--app-accent-soft)]={selected.git.changedPaths.includes(path)}><CheckCircle2 size={10} class={selected.git.changedPaths.includes(path) ? 'text-[var(--app-warning)]' : 'text-[var(--app-success)]'} /><span class="min-w-0 flex-1 truncate font-mono">{path}</span><span class="text-ui-xs text-[var(--app-text-muted)]">{selected.git.changedPaths.includes(path) ? m['workstreams.changed']() : m['workstreams.tracked']()}</span></div>{/each}</div>{:else}<p class="text-ui-xs text-[var(--app-text-muted)]">{m['workstreams.no_files']()}</p>{/if}
              </section>
            </div>
          </div>
        </div>
      {/if}
    </div>
  {/if}
</section>
