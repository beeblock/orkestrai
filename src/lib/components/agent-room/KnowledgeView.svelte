<script lang="ts">
  import { onMount } from 'svelte';
  import { Search, RefreshCw, Upload, Plus, ExternalLink, FileText, X } from '@lucide/svelte';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import * as Tabs from '$lib/components/ui/tabs';
  import * as Select from '$lib/components/ui/select';
  import type { KnowledgeDocument, KnowledgeResult, KnowledgeLink } from '$lib/modules/agent-room/domain/knowledge.js';
  import type { CanvasNode } from '$lib/modules/agent-room/domain/types.js';
  import KnowledgeGraph from './KnowledgeGraph.svelte';
  import DocumentPassages from './DocumentPassages.svelte';
  import AgentLearningPanel from './AgentLearningPanel.svelte';
  import WorkspaceMemoryView from './WorkspaceMemoryView.svelte';
  import { knowledgeApi, uploadKnowledgeFile } from './knowledge-client.js';
  import { knowledgeLabel } from './knowledge-labels.js';
  import { subscribeKnowledge } from './knowledge-live.js';
  import * as m from '$lib/paraglide/messages.js';
  let { workspaceId, onJumpToNode, embedded = false }: { workspaceId: string; onJumpToNode?: (id: string) => void; embedded?: boolean } = $props();
  let tab = $state('sources'), query = $state(''), kind = $state('all'), tag = $state('');
  let result = $state<KnowledgeResult | null>(null), document = $state<KnowledgeDocument | null>(null);
  let links = $state<KnowledgeLink[]>([]), tagDraft = $state('');
  let loading = $state(false), busy = $state(false), error = $state(''), selectedId = $state<string | null>(null);
  let fileInput: HTMLInputElement;
  let alive = true, sequence = 0, selectionSequence = 0;
  let connected = $state(false), watching = false, unsubscribe: (() => void) | undefined;
  let refreshTimer: ReturnType<typeof setTimeout> | undefined, dirty = false;
  let section: HTMLElement;
  function scheduleRefresh() {
    dirty = true;
    if (refreshTimer) return;
    refreshTimer = setTimeout(() => {
      refreshTimer = undefined;
      if (!alive || !watching || loading || busy) return;
      dirty = false; void load();
    }, 180);
  }
  const tabClass = 'shrink-0 data-[state=active]:border-[var(--app-accent)] data-[state=active]:bg-[var(--app-surface)] data-[state=active]:text-[var(--app-text)]';
  const selectedLinks = $derived(links.filter(link => link.source === selectedId || link.target === selectedId));
  async function load(force = false) {
    const request = ++sequence;
    loading = true; error = '';
    try {
      if (force) await knowledgeApi(workspaceId, 'knowledge', { command: 'refresh' });
      const params = new URLSearchParams({ q: query, limit: '300' });
      if (watching) params.set('live', '1');
      if (kind !== 'all') params.set('kind', kind);
      if (tag) params.set('tag', tag);
      const next = await knowledgeApi<KnowledgeResult>(workspaceId, `knowledge?${params}`);
      if (!alive || request !== sequence) return;
      result = next;
      if (selectedId && next.items.some(item => item.id === selectedId)) await select(selectedId);
      else if (selectedId) { selectedId = null; document = null; selectionSequence++; }
    } catch { if (alive) error = m['knowledge.error'](); }
    finally { if (alive && request === sequence) { loading = false; if (dirty) scheduleRefresh(); } }
  }
  async function select(id: string) {
    selectedId = id;
    const request = ++selectionSequence;
    try {
      const next = await knowledgeApi<{ document: KnowledgeDocument; links: KnowledgeLink[] }>(workspaceId, `knowledge?id=${encodeURIComponent(id)}`);
      if (!alive || request !== selectionSequence) return;
      const preserveTagDraft = document?.id === next.document.id && tagDraft !== document.tags.join(', ');
      document = next.document; links = next.links;
      if (!preserveTagDraft) tagDraft = document.tags.join(', ');
    } catch { if (alive) { document = null; error = m['knowledge.error'](); } }
  }
  async function upload(files: FileList | null) {
    if (!files?.length || busy) return;
    const snapshot = Array.from(files).slice(0, 100);
    busy = true; error = '';
    try { for (const file of snapshot) await uploadKnowledgeFile(workspaceId, file); await load(); }
    catch { error = m['knowledge.upload_error'](); }
    finally { busy = false; if (fileInput) fileInput.value = ''; }
  }
  async function saveTags() {
    if (!document?.nodeId) return;
    busy = true;
    try { await knowledgeApi(workspaceId, 'knowledge', { command: 'tags', nodeId: document.nodeId, tags: tagDraft.split(',').map(value => value.trim()).filter(Boolean).slice(0, 24) }); await load(); }
    catch { error = m['knowledge.error'](); } finally { busy = false; }
  }
  async function addNode() {
    busy = true;
    try {
      const node = await knowledgeApi<CanvasNode>(workspaceId, 'knowledge', { command: 'create', title: m['knowledge.title']() });
      onJumpToNode?.(node.id);
    } catch { error = m['knowledge.error'](); } finally { busy = false; }
  }
  onMount(() => {
    alive = true; void load();
    let inViewport = false;
    const update = () => {
      const next = inViewport && globalThis.document.visibilityState === 'visible';
      if (watching === next) return;
      watching = next; unsubscribe?.(); unsubscribe = undefined;
      if (next) { unsubscribe = subscribeKnowledge(workspaceId, scheduleRefresh, value => connected = value); void load(); }
      else connected = false;
    };
    const observer = new IntersectionObserver(([entry]) => { inViewport = entry.isIntersecting; update(); }); observer.observe(section);
    globalThis.document.addEventListener('visibilitychange', update);
    // Lease renewal and recovery after a missed event, not the primary update path.
    const timer = setInterval(() => { if (watching && !loading && !busy && ['sources', 'graph'].includes(tab)) void load(); }, 15_000);
    return () => { alive = false; sequence++; selectionSequence++; clearInterval(timer); clearTimeout(refreshTimer); unsubscribe?.(); observer.disconnect(); globalThis.document.removeEventListener('visibilitychange', update); };
  });
</script>

<section bind:this={section} class="nodrag nowheel flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-[var(--app-bg)] text-[var(--app-text)]" data-testid="knowledge-view">
  <header class="flex flex-wrap items-center gap-2 border-b border-[var(--app-border)] px-3 py-2">
    <h2 class="mr-auto text-sm font-semibold">{m['knowledge.title']()}</h2>
    {#if !embedded}<Button size="sm" variant="outline" disabled={busy} onclick={() => void addNode()}><Plus size={14} />{m['knowledge.add_node']()}</Button>{/if}
    <input class="hidden" type="file" multiple bind:this={fileInput} onchange={(event) => void upload(event.currentTarget.files)} />
    <Button size="sm" variant="outline" disabled={busy} onclick={() => fileInput.click()}><Upload size={14} />{m['knowledge.import']()}</Button>
    <Button variant="outline" size="icon" disabled={loading || busy} title={m['knowledge.refresh']()} aria-label={m['knowledge.refresh']()} onclick={() => void load(true)}><RefreshCw size={15} class={loading ? 'animate-spin' : ''} /></Button>
  </header>
  {#if error}<p role="alert" class="px-3 py-2 text-xs text-[var(--app-danger)]">{error}</p>{/if}
  <Tabs.Root bind:value={tab} class="flex min-h-0 flex-1 flex-col gap-0">
    <Tabs.List class="mx-3 my-2 flex h-9 w-fit max-w-[calc(100%-1.5rem)] shrink-0 justify-start overflow-x-auto">
      <Tabs.Trigger value="sources" class={tabClass}>{m['knowledge.sources']()}</Tabs.Trigger>
      <Tabs.Trigger value="graph" class={tabClass}>{m['knowledge.graph']()}</Tabs.Trigger>
      <Tabs.Trigger value="memory" class={tabClass}>{m['memory.title']()}</Tabs.Trigger>
      <Tabs.Trigger value="learning" class={tabClass}>{m['learning.title']()}</Tabs.Trigger>
    </Tabs.List>
    {#if tab === 'sources' || tab === 'graph'}
      <form class="flex flex-wrap items-center gap-2 border-b border-[var(--app-border)] px-3 pb-2" onsubmit={(event) => { event.preventDefault(); void load(); }}>
        <div class="flex min-w-40 flex-1 items-center gap-2"><Search size={15} /><Input aria-label={m['knowledge.search']()} placeholder={m['knowledge.search']()} bind:value={query} /></div>
        <Select.Root type="single" value={kind} onValueChange={(value) => { kind = value; void load(); }}><Select.Trigger class="w-36">{kind === 'all' ? m['knowledge.all']() : knowledgeLabel(kind)}</Select.Trigger><Select.Content><Select.Item value="all">{m['knowledge.all']()}</Select.Item>{#each ['note', 'file', 'task', 'memory', 'image', 'design', 'codeGraph'] as value}<Select.Item {value}>{knowledgeLabel(value)}</Select.Item>{/each}</Select.Content></Select.Root>
        <Input class="w-28" aria-label={m['knowledge.tag']()} placeholder={m['knowledge.tag']()} bind:value={tag} />
        <Button type="submit" size="icon" title={m['knowledge.search']()} aria-label={m['knowledge.search']()}><Search size={15} /></Button>
      </form>
      <div class="relative flex min-h-0 flex-1 overflow-hidden @container/knowledge">
        <div class="min-h-0 min-w-0 flex-1 overflow-auto overscroll-contain">
          {#if tab === 'graph' && result}<KnowledgeGraph items={result.items} links={result.links} {selectedId} onSelect={(id) => void select(id)} />
          {:else}
            {#each result?.items ?? [] as item (item.id)}
              <button class="block w-full border-b border-[var(--app-border)] border-l-2 px-3 py-3 text-left hover:bg-[var(--app-hover)]" style:border-left-color={selectedId === item.id ? 'var(--app-accent)' : 'transparent'} style:background={selectedId === item.id ? 'var(--app-surface-subtle)' : undefined} aria-pressed={selectedId === item.id} onclick={() => void select(item.id)}>
                <span class="flex gap-2 text-sm font-medium"><FileText size={15} class="mt-0.5 shrink-0" /><span class="break-words">{item.title}</span></span>
                <span class="mt-1 block text-xs text-[var(--app-text-muted)]">{knowledgeLabel(item.kind)} · {knowledgeLabel(item.status)} · v{item.revision}</span>
                <span class="mt-2 line-clamp-2 break-words text-xs">{item.excerpt}</span>
                {#if item.tags.length}<span class="mt-1 block text-xs text-[var(--app-text-muted)]">{item.tags.map(value => `#${value}`).join(' ')}</span>{/if}
              </button>
            {:else}<p class="p-4 text-sm text-[var(--app-text-muted)]">{loading ? m['knowledge.loading']() : m['knowledge.empty']()}</p>{/each}
          {/if}
        </div>
        {#if document}
          <aside class="absolute inset-y-0 right-0 z-30 w-80 max-w-[90%] overflow-auto overscroll-contain border-l border-[var(--app-border)] bg-[var(--app-surface)] p-3 shadow-lg @min-[760px]/knowledge:static @min-[760px]/knowledge:shrink-0 @min-[760px]/knowledge:shadow-none">
            <div class="flex items-start gap-2"><h3 class="min-w-0 flex-1 break-words text-sm font-semibold">{document.title}</h3><Button variant="ghost" size="icon" aria-label={m['knowledge.close']()} onclick={() => { document = null; selectedId = null; selectionSequence++; }}><X size={14} /></Button></div>
            <p class="my-2 text-xs text-[var(--app-text-muted)]">{knowledgeLabel(document.status)} · v{document.revision} · {new Date(document.indexedAt).toLocaleString()}</p>
            {#if document.path}<p class="mb-2 break-all font-mono text-xs">{document.path}</p>{/if}
            {#if document.nodeId && onJumpToNode}<Button size="sm" variant="outline" onclick={() => onJumpToNode?.(document!.nodeId!)}><ExternalLink size={14} />{m['knowledge.open_source']()}</Button>{/if}
            {#if document.nodeId}<form class="my-3 flex gap-1" onsubmit={(event) => { event.preventDefault(); void saveTags(); }}><Input aria-label={m['knowledge.tags']()} placeholder={m['knowledge.tags']()} bind:value={tagDraft} /><Button type="submit" variant="outline" disabled={busy}>{m['knowledge.save']()}</Button></form>{/if}
            {#if document.truncated}<p class="my-2 text-xs text-[var(--app-warning)]">{m['knowledge.truncated']()}</p>{/if}
            <DocumentPassages passages={document.passages} />
            <h4 class="mt-4 text-xs font-semibold">{m['knowledge.backlinks']()}</h4>
            {#each selectedLinks as link}
              {@const target = link.source === selectedId ? link.target : link.source}
              <button class="mt-1 block w-full break-words rounded px-2 py-1 text-left text-xs hover:bg-[var(--app-hover)]" onclick={() => void select(target)}>{result?.items.find(item => item.id === target)?.title ?? target}</button>
            {:else}<p class="mt-1 text-xs text-[var(--app-text-muted)]">{m['knowledge.no_links']()}</p>{/each}
          </aside>
        {/if}
      </div>
      <footer class="flex shrink-0 items-center gap-2 border-t border-[var(--app-border)] px-3 py-1.5 text-xs text-[var(--app-text-muted)]"><span class="min-w-0 flex-1">{result?.total ?? 0} · {result?.truncated ? m['knowledge.truncated']() : m['knowledge.sources']()}</span><span class="flex shrink-0 items-center gap-1.5" role="status" data-testid="knowledge-live"><span class="size-1.5 rounded-full" style:background={connected && !error ? 'var(--app-success)' : 'var(--app-warning)'}></span>{error ? m['knowledge.live_error']() : loading ? m['knowledge.live_updating']() : connected ? m['knowledge.live']() : m['knowledge.live_connecting']()}</span></footer>
    {:else if tab === 'memory'}<div class="min-h-0 flex-1"><WorkspaceMemoryView {workspaceId} compact /></div>
    {:else}<div class="min-h-0 flex-1"><AgentLearningPanel {workspaceId} /></div>{/if}
  </Tabs.Root>
</section>
