<script lang="ts">
  import { onMount } from 'svelte';
  import { Search, RefreshCw, Upload, Plus, ExternalLink, FileText, X, ArrowRight, BookOpen, Brain, GraduationCap, Image as ImageIcon, ListTodo, LoaderCircle, Network, PenTool, StickyNote, TriangleAlert, Waypoints, Library, SearchX } from '@lucide/svelte';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import * as Tabs from '$lib/components/ui/tabs';
  import * as Select from '$lib/components/ui/select';
  import type { KnowledgeDocument, KnowledgeResult, KnowledgeLink } from '$lib/modules/agent-room/domain/knowledge.js';
  import type { CanvasNode } from '$lib/modules/agent-room/domain/types.js';
  import KnowledgeGraph from './KnowledgeGraph.svelte';
  import DocumentPassages from './DocumentPassages.svelte';
  import DocumentExtractionNotice from './DocumentExtractionNotice.svelte';
  import AgentLearningPanel from './AgentLearningPanel.svelte';
  import WorkspaceMemoryView from './WorkspaceMemoryView.svelte';
  import { knowledgeApi, uploadKnowledgeFile } from './knowledge-client.js';
  import { knowledgeLabel } from './knowledge-labels.js';
  import { subscribeKnowledge } from './knowledge-live.js';
  import NodeEmptyState from './canvas/NodeEmptyState.svelte';
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
  // Abas com aparencia de controle segmentado (trilho + pilula elevada), mantendo role=tab.
  const tabClass = 'kv-tab';
  const kindIcons: Record<string, typeof FileText> = { note: StickyNote, file: FileText, task: ListTodo, memory: Brain, image: ImageIcon, design: PenTool, codeGraph: Waypoints };
  const filtered = $derived(Boolean(query.trim() || tag.trim() || kind !== 'all'));
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

<section bind:this={section} class="kv nodrag nowheel flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-[var(--app-bg)] text-[var(--app-text)]" data-testid="knowledge-view">
  <header class="flex flex-wrap items-center gap-2 px-3 pt-3 pb-2">
    <h2 class="mr-auto text-ui-lg font-semibold">{m['knowledge.title']()}</h2>
    {#if !embedded}<Button size="sm" variant="outline" disabled={busy} onclick={() => void addNode()}><Plus size={14} />{m['knowledge.add_node']()}</Button>{/if}
    <input class="hidden" type="file" multiple bind:this={fileInput} onchange={(event) => void upload(event.currentTarget.files)} />
    <Button size="sm" disabled={busy} onclick={() => fileInput.click()}><Upload size={14} />{m['knowledge.import']()}</Button>
    <Button variant="ghost" size="icon-sm" disabled={loading || busy} title={m['knowledge.refresh']()} aria-label={m['knowledge.refresh']()} onclick={() => void load(true)}><RefreshCw size={14} class={loading ? 'animate-spin' : ''} /></Button>
  </header>
  {#if error}<p role="alert" class="kv-alert"><TriangleAlert size={13} aria-hidden="true" /><span>{error}</span></p>{/if}
  <Tabs.Root bind:value={tab} class="flex min-h-0 flex-1 flex-col gap-0">
    <Tabs.List class="kv-tabs mx-3 mb-2 flex h-8 w-fit max-w-[calc(100%-1.5rem)] shrink-0 justify-start gap-0.5 overflow-x-auto rounded-lg bg-[var(--app-hover)] p-0.5">
      <Tabs.Trigger value="sources" class={tabClass} title={m['knowledge.sources']()}><Library aria-hidden="true" /><span class="kv-tab-label">{m['knowledge.sources']()}</span></Tabs.Trigger>
      <Tabs.Trigger value="graph" class={tabClass} title={m['knowledge.graph']()}><Network aria-hidden="true" /><span class="kv-tab-label">{m['knowledge.graph']()}</span></Tabs.Trigger>
      <Tabs.Trigger value="memory" class={tabClass} title={m['memory.title']()}><Brain aria-hidden="true" /><span class="kv-tab-label">{m['memory.title']()}</span></Tabs.Trigger>
      <Tabs.Trigger value="learning" class={tabClass} title={m['learning.title']()}><GraduationCap aria-hidden="true" /><span class="kv-tab-label">{m['learning.title']()}</span></Tabs.Trigger>
    </Tabs.List>
    {#if tab === 'sources' || tab === 'graph'}
      <form class="flex flex-wrap items-center gap-1.5 border-b border-[var(--app-border)] px-3 pb-2.5" onsubmit={(event) => { event.preventDefault(); void load(); }}>
        <div class="relative min-w-40 flex-1">
          <Search size={14} class="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-[var(--app-text-muted)]" aria-hidden="true" />
          <Input class="h-8 pl-8" aria-label={m['knowledge.search']()} placeholder={m['knowledge.search']()} bind:value={query} />
        </div>
        <Select.Root type="single" value={kind} onValueChange={(value) => { kind = value; void load(); }}><Select.Trigger size="sm" class="h-8 w-36">{kind === 'all' ? m['knowledge.all']() : knowledgeLabel(kind)}</Select.Trigger><Select.Content><Select.Item value="all">{m['knowledge.all']()}</Select.Item>{#each ['note', 'file', 'task', 'memory', 'image', 'design', 'codeGraph'] as value}<Select.Item {value}>{knowledgeLabel(value)}</Select.Item>{/each}</Select.Content></Select.Root>
        <Input class="h-8 w-28" aria-label={m['knowledge.tag']()} placeholder={m['knowledge.tag']()} bind:value={tag} />
        <Button type="submit" variant="outline" size="icon" title={m['knowledge.search']()} aria-label={m['knowledge.search']()}><ArrowRight size={14} /></Button>
      </form>
      <div class="relative flex min-h-0 flex-1 overflow-hidden @container/knowledge">
        <div class="min-h-0 min-w-0 flex-1 overflow-auto overscroll-contain">
          {#if tab === 'graph' && result}<KnowledgeGraph items={result.items} links={result.links} {selectedId} onSelect={(id) => void select(id)} />
          {:else}
            <div class="kv-list">
              {#each result?.items ?? [] as item (item.id)}
                {@const KindIcon = kindIcons[item.kind] ?? FileText}
                <button class="kv-row" aria-pressed={selectedId === item.id} onclick={() => void select(item.id)}>
                  <span class="kv-row-icon" aria-hidden="true"><KindIcon size={14} /></span>
                  <span class="kv-row-main">
                    <span class="kv-row-title">{item.title}</span>
                    <span class="kv-row-meta">{knowledgeLabel(item.kind)} · <span class:kv-warn={item.truncated || item.status === 'missing' || item.status === 'error'}>{item.truncated ? m['knowledge.partial']() : knowledgeLabel(item.status)}</span> · <span class="kv-mono">v{item.revision}</span></span>
                    {#if item.excerpt && item.excerpt !== item.title}<span class="kv-row-excerpt">{item.excerpt}</span>{/if}
                    {#if item.tags.length}<span class="kv-row-tags">{#each item.tags as value}<span class="kv-tag">#{value}</span>{/each}</span>{/if}
                  </span>
                </button>
              {:else}
                {#if loading}
                  <div class="kv-fill"><span class="kv-loading" role="status"><LoaderCircle size={13} class="animate-spin" aria-hidden="true" />{m['knowledge.loading']()}</span></div>
                {:else}
                  <div class="kv-fill">
                    <NodeEmptyState icon={filtered ? SearchX : BookOpen} title={m['knowledge.empty']()} description={filtered ? m['knowledge.no_matches_hint']() : m['knowledge.empty_hint']()} actions={filtered ? undefined : importAction} />
                  </div>
                {/if}
              {/each}
            </div>
          {/if}
        </div>
        {#if document}
          <aside class="kv-detail absolute inset-y-0 right-0 z-30 w-80 max-w-[90%] overflow-auto overscroll-contain bg-[var(--app-surface)] p-4 @min-[760px]/knowledge:static @min-[760px]/knowledge:shrink-0">
            <div class="flex items-start gap-2"><h3 class="min-w-0 flex-1 pt-1 text-ui-lg leading-snug font-semibold break-words">{document.title}</h3><Button variant="ghost" size="icon-sm" aria-label={m['knowledge.close']()} onclick={() => { document = null; selectedId = null; selectionSequence++; }}><X size={14} /></Button></div>
            <p class="mt-1.5 mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-ui-sm text-[var(--app-text-muted)]"><span class="kv-chip" class:kv-chip-warn={document.status === 'missing' || document.status === 'error'}>{knowledgeLabel(document.status)}</span><span class="kv-mono">v{document.revision} · {new Date(document.indexedAt).toLocaleString()}</span></p>
            {#if document.path}<p class="mb-3 font-mono text-[11px] leading-relaxed break-all text-[var(--app-text-muted)]">{document.path}</p>{/if}
            {#if document.nodeId && onJumpToNode}<Button size="sm" variant="outline" onclick={() => onJumpToNode?.(document!.nodeId!)}><ExternalLink size={14} />{m['knowledge.open_source']()}</Button>{/if}
            {#if document.nodeId}<form class="mt-3 mb-4 flex gap-1.5" onsubmit={(event) => { event.preventDefault(); void saveTags(); }}><Input class="h-8" aria-label={m['knowledge.tags']()} placeholder={m['knowledge.tags']()} bind:value={tagDraft} /><Button type="submit" size="sm" variant="outline" class="h-8" disabled={busy}>{m['knowledge.save']()}</Button></form>{/if}
            {#if document.truncated}<p class="kv-alert kv-alert-warn mx-0"><TriangleAlert size={13} aria-hidden="true" /><span>{m['knowledge.truncated']()}</span></p>{/if}
            <DocumentExtractionNotice extraction={document.extraction} />
            <DocumentPassages passages={document.passages} />
            <h4 class="section-label mt-5 mb-1.5">{m['knowledge.backlinks']()}</h4>
            {#each selectedLinks as link}
              {@const target = link.source === selectedId ? link.target : link.source}
              <button class="kv-link" onclick={() => void select(target)}><ArrowRight size={12} aria-hidden="true" /><span class="min-w-0 break-words">{result?.items.find(item => item.id === target)?.title ?? target}</span></button>
            {:else}<p class="text-ui-sm text-[var(--app-text-muted)]">{m['knowledge.no_links']()}</p>{/each}
          </aside>
        {/if}
      </div>
      <footer class="flex shrink-0 items-center gap-2 border-t border-[var(--app-border)] px-3 py-1.5 text-ui-sm text-[var(--app-text-muted)]"><span class="min-w-0 flex-1 truncate"><span class="kv-mono">{result?.total ?? 0}</span> · {result?.truncated ? m['knowledge.truncated']() : m['knowledge.sources']()}</span><span class="flex shrink-0 items-center gap-1.5" role="status" data-testid="knowledge-live"><span class="size-1.5 rounded-full" style:background={connected && !error ? 'var(--app-success)' : 'var(--app-warning)'}></span>{error ? m['knowledge.live_error']() : loading ? m['knowledge.live_updating']() : connected ? m['knowledge.live']() : m['knowledge.live_connecting']()}</span></footer>
    {:else if tab === 'memory'}<div class="min-h-0 flex-1"><WorkspaceMemoryView {workspaceId} compact /></div>
    {:else}<div class="min-h-0 flex-1"><AgentLearningPanel {workspaceId} /></div>{/if}
  </Tabs.Root>
</section>

{#snippet importAction()}<Button size="sm" variant="outline" disabled={busy} onclick={() => fileInput.click()}><Upload size={13} />{m['knowledge.import']()}</Button>{/snippet}

<style>
  .kv {
    container: kv / inline-size;
  }

  /* Em larguras estreitas so a aba ativa mostra o rotulo; as demais ficam
     como icone e mantem o nome acessivel (o texto vira visualmente oculto). */
  .kv :global(.kv-tab) {
    flex: none;
    gap: 6px;
    height: 28px;
    padding: 0 10px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--app-text-muted);
    font-size: 12px;
    font-weight: 500;
    box-shadow: none;
    transition: color var(--duration-quick) ease-out, background-color var(--duration-quick) ease-out, box-shadow var(--duration-quick) ease-out;
  }

  .kv :global(.kv-tab:hover) {
    color: var(--app-text);
  }

  .kv :global(.kv-tab[data-state='active']) {
    background: var(--app-surface-raised);
    color: var(--app-text);
    box-shadow: var(--app-shadow-border);
  }

  .kv :global(.kv-tab svg) {
    width: 14px;
    height: 14px;
  }

  .kv :global(.kv-tab[data-state='active'] svg) {
    color: var(--app-accent);
  }

  .kv :global(.kv-tab:focus-visible) {
    outline: 2px solid var(--app-accent);
    outline-offset: 1px;
    box-shadow: none;
  }

  @container kv (max-width: 600px) {
    .kv :global(.kv-tab[data-state='inactive'] .kv-tab-label) {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
  }

  .kv-alert {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    margin: 0 12px 8px;
    padding: 7px 10px;
    border-radius: 8px;
    background: var(--app-danger-soft);
    color: var(--app-text);
    font-size: 12px;
    line-height: 1.45;
  }

  .kv-alert :global(svg) {
    flex-shrink: 0;
    margin-top: 2px;
    color: var(--app-danger);
  }

  .kv-alert.kv-alert-warn {
    margin-inline: 0;
    background: var(--app-warning-soft);
  }

  .kv-alert.kv-alert-warn :global(svg) {
    color: var(--app-warning);
  }

  .kv-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-height: 100%;
    padding: 6px;
  }

  .kv-row {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    width: 100%;
    padding: 9px 10px;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: var(--app-text);
    text-align: left;
    cursor: pointer;
    transition: background-color var(--duration-quick) ease-out, box-shadow var(--duration-quick) ease-out;
  }

  .kv-row:hover {
    background: var(--app-hover);
  }

  .kv-row[aria-pressed='true'] {
    background: var(--app-hover);
    box-shadow: inset 2px 0 0 var(--app-accent);
  }

  .kv-row:focus-visible {
    outline: 2px solid var(--app-accent);
    outline-offset: -2px;
  }

  .kv-row-icon {
    display: grid;
    place-items: center;
    flex-shrink: 0;
    width: 28px;
    height: 28px;
    border-radius: 7px;
    background: var(--app-hover);
    color: var(--app-text-soft);
    transition: color var(--duration-quick) ease-out, background-color var(--duration-quick) ease-out;
  }

  .kv-row[aria-pressed='true'] .kv-row-icon {
    background: var(--app-accent-soft);
    color: var(--app-accent);
  }

  .kv-row-main {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: 1;
    min-width: 0;
  }

  .kv-row-title {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 13px;
    font-weight: 500;
    line-height: 1.4;
  }

  .kv-row-meta {
    display: block;
    color: var(--app-text-muted);
    font-size: 11.5px;
    line-height: 1.45;
  }

  .kv-warn {
    color: var(--app-warning);
  }

  .kv-row-excerpt {
    display: -webkit-box;
    margin-top: 3px;
    overflow: hidden;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    color: var(--app-text-soft);
    font-size: 12px;
    line-height: 1.5;
    overflow-wrap: break-word;
  }

  .kv-row-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 5px;
  }

  .kv-tag,
  .kv-chip {
    display: inline-flex;
    align-items: center;
    height: 18px;
    padding: 0 6px;
    border-radius: 5px;
    background: var(--app-hover);
    color: var(--app-text-soft);
    font-size: 11px;
    white-space: nowrap;
  }

  .kv-chip {
    height: 20px;
    padding: 0 7px;
    border-radius: 999px;
    font-weight: 500;
  }

  .kv-chip-warn {
    background: var(--app-warning-soft);
    color: var(--app-warning);
  }

  .kv-mono {
    font-family: var(--font-mono);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
  }

  .kv-fill {
    display: grid;
    flex: 1;
    min-height: 220px;
    place-items: center;
  }

  .kv-loading {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    height: 26px;
    padding: 0 10px;
    border-radius: 999px;
    background: var(--app-hover);
    color: var(--app-text-soft);
    font-size: 12px;
  }

  .kv-detail {
    box-shadow: var(--app-shadow-panel);
    animation: kv-detail-in var(--duration-slow) var(--ease-smooth-out) both;
  }

  @container knowledge (min-width: 760px) {
    .kv-detail {
      box-shadow: inset 1px 0 0 var(--app-border);
    }
  }

  @keyframes kv-detail-in {
    from {
      opacity: 0;
      transform: translateX(var(--distance-base));
    }
  }

  .kv-link {
    display: flex;
    align-items: flex-start;
    gap: 7px;
    width: 100%;
    margin-top: 2px;
    padding: 6px 8px;
    border: 0;
    border-radius: 7px;
    background: transparent;
    color: var(--app-text-soft);
    font-size: 12px;
    line-height: 1.45;
    text-align: left;
    cursor: pointer;
    transition: background-color var(--duration-quick) ease-out, color var(--duration-quick) ease-out;
  }

  .kv-link :global(svg) {
    flex-shrink: 0;
    margin-top: 3px;
    color: var(--app-text-muted);
  }

  .kv-link:hover {
    background: var(--app-hover);
    color: var(--app-text);
  }

  .kv-link:focus-visible {
    outline: 2px solid var(--app-accent);
    outline-offset: -2px;
  }
</style>
