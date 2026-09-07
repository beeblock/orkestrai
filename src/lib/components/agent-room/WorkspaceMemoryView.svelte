<script lang="ts">
  import { onMount } from 'svelte';
  import { getCsrfToken } from '@beeblock/svelar/http';
  import { toast } from '@beeblock/svelar/ui';
  import { Archive, BookMarked, Check, ExternalLink, FileText, History, Plus, RefreshCw, Search, Star, Trash2 } from '@lucide/svelte';
  import * as Dialog from '$lib/components/ui/dialog';
  import * as Select from '$lib/components/ui/select';
  import { Button } from '$lib/components/ui/button';
  import { Checkbox } from '$lib/components/ui/checkbox';
  import { Input } from '$lib/components/ui/input';
  import { Textarea } from '$lib/components/ui/textarea';
  import type { WorkspaceMemoryEntry, WorkspaceMemoryKind, WorkspaceMemorySourceType } from '$lib/modules/agent-room/domain/types.js';
  import * as m from '$lib/paraglide/messages.js';

  type SourceDraft = { type: WorkspaceMemorySourceType; sourceId: string; label: string; uri: string; excerpt: string };
  type Draft = { title: string; content: string; kind: WorkspaceMemoryKind; confidence: number; pinned: boolean; tags: string; sources: SourceDraft[] };
  let { workspaceId, compact = false }: { workspaceId: string; compact?: boolean } = $props();

  let entries = $state<WorkspaceMemoryEntry[]>([]);
  let loading = $state(true);
  let saving = $state(false);
  let query = $state('');
  let includeHistory = $state(false);
  let selectedId = $state<string | null>(null);
  let editorOpen = $state(false);
  let editing = $state<WorkspaceMemoryEntry | null>(null);
  let refreshTimer: ReturnType<typeof setTimeout> | null = null;
  let draft = $state<Draft>(emptyDraft());

  const selected = $derived(entries.find((entry) => entry.id === selectedId) ?? entries[0] ?? null);
  const kinds: WorkspaceMemoryKind[] = ['decision', 'fact', 'preference', 'constraint', 'reference', 'lesson'];
  const sourceTypes: WorkspaceMemorySourceType[] = ['user', 'note', 'task', 'message', 'file', 'url', 'git', 'review', 'council', 'agent'];

  function emptySource(): SourceDraft {
    return { type: 'user', sourceId: '', label: m['memory.source_user_default'](), uri: '', excerpt: '' };
  }

  function emptyDraft(): Draft {
    return { title: '', content: '', kind: 'fact', confidence: 100, pinned: false, tags: '', sources: [emptySource()] };
  }

  function kindLabel(kind: WorkspaceMemoryKind): string {
    if (kind === 'decision') return m['memory.kind_decision']();
    if (kind === 'fact') return m['memory.kind_fact']();
    if (kind === 'preference') return m['memory.kind_preference']();
    if (kind === 'constraint') return m['memory.kind_constraint']();
    if (kind === 'reference') return m['memory.kind_reference']();
    return m['memory.kind_lesson']();
  }

  function sourceLabel(type: WorkspaceMemorySourceType): string {
    if (type === 'user') return m['memory.source_user']();
    if (type === 'note') return m['memory.source_note']();
    if (type === 'task') return m['memory.source_task']();
    if (type === 'message') return m['memory.source_message']();
    if (type === 'file') return m['memory.source_file']();
    if (type === 'url') return m['memory.source_url']();
    if (type === 'git') return m['memory.source_git']();
    if (type === 'review') return m['memory.source_review']();
    if (type === 'council') return m['memory.source_council']();
    return m['memory.source_agent']();
  }

  function formatDate(value: string): string {
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
  }

  async function load(silent = false): Promise<void> {
    if (!silent) loading = true;
    try {
      const params = new URLSearchParams();
      if (query.trim()) params.set('q', query.trim());
      if (includeHistory) params.set('history', '1');
      const response = await fetch(`/api/agent-room/workspaces/${workspaceId}/memory?${params}`, { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? m['memory.load_error']());
      entries = payload.data;
      if (selectedId && !entries.some((entry) => entry.id === selectedId)) selectedId = null;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : m['memory.load_error']());
    } finally {
      if (!silent) loading = false;
    }
  }

  function scheduleLoad(): void {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => void load(true), 180);
  }

  function openCreate(): void {
    editing = null;
    draft = emptyDraft();
    editorOpen = true;
  }

  function openRevise(entry: WorkspaceMemoryEntry): void {
    editing = entry;
    draft = {
      title: entry.title,
      content: entry.content,
      kind: entry.kind,
      confidence: entry.confidence,
      pinned: entry.pinned,
      tags: entry.tags.join(', '),
      sources: entry.sources.map((source) => ({ type: source.type, sourceId: source.sourceId ?? '', label: source.label, uri: source.uri ?? '', excerpt: source.excerpt ?? '' })),
    };
    editorOpen = true;
  }

  function patchSource(index: number, patch: Partial<SourceDraft>): void {
    draft.sources[index] = { ...draft.sources[index], ...patch };
    draft.sources = [...draft.sources];
  }

  function patchSourceText(event: Event, index: number, key: 'label' | 'sourceId' | 'uri' | 'excerpt'): void {
    patchSource(index, { [key]: (event.currentTarget as HTMLInputElement | HTMLTextAreaElement).value });
  }

  async function save(): Promise<void> {
    if (!draft.title.trim() || !draft.content.trim() || !draft.sources.length || draft.sources.some((source) => !source.label.trim())) {
      toast.error(m['memory.validation_error']());
      return;
    }
    saving = true;
    try {
      const csrf = getCsrfToken();
      const body = {
        title: draft.title.trim(), content: draft.content.trim(), kind: draft.kind,
        confidence: Math.max(0, Math.min(100, Number(draft.confidence) || 0)), pinned: draft.pinned,
        tags: draft.tags.split(',').map((tag) => tag.trim()).filter(Boolean),
        createdByNodeId: editing?.createdByNodeId ?? null,
        sources: draft.sources.map((source) => ({
          type: source.type, sourceId: source.sourceId.trim() || null, label: source.label.trim(),
          uri: source.uri.trim() || null, excerpt: source.excerpt.trim() || null,
        })),
        ...(editing ? { baseUpdatedAt: editing.updatedAt, baseRevision: editing.revision } : {}),
      };
      const endpoint = editing
        ? `/api/agent-room/workspaces/${workspaceId}/memory/${editing.id}`
        : `/api/agent-room/workspaces/${workspaceId}/memory`;
      const response = await fetch(endpoint, {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json', ...(csrf ? { 'X-CSRF-Token': csrf } : {}) },
        body: JSON.stringify(body),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? m['memory.save_error']());
      editorOpen = false;
      selectedId = payload.data.id;
      await load(true);
      toast.success(editing ? m['memory.revised']() : m['memory.saved']());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : m['memory.save_error']());
    } finally {
      saving = false;
    }
  }

  async function archive(entry: WorkspaceMemoryEntry): Promise<void> {
    try {
      const csrf = getCsrfToken();
      const response = await fetch(`/api/agent-room/workspaces/${workspaceId}/memory/${entry.id}`, {
        method: 'DELETE', headers: csrf ? { 'X-CSRF-Token': csrf } : {},
      });
      if (!response.ok) throw new Error((await response.json()).error ?? m['memory.archive_error']());
      selectedId = null;
      await load(true);
      toast.success(m['memory.archived']());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : m['memory.archive_error']());
    }
  }

  $effect(() => { query; includeHistory; scheduleLoad(); });

  onMount(() => {
    void load();
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
    const socket = new WebSocket(`${protocol}://${location.host}/ws/agent-room/pty`);
    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(String(event.data));
        if (message.type === 'memoryChanged' && message.workspaceId === workspaceId) scheduleLoad();
      } catch { /* Terminal frame. */ }
    };
    return () => { if (refreshTimer) clearTimeout(refreshTimer); socket.close(); };
  });
</script>

<section class="flex h-full min-h-0 flex-col bg-[var(--app-canvas)] text-[var(--app-text)]" data-testid="workspace-memory-view">
  <header class="shrink-0 border-b border-[var(--app-border)] px-5 py-4">
    <div class="flex items-start justify-between gap-4">
      <div class="min-w-0"><div class="flex items-center gap-2"><BookMarked size={17} class="text-[var(--app-accent)]" /><h1 class="text-[14px] font-semibold">{m['memory.title']()}</h1></div><p class="mt-1 max-w-2xl text-ui-xs leading-4 text-[var(--app-text-muted)]">{m['memory.description']()}</p></div>
      <div class="flex shrink-0 gap-1"><Button variant="ghost" size="icon" class="size-8" aria-label={m['memory.refresh']()} onclick={() => void load()}><RefreshCw size={14} class={loading ? 'animate-spin' : ''} /></Button><Button size="sm" class="h-8 text-ui-xs" onclick={openCreate}><Plus size={13} />{m['memory.new']()}</Button></div>
    </div>
    <div class="mt-4 flex items-center gap-2">
      <div class="relative min-w-[180px] max-w-xl flex-1"><Search size={12} class="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[var(--app-text-muted)]" /><Input bind:value={query} class="h-8 pl-7 text-ui-xs" placeholder={m['memory.search']()} /></div>
      <label class="flex h-8 items-center gap-2 rounded-md border border-[var(--app-border)] px-2.5 text-ui-xs"><Checkbox bind:checked={includeHistory} /><History size={12} />{m['memory.history']()}</label>
    </div>
  </header>

  {#if loading && !entries.length}<div class="grid min-h-0 flex-1 place-items-center text-ui-sm text-[var(--app-text-muted)]">{m['memory.loading']()}</div>
  {:else if !entries.length}<div class="grid min-h-0 flex-1 place-items-center px-8 text-center"><div><BookMarked size={28} class="mx-auto text-[var(--app-text-muted)]" /><h2 class="mt-3 text-ui-lg font-semibold">{m['memory.empty_title']()}</h2><p class="mt-1 max-w-sm text-ui-sm leading-5 text-[var(--app-text-muted)]">{m['memory.empty_body']()}</p><Button size="sm" class="mt-4" onclick={openCreate}><Plus size={13} />{m['memory.new']()}</Button></div></div>
  {:else}
    <div class={`grid min-h-0 flex-1 ${compact ? 'grid-cols-[210px_minmax(360px,1fr)]' : 'grid-cols-[minmax(220px,320px)_minmax(0,1fr)]'}`}>
      <aside class="min-h-0 overflow-y-auto border-r border-[var(--app-border)] p-2">
        {#each entries as entry (entry.id)}<button type="button" class="mb-1 w-full rounded-md border p-2.5 text-left transition-colors" class:border-[var(--app-accent)]={selected?.id === entry.id} class:bg-[var(--app-accent-soft)]={selected?.id === entry.id} class:border-transparent={selected?.id !== entry.id} class:opacity-60={entry.status !== 'active'} onclick={() => (selectedId = entry.id)}><span class="flex items-center gap-2">{#if entry.pinned}<Star size={11} class="fill-[var(--app-warning)] text-[var(--app-warning)]" />{/if}<strong class="min-w-0 flex-1 truncate text-ui-xs">{entry.title}</strong><span class="text-ui-xs text-[var(--app-text-muted)]">v{entry.revision}</span></span><span class="mt-1.5 flex gap-1.5 text-ui-xs text-[var(--app-text-muted)]"><span>{kindLabel(entry.kind)}</span><span>·</span><span>{entry.confidence}%</span><span>·</span><span>{entry.sources.length} {m['memory.sources']()}</span></span></button>{/each}
      </aside>
      {#if selected}<article class="min-h-0 overflow-y-auto p-5"><div class="flex items-start justify-between gap-4"><div class="min-w-0"><div class="flex flex-wrap items-center gap-2 text-ui-xs text-[var(--app-text-muted)]"><span class="rounded bg-[var(--app-accent-soft)] px-1.5 py-0.5 font-medium text-[var(--app-accent)]">{kindLabel(selected.kind)}</span><span>{m['memory.revision']({ revision: selected.revision })}</span><span>{selected.status}</span></div><h2 class="mt-2 text-[17px] font-semibold leading-6">{selected.title}</h2></div>{#if selected.status === 'active'}<div class="flex shrink-0 gap-1"><Button variant="outline" size="sm" class="h-8 text-ui-xs" onclick={() => openRevise(selected)}><Check size={12} />{m['memory.revise']()}</Button><Button variant="ghost" size="icon" class="size-8 text-[var(--app-danger)]" aria-label={m['memory.archive']()} onclick={() => void archive(selected)}><Archive size={13} /></Button></div>{/if}</div>
        <p class="mt-4 whitespace-pre-wrap text-ui-md leading-6 text-[var(--app-text-soft)]">{selected.content}</p>
        {#if selected.tags.length}<div class="mt-4 flex flex-wrap gap-1.5">{#each selected.tags as tag}<span class="rounded border border-[var(--app-border)] bg-[var(--app-surface-subtle)] px-2 py-1 text-ui-xs">{tag}</span>{/each}</div>{/if}
        <dl class="mt-5 grid grid-cols-2 gap-3 border-y border-[var(--app-border)] py-3 text-ui-xs"><div><dt class="text-[var(--app-text-muted)]">{m['memory.confidence']()}</dt><dd class="mt-1 font-medium">{selected.confidence}%</dd></div><div><dt class="text-[var(--app-text-muted)]">{m['memory.author']()}</dt><dd class="mt-1 font-medium">{selected.createdByTitle ?? m['memory.author_user']()}</dd></div><div><dt class="text-[var(--app-text-muted)]">{m['memory.verified']()}</dt><dd class="mt-1">{formatDate(selected.verifiedAt ?? selected.updatedAt)}</dd></div><div><dt class="text-[var(--app-text-muted)]">{m['memory.updated']()}</dt><dd class="mt-1">{formatDate(selected.updatedAt)}</dd></div></dl>
        <section class="mt-5"><h3 class="mb-2 text-ui-sm font-semibold">{m['memory.provenance']()}</h3><div class="space-y-2">{#each selected.sources as source (source.id)}<div class="rounded-md border border-[var(--app-border)] bg-[var(--app-surface-subtle)] p-3"><div class="flex items-center gap-2"><FileText size={12} class="text-[var(--app-accent)]" /><strong class="min-w-0 flex-1 truncate text-ui-xs">{source.label}</strong><span class="text-ui-xs uppercase text-[var(--app-text-muted)]">{sourceLabel(source.type)}</span>{#if source.uri}<a href={source.uri} target="_blank" rel="noreferrer" aria-label={m['memory.open_source']()}><ExternalLink size={11} /></a>{/if}</div>{#if source.excerpt}<p class="mt-2 whitespace-pre-wrap text-ui-xs leading-4 text-[var(--app-text-muted)]">{source.excerpt}</p>{/if}<code class="mt-2 block truncate text-ui-xs text-[var(--app-text-muted)]">sha256:{source.contentHash}</code></div>{/each}</div></section>
      </article>{/if}
    </div>
  {/if}
</section>

<Dialog.Root bind:open={editorOpen}>
  <Dialog.Content class="max-h-[88vh] max-w-3xl overflow-y-auto p-0">
    <Dialog.Header class="border-b border-[var(--app-border)] px-5 py-4"><Dialog.Title>{editing ? m['memory.revise_title']() : m['memory.new_title']()}</Dialog.Title><Dialog.Description>{m['memory.editor_description']()}</Dialog.Description></Dialog.Header>
    <div class="grid gap-4 px-5 py-4 sm:grid-cols-2">
      <label class="grid gap-1.5 text-ui-xs font-medium sm:col-span-2">{m['memory.field_title']()}<Input bind:value={draft.title} maxlength={160} /></label>
      <label class="grid gap-1.5 text-ui-xs font-medium">{m['memory.kind']()}<Select.Root type="single" value={draft.kind} onValueChange={(value) => (draft.kind = value as WorkspaceMemoryKind)}><Select.Trigger class="w-full">{kindLabel(draft.kind)}</Select.Trigger><Select.Content>{#each kinds as kind}<Select.Item value={kind}>{kindLabel(kind)}</Select.Item>{/each}</Select.Content></Select.Root></label>
      <label class="grid gap-1.5 text-ui-xs font-medium">{m['memory.confidence']()}<Input type="number" min="0" max="100" bind:value={draft.confidence} /></label>
      <label class="grid gap-1.5 text-ui-xs font-medium sm:col-span-2">{m['memory.content']()}<Textarea bind:value={draft.content} class="min-h-32 resize-y" maxlength={12000} /></label>
      <label class="grid gap-1.5 text-ui-xs font-medium">{m['memory.tags']()}<Input bind:value={draft.tags} placeholder={m['memory.tags_placeholder']()} /></label>
      <label class="flex items-center gap-2 self-end pb-2 text-ui-xs font-medium"><Checkbox bind:checked={draft.pinned} /><Star size={12} />{m['memory.pinned']()}</label>
      <section class="sm:col-span-2"><div class="mb-2 flex items-center justify-between"><div><h3 class="text-ui-sm font-semibold">{m['memory.provenance']()}</h3><p class="text-ui-xs text-[var(--app-text-muted)]">{m['memory.sources_hint']()}</p></div><Button variant="outline" size="sm" class="h-7 text-ui-xs" disabled={draft.sources.length >= 8} onclick={() => (draft.sources = [...draft.sources, emptySource()])}><Plus size={11} />{m['memory.add_source']()}</Button></div>
        <div class="space-y-2">{#each draft.sources as source, index}<div class="grid gap-2 rounded-md border border-[var(--app-border)] bg-[var(--app-surface-subtle)] p-3 sm:grid-cols-2"><label class="grid gap-1 text-ui-xs">{m['memory.source_type']()}<Select.Root type="single" value={source.type} onValueChange={(value) => patchSource(index, { type: value as WorkspaceMemorySourceType })}><Select.Trigger class="w-full">{sourceLabel(source.type)}</Select.Trigger><Select.Content>{#each sourceTypes as type}<Select.Item value={type}>{sourceLabel(type)}</Select.Item>{/each}</Select.Content></Select.Root></label><label class="grid gap-1 text-ui-xs">{m['memory.source_label']()}<Input value={source.label} oninput={(event: Event) => patchSourceText(event, index, 'label')} /></label><label class="grid gap-1 text-ui-xs">{m['memory.source_id']()}<Input value={source.sourceId} oninput={(event: Event) => patchSourceText(event, index, 'sourceId')} /></label><label class="grid gap-1 text-ui-xs">{m['memory.source_uri']()}<Input value={source.uri} oninput={(event: Event) => patchSourceText(event, index, 'uri')} /></label><label class="grid gap-1 text-ui-xs sm:col-span-2">{m['memory.source_excerpt']()}<Textarea value={source.excerpt} oninput={(event: Event) => patchSourceText(event, index, 'excerpt')} class="min-h-16 resize-y" /></label>{#if draft.sources.length > 1}<Button variant="ghost" size="sm" class="h-7 justify-self-end text-ui-xs text-[var(--app-danger)] sm:col-span-2" onclick={() => (draft.sources = draft.sources.filter((_, itemIndex) => itemIndex !== index))}><Trash2 size={11} />{m['memory.remove_source']()}</Button>{/if}</div>{/each}</div>
      </section>
    </div>
    <Dialog.Footer class="border-t border-[var(--app-border)] px-5 py-3"><Button variant="outline" onclick={() => (editorOpen = false)}>{m['settings.cancel']()}</Button><Button onclick={() => void save()} disabled={saving}>{saving ? m['memory.saving']() : m['memory.save']()}</Button></Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
