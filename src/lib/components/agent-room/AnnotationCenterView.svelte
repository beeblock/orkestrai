<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { ArrowUpRight, Braces, CheckCircle2, MessageSquareText, Palette, RefreshCw, Search, TriangleAlert } from '@lucide/svelte';
  import { Button } from '$lib/components/ui/button';
  import * as InputGroup from '$lib/components/ui/input-group';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import * as Tooltip from '$lib/components/ui/tooltip';
  import { SegmentedControl } from '$lib/components/ui/segmented';
  import NodeEmptyState from './canvas/NodeEmptyState.svelte';
  import type { AnnotationCenterSnapshot, TraceableAnnotation } from '$lib/modules/agent-room/domain/types.js';
  import * as m from '$lib/paraglide/messages.js';

  let { workspaceId }: { workspaceId: string } = $props();
  let snapshot = $state<AnnotationCenterSnapshot | null>(null);
  let loading = $state(true);
  let error = $state('');
  let query = $state('');
  let filter = $state<'open' | 'resolved' | 'all'>('open');
  let selectedId = $state<string | null>(null);
  let refreshTimer: ReturnType<typeof setTimeout> | null = null;
  const filtered = $derived((snapshot?.annotations ?? []).filter((item) => {
    if (filter !== 'all' && item.status !== filter) return false;
    const term = query.trim().toLocaleLowerCase();
    return !term || [item.body, item.targetTitle, item.targetDetail, item.authorTitle, item.kind].some((value) => String(value ?? '').toLocaleLowerCase().includes(term));
  }));
  const selected = $derived(filtered.find((item) => item.id === selectedId) ?? filtered[0] ?? null);

  async function load(silent = false): Promise<void> {
    if (!silent) loading = true;
    try {
      const response = await fetch(`/api/agent-room/workspaces/${workspaceId}/annotations`, { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? m['annotations.load_error']());
      snapshot = payload.data;
      error = '';
    } catch (cause) { error = cause instanceof Error ? cause.message : m['annotations.load_error'](); }
    finally { if (!silent) loading = false; }
  }

  function scheduleRefresh(): void {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => void load(true), 180);
  }

  function formatDate(value: string): string {
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
  }

  onMount(() => {
    void load();
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
    const socket = new WebSocket(`${protocol}://${location.host}/ws/agent-room/pty`);
    socket.onmessage = (event) => {
      try { const message = JSON.parse(String(event.data)); if (message.workspaceId === workspaceId && ['gitReviewChanged', 'designChanged', 'workspaceChanged'].includes(message.type)) scheduleRefresh(); } catch { /* terminal frame */ }
    };
    return () => { if (refreshTimer) clearTimeout(refreshTimer); socket.close(); };
  });
</script>

<section class="flex h-full min-h-0 flex-col bg-[var(--app-canvas)] text-[var(--app-text)]" data-testid="annotation-center-view">
  <header class="shrink-0 border-b border-[var(--app-border)] bg-[var(--app-surface)] px-5 pb-3 pt-4">
    <div class="flex min-w-0 items-start gap-3">
      <span class="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-[var(--app-accent-soft)] text-[var(--app-accent)]" aria-hidden="true"><MessageSquareText size={17} /></span>
      <div class="min-w-0 flex-1">
        <h1 class="truncate font-display text-[15px] font-semibold tracking-[-0.01em]">{m['annotations.title']()}</h1>
        <p class="mt-0.5 truncate text-ui-sm text-[var(--app-text-muted)]" title={m['annotations.description']()}>{m['annotations.description']()}</p>
      </div>
      <Tooltip.Root>
        <Tooltip.Trigger>
          {#snippet child({ props })}
            <Button {...props} variant="ghost" size="icon-sm" aria-label={m['annotations.refresh']()} onclick={() => void load()}>
              <RefreshCw size={14} class={loading ? 'animate-spin' : ''} />
            </Button>
          {/snippet}
        </Tooltip.Trigger>
        <Tooltip.Content>{m['annotations.refresh']()}</Tooltip.Content>
      </Tooltip.Root>
    </div>
    <div class="mt-3 flex flex-wrap items-center gap-2">
      <SegmentedControl
        size="sm"
        label={m['annotations.status']()}
        bind:value={filter}
        options={[
          { value: 'open', label: m['annotations.open'](), count: snapshot?.counts.open ?? 0 },
          { value: 'resolved', label: m['annotations.resolved'](), count: snapshot?.counts.resolved ?? 0 },
          { value: 'all', label: m['annotations.all'](), count: snapshot?.annotations.length ?? 0 },
        ]}
      />
      <InputGroup.Root class="ml-auto h-8 min-w-[180px] max-w-[300px] flex-1 border-[var(--app-border)] bg-[var(--app-canvas)] shadow-none">
        <InputGroup.Addon><Search size={13} /></InputGroup.Addon>
        <InputGroup.Input bind:value={query} class="text-ui-md" placeholder={m['annotations.search']()} aria-label={m['annotations.search']()} data-annotation-search />
      </InputGroup.Root>
    </div>
  </header>

  {#if error}
    <NodeEmptyState icon={TriangleAlert} tone="danger" title={m['annotations.load_error']()} description={error === m['annotations.load_error']() ? undefined : error}>
      {#snippet actions()}<Button variant="outline" size="sm" onclick={() => void load()}><RefreshCw size={13} />{m['automation.retry']()}</Button>{/snippet}
    </NodeEmptyState>
  {:else if loading && !snapshot}
    <div class="grid min-h-0 flex-1 grid-cols-[minmax(220px,320px)_minmax(0,1fr)]" role="status" aria-label={m['annotations.loading']()}>
      <div class="space-y-1.5 border-r border-[var(--app-border)] p-2">
        {#each [0, 1, 2, 3] as row (row)}<Skeleton class="h-[58px] w-full rounded-lg bg-[var(--app-hover)]" />{/each}
      </div>
      <div class="space-y-3 p-6">
        <Skeleton class="h-4 w-32 bg-[var(--app-hover)]" />
        <Skeleton class="h-6 w-2/3 bg-[var(--app-hover)]" />
        <Skeleton class="h-20 w-full rounded-lg bg-[var(--app-hover)]" />
      </div>
    </div>
  {:else if !filtered.length}
    <NodeEmptyState icon={CheckCircle2} title={m['annotations.empty_title']()} description={m['annotations.empty_body']()} />
  {:else}
    <div class="grid min-h-0 flex-1 grid-cols-[minmax(220px,320px)_minmax(0,1fr)] max-[700px]:grid-cols-[210px_minmax(340px,1fr)]">
      <aside class="min-h-0 overflow-y-auto border-r border-[var(--app-border)] p-2">
        {#each filtered as item (item.id)}
          <button type="button" class="hub-row" class:selected={selected?.id === item.id} aria-current={selected?.id === item.id ? 'true' : undefined} onclick={() => (selectedId = item.id)}>
            <span class="flex min-w-0 items-center gap-2">
              {#if item.kind === 'design'}<Palette size={13} class="shrink-0 text-[var(--app-text-muted)]" />{:else}<Braces size={13} class="shrink-0 text-[var(--app-text-muted)]" />{/if}
              <strong class="min-w-0 flex-1 truncate text-ui-md font-semibold text-[var(--app-text)]">{item.targetTitle}</strong>
              {#if item.stale}<TriangleAlert size={12} class="shrink-0 text-[var(--app-warning)]" aria-label={m['annotations.stale']()} />{/if}
            </span>
            <span class="mt-1 line-clamp-2 text-ui-sm leading-[1.45] text-[var(--app-text-muted)]">{item.body}</span>
          </button>
        {/each}
      </aside>
      {#if selected}
        <article class="annotation-detail min-h-0 overflow-y-auto px-6 py-5">
          <div class="flex items-start justify-between gap-4">
            <div class="min-w-0">
              <span class="inline-flex items-center gap-1.5 rounded-md bg-[var(--app-hover)] px-1.5 py-0.5 text-ui-xs font-medium text-[var(--app-text-soft)]">
                {#if selected.kind === 'design'}<Palette size={11} />{:else}<Braces size={11} />{/if}
                {selected.kind === 'design' ? m['annotations.kind_design']() : m['annotations.kind_code']()}
              </span>
              <h2 class="mt-2 text-balance font-display text-[16px] font-semibold leading-snug">{selected.targetTitle}</h2>
              {#if selected.targetDetail}<code class="meta-mono mt-1 block truncate" title={selected.targetDetail}>{selected.targetDetail}</code>{/if}
            </div>
            <Button size="sm" class="shrink-0" onclick={() => void goto(selected.route)}>{m['annotations.open_source']()}<ArrowUpRight size={13} /></Button>
          </div>
          {#if selected.stale}
            <p class="mt-4 flex items-start gap-2 rounded-lg bg-[var(--app-warning-soft)] px-3 py-2.5 text-ui-sm leading-5 text-[var(--app-text)]">
              <TriangleAlert size={13} class="mt-0.5 shrink-0 text-[var(--app-warning)]" />{m['annotations.stale']()}
            </p>
          {/if}
          <blockquote class="mt-5 whitespace-pre-wrap break-words rounded-lg bg-[var(--app-surface)] px-4 py-3 text-ui-lg leading-6 shadow-border">{selected.body}</blockquote>
          <dl class="mt-6 grid grid-cols-2 gap-x-6 gap-y-4">
            <div class="min-w-0">
              <dt class="section-label">{m['annotations.status']()}</dt>
              <dd class="mt-1 flex items-center gap-1.5 text-ui-md font-medium">
                <span class="size-1.5 rounded-full" style:background={selected.status === 'open' ? 'var(--app-warning)' : 'var(--app-success)'} aria-hidden="true"></span>
                {selected.status === 'open' ? m['annotations.open']() : m['annotations.resolved']()}
              </dd>
            </div>
            <div class="min-w-0"><dt class="section-label">{m['annotations.author']()}</dt><dd class="mt-1 truncate text-ui-md font-medium">{selected.authorTitle ?? m['memory.author_user']()}</dd></div>
            <div class="min-w-0"><dt class="section-label">{m['annotations.revision']()}</dt><dd class="mt-1 truncate font-mono text-ui-sm tabular-nums text-[var(--app-text-soft)]" title={String(selected.revision)}>{selected.revision}</dd></div>
            <div class="min-w-0"><dt class="section-label">{m['annotations.updated']()}</dt><dd class="mt-1 text-ui-md tabular-nums text-[var(--app-text-soft)]">{formatDate(selected.updatedAt)}</dd></div>
          </dl>
        </article>
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

  .annotation-detail {
    animation: annotation-detail-in var(--duration-fast) var(--ease-smooth-out) both;
  }

  @keyframes annotation-detail-in {
    from {
      opacity: 0;
      transform: translateY(var(--distance-micro));
    }
  }
</style>
