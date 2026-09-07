<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { Braces, CheckCircle2, MessageSquareText, Palette, RefreshCw, Search, TriangleAlert } from '@lucide/svelte';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
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
  <header class="shrink-0 border-b border-[var(--app-border)] px-5 py-4"><div class="flex items-start justify-between gap-4"><div><div class="flex items-center gap-2"><MessageSquareText size={17} class="text-[var(--app-accent)]" /><h1 class="text-[14px] font-semibold">{m['annotations.title']()}</h1></div><p class="mt-1 max-w-2xl text-ui-xs leading-4 text-[var(--app-text-muted)]">{m['annotations.description']()}</p></div><Button variant="ghost" size="icon" class="size-8" aria-label={m['annotations.refresh']()} onclick={() => void load()}><RefreshCw size={14} class={loading ? 'animate-spin' : ''} /></Button></div>
    <div class="mt-4 flex flex-wrap gap-2">{#each [{ id: 'open', label: m['annotations.open'](), count: snapshot?.counts.open ?? 0 }, { id: 'resolved', label: m['annotations.resolved'](), count: snapshot?.counts.resolved ?? 0 }, { id: 'all', label: m['annotations.all'](), count: snapshot?.annotations.length ?? 0 }] as option}<button type="button" class="h-7 rounded-[5px] border px-2 text-ui-xs font-medium" class:border-[var(--app-accent)]={filter === option.id} class:bg-[var(--app-accent-soft)]={filter === option.id} class:border-[var(--app-border)]={filter !== option.id} onclick={() => (filter = option.id as typeof filter)}>{option.label} <span class="ml-1 text-[var(--app-text-muted)]">{option.count}</span></button>{/each}<div class="relative ml-auto min-w-[180px] max-w-[300px] flex-1"><Search size={12} class="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[var(--app-text-muted)]" /><Input bind:value={query} class="h-7 pl-7 text-ui-xs" placeholder={m['annotations.search']()} /></div></div>
  </header>
  {#if error}<div class="m-4 flex items-center gap-2 rounded-md border border-[var(--app-danger)]/40 p-3 text-ui-xs text-[var(--app-danger)]"><TriangleAlert size={13} />{error}</div>
  {:else if loading && !snapshot}<div class="grid flex-1 place-items-center text-ui-xs text-[var(--app-text-muted)]">{m['annotations.loading']()}</div>
  {:else if !filtered.length}<div class="grid flex-1 place-items-center p-8 text-center"><div><CheckCircle2 size={27} class="mx-auto text-[var(--app-success)]" /><h2 class="mt-3 text-ui-lg font-semibold">{m['annotations.empty_title']()}</h2><p class="mt-1 text-ui-xs text-[var(--app-text-muted)]">{m['annotations.empty_body']()}</p></div></div>
  {:else}<div class="grid min-h-0 flex-1 grid-cols-[minmax(220px,320px)_minmax(0,1fr)] max-[700px]:grid-cols-[210px_minmax(340px,1fr)]"><aside class="min-h-0 overflow-y-auto border-r border-[var(--app-border)] p-2">{#each filtered as item (item.id)}<button type="button" class="mb-1 w-full rounded-md border p-2.5 text-left" class:border-[var(--app-accent)]={selected?.id === item.id} class:bg-[var(--app-accent-soft)]={selected?.id === item.id} class:border-transparent={selected?.id !== item.id} onclick={() => (selectedId = item.id)}><span class="flex items-center gap-2">{#if item.kind === 'design'}<Palette size={11} />{:else}<Braces size={11} />{/if}<strong class="min-w-0 flex-1 truncate text-ui-xs">{item.targetTitle}</strong>{#if item.stale}<TriangleAlert size={11} class="text-[var(--app-warning)]" />{/if}</span><p class="mt-1.5 line-clamp-2 text-ui-xs leading-4 text-[var(--app-text-muted)]">{item.body}</p></button>{/each}</aside>
    {#if selected}<article class="min-h-0 overflow-y-auto p-5"><div class="flex items-start justify-between gap-4"><div><span class="text-ui-xs font-semibold uppercase text-[var(--app-accent)]">{selected.kind === 'design' ? m['annotations.kind_design']() : m['annotations.kind_code']()}</span><h2 class="mt-1 text-[16px] font-semibold">{selected.targetTitle}</h2>{#if selected.targetDetail}<code class="mt-1 block text-ui-xs text-[var(--app-text-muted)]">{selected.targetDetail}</code>{/if}</div><Button variant="outline" size="sm" class="h-8 text-ui-xs" onclick={() => void goto(selected.route)}>{m['annotations.open_source']()}</Button></div><blockquote class="mt-5 border-l-2 border-[var(--app-accent)] pl-4 text-ui-md leading-6">{selected.body}</blockquote><dl class="mt-5 grid grid-cols-2 gap-4 border-t border-[var(--app-border)] pt-4 text-ui-xs"><div><dt class="text-[var(--app-text-muted)]">{m['annotations.status']()}</dt><dd class="mt-1 font-medium">{selected.status === 'open' ? m['annotations.open']() : m['annotations.resolved']()}</dd></div><div><dt class="text-[var(--app-text-muted)]">{m['annotations.author']()}</dt><dd class="mt-1 font-medium">{selected.authorTitle ?? m['memory.author_user']()}</dd></div><div><dt class="text-[var(--app-text-muted)]">{m['annotations.revision']()}</dt><dd class="mt-1 font-mono">{selected.revision}</dd></div><div><dt class="text-[var(--app-text-muted)]">{m['annotations.updated']()}</dt><dd class="mt-1">{formatDate(selected.updatedAt)}</dd></div></dl>{#if selected.stale}<p class="mt-4 flex gap-2 rounded-md border border-[var(--app-warning)]/40 bg-[color-mix(in_srgb,var(--app-warning)_8%,transparent)] p-3 text-ui-xs"><TriangleAlert size={12} class="shrink-0 text-[var(--app-warning)]" />{m['annotations.stale']()}</p>{/if}</article>{/if}
  </div>{/if}
</section>
