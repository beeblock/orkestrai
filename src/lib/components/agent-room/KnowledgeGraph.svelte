<script lang="ts">
  import { onMount } from 'svelte';
  import { Focus, ZoomIn, ZoomOut, Maximize, Minimize, Scan, RotateCcw, Network, LoaderCircle, Palette } from '@lucide/svelte';
  import { Button } from '$lib/components/ui/button';
  import * as ToggleGroup from '$lib/components/ui/toggle-group';
  import type { KnowledgeItem, KnowledgeLink, KnowledgeKind } from '$lib/modules/agent-room/domain/knowledge.js';
  import { knowledgeLabel } from './knowledge-labels.js';
  import type { KnowledgeGraphRenderer, GraphLabel } from './knowledge-graph-renderer.js';
  import type { GraphPosition } from './knowledge-graph-layout.js';
  import { graphColors, graphPalette } from './knowledge-graph-view.js';
  import * as m from '$lib/paraglide/messages.js';

  let { items, links, selectedId, onSelect }: { items: KnowledgeItem[]; links: KnowledgeLink[]; selectedId: string | null; onSelect: (id: string) => void } = $props();
  let root: HTMLDivElement, host: HTMLDivElement;
  let renderer = $state<KnowledgeGraphRenderer | null>(null);
  let labels = $state<GraphLabel[]>([]), hovered = $state<string | null>(null);
  let mode = $state<'2d' | '3d'>('3d'), hidden = $state<KnowledgeKind[]>([]);
  let error = $state(false), arranging = $state(true), fullscreen = $state(false);
  let groups = $state<Record<string, string>>({}), colorGroups = $state(true);
  let groupColors = $state<Record<string, string>>({});
  let worker: Worker | undefined, revision = 0, topology = '', first = true;
  let positions: Record<string, GraphPosition> = {};
  const kinds = $derived([...new Set(items.map(item => item.kind))]);
  const visibleItems = $derived(items.filter(item => !hidden.includes(item.kind)));
  const active = $derived(items.find(item => item.id === (hovered ?? selectedId)));
  const activeLinks = $derived(links.filter(link => link.source === active?.id || link.target === active?.id));
  const groupIds = $derived([...new Set(Object.values(groups))].sort());
  const colors = $derived(colorGroups ? Object.fromEntries(Object.entries(groups).map(([id, group]) => [id, groupColors[group]])) : {});

  function arrange(reset = false) {
    if (!renderer || !worker) return;
    const ids = visibleItems.map(item => item.id);
    if (reset) positions = {};
    const key = JSON.stringify([ids.toSorted(), links.map(link => [link.source, link.target]).sort()]);
    if (!reset && key === topology) { renderer.update(visibleItems, links, positions); return; }
    topology = key; arranging = true;
    worker.postMessage({ ids, links: $state.snapshot(links), previous: positions, revision: ++revision });
  }
  async function expand() {
    try {
      if (document.fullscreenElement?.contains(root)) await document.exitFullscreen();
      else await (root.closest<HTMLElement>('[data-testid="knowledge-view"]') ?? root).requestFullscreen();
    } catch { error = true; }
  }
  function keydown(event: KeyboardEvent) {
    if (event.key !== 'Escape') event.stopPropagation();
    if (event.target !== root && event.target !== host) return;
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '=', '-', '0'].includes(event.key)) {
      event.preventDefault(); event.stopPropagation();
      if (event.key === '0') renderer?.fit();
      else if (['+', '='].includes(event.key)) renderer?.zoom(1.2);
      else if (event.key === '-') renderer?.zoom(1 / 1.2);
      else renderer?.pan(event.key === 'ArrowLeft' ? -30 : event.key === 'ArrowRight' ? 30 : 0, event.key === 'ArrowUp' ? 30 : event.key === 'ArrowDown' ? -30 : 0);
    }
  }
  $effect(() => { if (renderer) { visibleItems; links; arrange(); } });
  $effect(() => renderer?.select(selectedId));
  $effect(() => renderer?.setMode(mode));
  $effect(() => renderer?.setColors(colors));
  onMount(() => {
    let alive = true;
    const changed = () => { fullscreen = Boolean(document.fullscreenElement?.contains(root)); };
    document.addEventListener('fullscreenchange', changed);
    void import('./knowledge-graph-renderer.js').then(({ KnowledgeGraphRenderer }) => {
      if (!alive) return;
      try {
        renderer = new KnowledgeGraphRenderer(host, {
          labels: value => labels = value, select: onSelect, hover: id => hovered = id,
          moved: (id, point) => { positions[id] = point; }, failed: () => error = true,
        });
        worker = new Worker(new URL('./knowledge-graph-layout.worker.ts', import.meta.url), { type: 'module' });
        worker.onmessage = (event: MessageEvent<{ revision: number; positions: Record<string, GraphPosition>; groups: Record<string, string> }>) => {
          if (!alive || event.data.revision !== revision) return;
          positions = event.data.positions; groups = event.data.groups; arranging = false;
          const nextColors = { ...groupColors };
          for (const group of Object.values(groups)) if (!nextColors[group]) nextColors[group] = graphPalette[Object.keys(nextColors).length % graphPalette.length];
          groupColors = nextColors;
          renderer?.update(visibleItems, links, positions, first); first = false;
        };
        worker.onerror = () => { arranging = false; error = true; };
        arrange();
      } catch { error = true; arranging = false; }
    }).catch(() => { if (alive) { error = true; arranging = false; } });
    return () => { alive = false; worker?.terminate(); renderer?.dispose(); document.removeEventListener('fullscreenchange', changed); };
  });
</script>

<!-- The network is a keyboard-operable graphics surface, with source buttons as its accessible alternative. -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<div bind:this={root} class="nodrag nowheel nopan relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-[var(--app-canvas)] text-[var(--app-text)] outline-none" data-testid="knowledge-graph" data-mode={mode} data-count={visibleItems.length} data-arranging={arranging} tabindex="0" role="application" aria-label={m['knowledge.graph']()} onkeydown={keydown}>
  <div class="z-10 flex shrink-0 flex-wrap items-center gap-1 border-b border-[var(--app-border)] bg-[var(--app-surface)] px-2 py-1.5">
    <ToggleGroup.Root type="single" value={mode} onValueChange={(value) => { if (value) mode = value as typeof mode; }} class="gap-0" aria-label={m['knowledge.graph_dimension']()}>
      <ToggleGroup.Item value="2d" class="h-7 px-2 text-xs data-[state=on]:bg-[var(--app-accent-soft)] data-[state=on]:text-[var(--app-accent)]">2D</ToggleGroup.Item>
      <ToggleGroup.Item value="3d" class="h-7 px-2 text-xs data-[state=on]:bg-[var(--app-accent-soft)] data-[state=on]:text-[var(--app-accent)]">3D</ToggleGroup.Item>
    </ToggleGroup.Root>
    <span class="mx-1 h-4 w-px bg-[var(--app-border)]"></span>
    <Button variant="ghost" size="icon" class="size-7" title={m['knowledge.graph_fit']()} aria-label={m['knowledge.graph_fit']()} onclick={() => renderer?.fit()}><Scan size={15} /></Button>
    <Button variant="ghost" size="icon" class="size-7" title={m['knowledge.graph_zoom_in']()} aria-label={m['knowledge.graph_zoom_in']()} onclick={() => renderer?.zoom(1.3)}><ZoomIn size={15} /></Button>
    <Button variant="ghost" size="icon" class="size-7" title={m['knowledge.graph_zoom_out']()} aria-label={m['knowledge.graph_zoom_out']()} onclick={() => renderer?.zoom(1 / 1.3)}><ZoomOut size={15} /></Button>
    <Button variant="ghost" size="icon" class="size-7" disabled={!selectedId} title={m['knowledge.graph_focus']()} aria-label={m['knowledge.graph_focus']()} onclick={() => selectedId && renderer?.focus(selectedId)}><Focus size={15} /></Button>
    <Button variant="ghost" size="icon" class="size-7" disabled={arranging} title={m['knowledge.graph_arrange']()} aria-label={m['knowledge.graph_arrange']()} onclick={() => { first = true; arrange(true); }}><RotateCcw size={14} /></Button>
    <Button variant="ghost" size="icon" class="size-7" aria-pressed={colorGroups} title={m['knowledge.graph_color_groups']()} aria-label={m['knowledge.graph_color_groups']()} onclick={() => colorGroups = !colorGroups}><Palette size={15} /></Button>
    <div class="ml-auto flex items-center gap-2">
      {#if arranging}<LoaderCircle size={13} class="animate-spin text-[var(--app-text-muted)]" aria-label={m['knowledge.loading']()} />{/if}
      <Button variant="ghost" size="icon" class="size-7" title={m['knowledge.graph_expand']()} aria-label={m['knowledge.graph_expand']()} onclick={() => void expand()}>{#if fullscreen}<Minimize size={15} />{:else}<Maximize size={15} />{/if}</Button>
    </div>
  </div>
  <div bind:this={host} class="relative min-h-0 flex-1 overflow-hidden" data-testid="knowledge-graph-stage">
    <div class="pointer-events-none absolute inset-0 overflow-hidden">
      {#each labels as label (label.id)}
        <button data-graph-label={label.id} class="pointer-events-auto absolute max-w-40 -translate-x-1/2 truncate rounded-sm px-1 text-center text-xs leading-5 text-[var(--app-text-muted)] [text-shadow:0_1px_3px_var(--app-canvas),0_-1px_3px_var(--app-canvas)] hover:bg-[var(--app-surface)] hover:text-[var(--app-text)] focus-visible:outline-2 focus-visible:outline-[var(--app-accent)]" style:left={`${label.x}px`} style:top={`${label.y}px`} style:color={label.active ? 'var(--app-text)' : undefined} title={label.title} onclick={() => onSelect(label.id)} ondblclick={() => renderer?.focus(label.id)}>{label.title}</button>
      {/each}
    </div>
    {#if hovered && active}
      <div role="tooltip" class="pointer-events-none absolute bottom-3 left-3 right-3 z-20 max-w-80 rounded-md border border-[var(--app-border)] bg-[var(--app-surface)] p-3 shadow-lg">
        <p class="break-words text-sm font-semibold">{active.title}</p>
        <p class="mt-1 text-xs text-[var(--app-text-muted)]">{knowledgeLabel(active.kind)} · {activeLinks.length} {m['knowledge.graph_connections']()}</p>
        {#if active.excerpt}<p class="mt-2 line-clamp-2 break-words text-xs leading-5">{active.excerpt}</p>{/if}
      </div>
    {/if}
    {#if error}<div role="alert" class="absolute inset-0 grid place-content-center bg-[var(--app-canvas)] p-5 text-center text-sm">{m['knowledge.graph_unavailable']()}</div>
    {:else if !visibleItems.length}<div class="pointer-events-none absolute inset-0 grid place-content-center gap-3 p-6 text-center text-sm text-[var(--app-text-muted)]"><Network size={28} class="mx-auto" />{m['knowledge.empty']()}</div>{/if}
    <div class="sr-only">{#each visibleItems as item (item.id)}<button onclick={() => { onSelect(item.id); renderer?.focus(item.id); }}>{item.title}</button>{/each}</div>
  </div>
  <div class="z-10 flex max-h-20 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 overflow-auto border-t border-[var(--app-border)] bg-[var(--app-surface)] px-3 py-2" aria-label={m['knowledge.graph_legend']()}>
    {#if colorGroups}
      {#each groupIds as group}<button class="flex min-w-0 max-w-44 items-center gap-1.5 rounded-sm text-xs text-[var(--app-text-muted)] hover:text-[var(--app-text)]" title={items.find(item => item.id === group)?.title} onclick={() => { onSelect(group); renderer?.focus(group); }}><span class="size-2 shrink-0 rounded-full" style:background={groupColors[group]}></span><span class="truncate">{items.find(item => item.id === group)?.title}</span><span class="tabular-nums opacity-70">{Object.values(groups).filter(id => id === group).length}</span></button>{/each}
    {:else}
    {#each kinds as kind}<button class="flex items-center gap-1.5 rounded-sm text-xs text-[var(--app-text-muted)] hover:text-[var(--app-text)]" style:opacity={hidden.includes(kind) ? 0.4 : 1} aria-pressed={!hidden.includes(kind)} onclick={() => hidden = hidden.includes(kind) ? hidden.filter(value => value !== kind) : [...hidden, kind]}><span class="size-2 rounded-full" style:background={graphColors[kind]}></span>{knowledgeLabel(kind)}<span class="tabular-nums opacity-70">{items.filter(item => item.kind === kind).length}</span></button>{/each}
    {/if}
  </div>
</div>
