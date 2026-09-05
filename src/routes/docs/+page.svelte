<script lang="ts">
  import { onMount, tick } from 'svelte';
  import type { Component } from 'svelte';
  import {
    Activity, ArrowLeft, BookOpen, Bot, Cable, Check, ChevronDown, Copy, FolderPlus, Gauge, GitBranch, GitPullRequestArrow,
    History, Layers, Link2, MessageSquare, Palette, PanelLeftOpen, Paperclip, PlayCircle, RadioTower, Repeat,
    Rocket, Scale, ScanSearch, Search, Smartphone, SquareKanban, SquareTerminal, StickyNote, Users, Workflow,
  } from '@lucide/svelte';
  import { Button } from '$lib/components/ui/button';
  import * as m from '$lib/paraglide/messages.js';
  import { localeState } from '$lib/i18n/locale.svelte.js';
  import { DOCS_PT } from '$lib/i18n/docs/pt-BR.js';
  import { DOCS_EN } from '$lib/i18n/docs/en.js';
  import { DOCS_ES } from '$lib/i18n/docs/es.js';
  import { docsSectionSearchText } from '$lib/i18n/docs/search.js';
  import { tourIdForUseCase } from '$lib/components/agent-room/tours/use-case-links.js';

  // Conteudo longo (topicos, casos de uso, quickstart, changelog) vive em
  // catalogs TS por locale (src/lib/i18n/docs/) — mesmo padrao dos tours.
  const DOCS_CATALOGS = { 'pt-BR': DOCS_PT, en: DOCS_EN, es: DOCS_ES };
  const catalog = $derived(DOCS_CATALOGS[localeState.current] ?? DOCS_PT);

  // Icones ficam na pagina (componentes nao sao serializaveis no catalogo).
  const SECTION_ICONS: Record<string, Component> = {
    workspaces: Layers,
    agentes: SquareTerminal,
    'provider-center': Bot,
    roles: Users,
    times: Cable,
    council: Scale,
    'control-center': Activity,
    'review-center': GitPullRequestArrow,
    'portal-design-mode': ScanSearch,
    'mobile-device': Smartphone,
    'api-client-scripts': SquareTerminal,
    notas: StickyNote,
    tarefas: SquareKanban,
    imagens: StickyNote,
    presets: Layers,
    fluxos: Workflow,
    'sem-medo': BookOpen,
    conexoes: Link2,
    andares: GitBranch,
    rotinas: Repeat,
    portal: Workflow,
    mcp: Cable,
    cli: MessageSquare,
    'usage-routing': Gauge,
    appearance: Palette,
    atalhos: BookOpen,
  };

  const USECASE_ICONS: Record<string, Component> = {
    'leader-team': Users,
    'watch-24-7': Repeat,
    'parallel-features': GitBranch,
    'council-decision': Scale,
    'visual-qa': Workflow,
    'mobile-qa': Smartphone,
    'research-summary': Search,
    'inbox-files': FolderPlus,
    'cross-review': Cable,
    'deploy-sentinel': Rocket,
    'framework-preset': Layers,
    'approval-pipeline': Workflow,
    'chained-flows': Workflow,
    'design-figma': Palette,
    'design-precision': Palette,
    'ui-exploration': Palette,
    'mcp-tools': Cable,
    'quota-aware-delegation': Gauge,
    'focused-workspace-view': PanelLeftOpen,
    'edit-and-preview-files': SquareTerminal,
    'share-reference-material': Paperclip,
    'universal-workspace-search': Search,
    'review-delivery': GitPullRequestArrow,
    'portal-design-feedback': ScanSearch,
    'remote-collaboration': RadioTower,
    'custom-app-theme': Palette,
  };

  const quickstart = $derived(catalog.quickstart);
  const sections = $derived(catalog.sections.map((section) => ({ ...section, icon: SECTION_ICONS[section.id] ?? BookOpen })));
  const useCases = $derived(catalog.useCases.map((useCase) => ({
    ...useCase,
    icon: USECASE_ICONS[useCase.id] ?? Cable,
    tourId: tourIdForUseCase(useCase.id),
  })));
  const changelog = $derived(catalog.changelog);

  onMount(() => {
    // Atalho global (Cmd/Ctrl+K de qualquer tela): abre a paleta ja focada.
    if (new URLSearchParams(location.search).has('search')) {
      history.replaceState(null, '', '/docs');
      openPalette();
    }
  });

  function rewatchOnboarding() {
    // Forca a apresentacao mesmo com workspaces existentes.
    location.href = '/canvas?onboarding=1';
  }

  function startUseCaseTour(tourId: string) {
    const params = new URLSearchParams({ tour: tourId });
    const workspaceId = localStorage.getItem('orkestrai.activeWorkspaceId');
    if (workspaceId) params.set('workspace', workspaceId);
    else params.set('onboarding', '1');
    location.href = `/canvas?${params}`;
  }

  let query = $state('');
  let copiedSnippetId = $state<string | null>(null);

  const filtered = $derived.by(() => {
    const term = query.trim().toLowerCase();
    if (!term) return sections;
    return sections.filter((section) => `${section.title} ${docsSectionSearchText(section)}`.toLowerCase().includes(term));
  });

  // -- Paleta de busca (Cmd/Ctrl+K): cobre topicos, casos de uso e changelog --
  type PaletteItem = { kind: 'topico' | 'caso'; title: string; body: string; href: string };
  let paletteOpen = $state(false);
  let paletteSelected = $state(0);
  let paletteInput = $state<HTMLInputElement | null>(null);

  const paletteItems = $derived.by((): PaletteItem[] => {
    const term = query.trim().toLowerCase();
    const items: PaletteItem[] = [
      { kind: 'topico', title: m['docs.quickstart_title'](), body: quickstart.join(' '), href: '#comece' },
      ...useCases.map((useCase) => ({ kind: 'caso' as const, title: useCase.title, body: useCase.body, href: `#usecase-${useCase.id}` })),
      ...sections.map((section) => ({ kind: 'topico' as const, title: section.title, body: docsSectionSearchText(section), href: `#${section.id}` })),
      { kind: 'topico', title: m['docs.changelog_title'](), body: changelog.map((entry) => `${entry.date} ${entry.items.join(' ')}`).join(' '), href: '#changelog' },
    ];
    if (!term) return items;
    return items.filter((item) => `${item.title} ${item.body}`.toLowerCase().includes(term));
  });

  $effect(() => {
    void query;
    paletteSelected = 0;
  });

  function openPalette() {
    paletteOpen = true;
    paletteSelected = 0;
    void tick().then(() => paletteInput?.focus());
  }

  function handlePaletteKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      paletteOpen = false;
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      paletteSelected = Math.min(paletteSelected + 1, paletteItems.length - 1);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      paletteSelected = Math.max(paletteSelected - 1, 0);
      return;
    }
    if (event.key === 'Enter' && paletteItems[paletteSelected]) {
      event.preventDefault();
      goToItem(paletteItems[paletteSelected]);
    }
  }

  function goToItem(item: PaletteItem) {
    paletteOpen = false;
    location.hash = item.href;
    document.querySelector(item.href)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function copySnippet(id: string, code: string) {
    try {
      await navigator.clipboard.writeText(code);
      copiedSnippetId = id;
      window.setTimeout(() => {
        if (copiedSnippetId === id) copiedSnippetId = null;
      }, 1_800);
    } catch {
      copiedSnippetId = null;
    }
  }

</script>

<svelte:head>
  <title>{m['docs.page_title']()}</title>
</svelte:head>


<main class="docs-page">
  <header class="sticky top-0 z-20 flex min-h-[68px] items-center gap-2.5 border-b border-[var(--line)] bg-[var(--page)] py-3">
    <Button variant="ghost" size="sm" href="/canvas">
      <ArrowLeft size={15} aria-hidden="true" />
      {m['docs.back_canvas']()}
    </Button>
    <h1 class="m-0 font-['Sora_Variable'] text-[21px] font-[650] text-balance">{m['docs.heading']()}</h1>
    <span class="flex-1"></span>
    <Button variant="outline" size="sm" onclick={rewatchOnboarding}>
      <PlayCircle size={15} aria-hidden="true" />
      {m['docs.rewatch']()}
    </Button>
    <span class="h-full w-[60px] shrink-0" data-dictation-dock aria-hidden="true"></span>
  </header>

  <div class="docs-layout">
    <aside class="docs-nav">
      <label class="docs-search">
        <Search size={14} aria-hidden="true" />
        <input bind:value={query} placeholder={m['ph.filter_topics']()} aria-label={m['ph.filter_topics']()} autocomplete="off" spellcheck="false" />
        <kbd class="search-kbd">⌘K</kbd>
      </label>
      <nav aria-label={m['docs.nav_aria']()}>
        <a href="#comece" class="nav-link">{m['docs.quickstart_title']()}</a>
        <a href="#casos-de-uso" class="nav-link">{m['docs.usecases_title']()}</a>
        {#each filtered as section (section.id)}
          <a href={`#${section.id}`} class="nav-link">{section.title}</a>
        {/each}
        <a href="#changelog" class="nav-link">{m['docs.changelog_title']()}</a>
        {#if !filtered.length}
          <span class="nav-empty">{m['docs.nav_empty']({ query })}</span>
        {/if}
      </nav>
    </aside>

    <div class="docs-content">
      <article class="doc-card quickstart" id="comece">
        <header>
          <span class="icon-chip"><Rocket size={15} aria-hidden="true" /></span>
          <h2>{m['docs.quickstart_title']()}</h2>
        </header>
        <ol>
          {#each quickstart as step, index (index)}
            <li><span class="step-num">{index + 1}</span><span>{step}</span></li>
          {/each}
        </ol>
      </article>

      <section class="usecases" id="casos-de-uso">
        <h2 class="usecases-title">{m['docs.usecases_title']()}</h2>
        <div class="usecases-grid">
          {#each useCases as useCase (useCase.id)}
            <article class="doc-card usecase-card" id={`usecase-${useCase.id}`}>
              <header>
                <span class="icon-chip"><useCase.icon size={15} aria-hidden="true" /></span>
                <h3>{useCase.title}</h3>
              </header>
              <p>{useCase.body}</p>
              <footer>
                <div class="usecase-tags">
                  {#each useCase.tags as tag (tag)}
                    <span class="usecase-tag">{tag}</span>
                  {/each}
                </div>
                {#if useCase.tourId}
                  <Button variant="outline" size="sm" onclick={() => useCase.tourId && startUseCaseTour(useCase.tourId)}>
                    <PlayCircle size={14} aria-hidden="true" />
                    {m['docs.start_tour']()}
                  </Button>
                {/if}
              </footer>
            </article>
          {/each}
        </div>
      </section>

      {#each filtered as section (section.id)}
        <article class="doc-card" id={section.id}>
          <header>
            <span class="icon-chip"><section.icon size={15} aria-hidden="true" /></span>
            <h2>{section.title}</h2>
            <a href={`#${section.id}`} class="anchor-link" aria-label={m['docs.anchor_aria']({ title: section.title })}>#</a>
          </header>
          <p>{section.body}</p>
          {#if section.bullets?.length}
            <ul class="mt-5 grid gap-2.5 border-t border-[var(--line)] pt-5">
              {#each section.bullets as item (item)}
                <li class="grid grid-cols-[18px_minmax(0,1fr)] gap-2.5 text-[12.5px] leading-5 text-[var(--copy-soft)]">
                  <Check size={14} class="mt-0.5 text-[var(--cyan)]" aria-hidden="true" />
                  <span>{item}</span>
                </li>
              {/each}
            </ul>
          {/if}
          {#if section.examples?.length}
            <div class="mt-6 border-t border-[var(--line)]">
              {#each section.examples as example (example.id)}
                <section class="border-t border-[var(--line)] py-6 first:border-t-0">
                  <h3 class="m-0 font-['Sora_Variable'] text-[14px] font-semibold text-[var(--copy)]">{example.title}</h3>
                  <p class="mt-1.5 text-[12.5px] leading-5 text-[var(--copy-muted)]">{example.description}</p>
                  <div class="mt-4 grid gap-4">
                    {#each example.snippets as snippet (snippet.id)}
                      {@const snippetId = `${section.id}:${example.id}:${snippet.id}`}
                      <div class="min-w-0 overflow-hidden rounded-md border border-[var(--line)] bg-[#0d0d17]">
                        <div class="flex min-h-9 items-center justify-between gap-3 border-b border-white/10 px-3">
                          <span class="min-w-0 truncate font-mono text-[10.5px] font-semibold text-[#aeadbd]">{snippet.title}</span>
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            class="text-[#aeadbd] hover:bg-white/10 hover:text-white"
                            title={copiedSnippetId === snippetId ? m['docs.example_copied']() : m['docs.copy_example']()}
                            aria-label={copiedSnippetId === snippetId ? m['docs.example_copied']() : m['docs.copy_example']()}
                            onclick={() => copySnippet(snippetId, snippet.code)}
                          >
                            {#if copiedSnippetId === snippetId}<Check size={13} aria-hidden="true" />{:else}<Copy size={13} aria-hidden="true" />{/if}
                          </Button>
                        </div>
                        <pre class="m-0 overflow-x-auto p-4 font-mono text-[11.5px] leading-5 text-[#e3e2ec]"><code translate="no">{snippet.code}</code></pre>
                      </div>
                    {/each}
                  </div>
                </section>
              {/each}
            </div>
          {/if}
        </article>
      {/each}

      <article class="doc-card" id="changelog">
        <header>
          <span class="icon-chip"><History size={15} aria-hidden="true" /></span>
          <h2>{m['docs.changelog_title']()}</h2>
          <a href="#changelog" class="anchor-link" aria-label={m['docs.anchor_aria']({ title: m['docs.changelog_title']() })}>#</a>
        </header>
        <div class="grid">
          {#each changelog as entry (entry.date)}
            <details class="group border-t border-[var(--line)] first:border-t-0">
              <summary class="flex min-h-12 cursor-pointer list-none items-center gap-3 py-3 outline-none transition-colors hover:text-[var(--app-accent)] focus-visible:ring-2 focus-visible:ring-[var(--app-accent)]/45 [&::-webkit-details-marker]:hidden">
                <span class="min-w-0 flex-1 font-['Sora_Variable'] text-xs font-semibold text-[var(--cyan)] tabular-nums">{entry.date}</span>
                <span class="text-[10.5px] text-[var(--copy-muted)] tabular-nums">
                  {m['docs.changelog_change_count']({ count: String(entry.items.length) })}
                </span>
                <ChevronDown size={14} class="shrink-0 text-[var(--copy-muted)] transition-transform duration-150 group-open:rotate-180" aria-hidden="true" />
              </summary>
              <ol class="grid list-none p-0 pb-2">
                {#each entry.items as item, index (index)}
                  <li class="grid grid-cols-[30px_minmax(0,1fr)] gap-3 border-t border-[var(--line)] py-3.5">
                    <span class="pt-0.5 font-mono text-[10px] text-[var(--copy-muted)] tabular-nums">{String(index + 1).padStart(2, '0')}</span>
                    <p class="m-0 text-[12.5px] leading-5 text-pretty text-[var(--copy-soft)]">{item}</p>
                  </li>
                {/each}
              </ol>
            </details>
          {/each}
        </div>
      </article>
    </div>
  </div>

  {#if paletteOpen}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="palette-overlay" onclick={() => (paletteOpen = false)} onkeydown={handlePaletteKeydown}>
      <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
      <div
        class="palette-card"
        onclick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={m['docs.palette_aria']()}
        tabindex="-1"
      >
        <label class="palette-input-row">
          <Search size={15} aria-hidden="true" />
          <input
            bind:this={paletteInput}
            bind:value={query}
            placeholder={m['ph.search_docs']()}
            aria-label={m['docs.palette_aria']()}
            autocomplete="off"
            spellcheck="false"
            onkeydown={handlePaletteKeydown}
          />
          <kbd class="search-kbd">esc</kbd>
        </label>
        <ul class="palette-list" role="listbox">
          {#each paletteItems as item, index (item.href + item.title)}
            <li>
              <button
                class="palette-item"
                class:selected={index === paletteSelected}
                role="option"
                aria-selected={index === paletteSelected}
                onclick={() => goToItem(item)}
                onmousemove={() => (paletteSelected = index)}
              >
                <span class="palette-kind">{item.kind === 'caso' ? m['docs.kind_usecase']() : m['docs.kind_topic']()}</span>
                <span class="palette-title">{item.title}</span>
              </button>
            </li>
          {:else}
            <li class="palette-empty">{m['docs.palette_empty']({ query: query.trim() })}</li>
          {/each}
        </ul>
        <p class="palette-hint">{m['docs.palette_hint']()}</p>
      </div>
    </div>
  {/if}
</main>

<style>
  .docs-page {
    min-height: 100vh;
    background: var(--page);
    color: var(--copy);
    padding: 24px 24px 80px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    align-items: center;
    scroll-behavior: smooth;
  }

  .docs-page > :not(.palette-overlay) {
    width: min(1240px, 100%);
  }

  .docs-layout {
    display: grid;
    grid-template-columns: 240px minmax(0, 1fr);
    gap: 40px;
    align-items: start;
  }

  /* ---- Navegacao lateral ---------------------------------------------- */
  .docs-nav {
    position: sticky;
    top: 84px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    max-height: calc(100vh - 104px);
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  .docs-search {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 10px;
    border-radius: 8px;
    border: 1px solid var(--line);
    background: var(--surface);
    color: var(--copy-muted);
    transition: border-color 140ms ease;
  }

  .docs-search:focus-within {
    border-color: var(--violet);
  }

  .docs-search input {
    flex: 1;
    min-width: 0;
    border: none;
    outline: none;
    background: transparent;
    color: var(--copy);
    font-size: 12.5px;
  }

  .docs-search input:focus-visible {
    outline: none;
  }

  .docs-nav nav {
    display: flex;
    flex-direction: column;
    gap: 1px;
    border-left: 1px solid var(--line);
  }

  .nav-link {
    display: block;
    min-height: 32px;
    margin-left: -1px;
    padding: 6px 11px;
    border-left: 2px solid transparent;
    border-radius: 0 6px 6px 0;
    color: var(--copy-soft);
    font-size: 12.5px;
    text-decoration: none;
    line-height: 1.35;
    transition: color 120ms ease, background 120ms ease;
  }

  .nav-link:hover {
    border-left-color: var(--app-accent);
    color: var(--copy);
    background: var(--surface-raised);
  }

  .nav-link:focus-visible {
    outline: 2px solid var(--violet);
    outline-offset: 1px;
  }

  .nav-empty {
    padding: 6px 10px;
    font-size: 12px;
    color: var(--copy-muted);
  }

  /* ---- Conteudo -------------------------------------------------------- */
  .docs-content {
    display: flex;
    flex-direction: column;
    gap: 14px;
    min-width: 0;
  }

  .doc-card {
    border: 1px solid var(--line);
    border-radius: 8px;
    background: color-mix(in srgb, var(--surface) 76%, transparent);
    padding: 20px 22px;
    scroll-margin-top: 20px;
    transition: border-color 160ms ease;
  }

  .doc-card:target {
    border-color: var(--violet);
  }

  .doc-card header {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 10px;
  }

  .icon-chip {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: 8px;
    border: 1px solid var(--line);
    background: var(--surface-raised);
    color: var(--app-accent);
    flex-shrink: 0;
  }

  .doc-card h2 {
    flex: 1;
    font-family: 'Sora Variable', 'Sora', 'Inter Variable', 'Inter', sans-serif;
    font-size: 14.5px;
    font-weight: 600;
    letter-spacing: 0;
    margin: 0;
    color: var(--copy);
    text-wrap: balance;
  }

  .anchor-link {
    color: var(--app-text-muted);
    font-size: 14px;
    font-weight: 600;
    text-decoration: none;
    padding: 2px 6px;
    border-radius: 6px;
    transition: color 120ms ease, background 120ms ease;
  }

  .anchor-link:hover {
    color: var(--cyan);
    background: var(--violet-soft);
  }

  .anchor-link:focus-visible {
    outline: 2px solid var(--violet);
    outline-offset: 1px;
  }

  .doc-card p {
    margin: 0;
    font-size: 13px;
    line-height: 1.7;
    color: var(--copy-soft);
    text-wrap: pretty;
    overflow-wrap: break-word;
  }

  /* ---- Quickstart ------------------------------------------------------ */
  .quickstart {
    border-color: color-mix(in srgb, var(--app-accent) 42%, var(--line));
    background: var(--surface-subtle);
  }

  .quickstart ol {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 9px;
  }

  /* ---- Casos de uso --------------------------------------------------- */
  .usecases {
    display: flex;
    flex-direction: column;
    gap: 12px;
    scroll-margin-top: 20px;
  }

  .usecases-title {
    font-family: 'Sora Variable', 'Sora', 'Inter Variable', 'Inter', sans-serif;
    font-size: 15px;
    font-weight: 600;
    margin: 8px 2px 0;
    color: var(--copy);
  }

  .usecases-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    gap: 12px;
  }

  .usecase-card h3 {
    flex: 1;
    font-family: 'Sora Variable', 'Sora', 'Inter Variable', 'Inter', sans-serif;
    font-size: 13.5px;
    font-weight: 600;
    margin: 0;
    color: var(--copy);
    text-wrap: balance;
  }

  .usecase-card p {
    margin: 0;
    font-size: 12.5px;
    line-height: 1.65;
    color: var(--copy-soft);
    text-wrap: pretty;
  }

  .usecase-card footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    margin-top: 10px;
  }

  .usecase-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
    min-width: 0;
  }

  .usecase-tag {
    font-size: 10px;
    font-weight: 500;
    color: var(--cyan);
    background: color-mix(in srgb, var(--cyan) 12%, transparent);
    border-radius: 7px;
    padding: 2px 8px;
    white-space: nowrap;
  }

  .quickstart li {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    font-size: 13px;
    line-height: 1.6;
    color: var(--copy-soft);
    text-wrap: pretty;
  }

  .step-num {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    margin-top: 1px;
    border-radius: 50%;
    background: var(--violet-soft);
    color: var(--violet);
    font-size: 11px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }

  @media (max-width: 900px) {
    .docs-layout {
      grid-template-columns: 1fr;
    }

    .docs-nav {
      position: static;
      max-height: none;
    }
  }

  /* ---- Paleta de busca (Cmd/Ctrl+K) --------------------------------------- */
  .search-kbd {
    flex-shrink: 0;
    font-size: 10px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    color: var(--copy-muted);
    background: var(--surface-raised);
    border: 1px solid var(--line-strong);
    border-radius: 5px;
    padding: 1px 5px;
  }

  .palette-overlay {
    position: fixed;
    inset: 0;
    width: 100vw;
    min-height: 100dvh;
    box-sizing: border-box;
    z-index: 70;
    background: color-mix(in srgb, var(--app-page) 78%, transparent);
    backdrop-filter: blur(3px);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
  }

  .palette-card {
    width: min(560px, calc(100vw - 40px));
    max-height: calc(100dvh - 40px);
    background: var(--surface-raised);
    border: 1px solid var(--line-strong);
    border-radius: 8px;
    box-shadow: 0 24px 64px color-mix(in srgb, var(--app-text) 18%, transparent);
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .palette-input-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 14px;
    border-bottom: 1px solid var(--app-border);
    color: var(--copy-muted);
  }

  .palette-input-row input {
    flex: 1;
    min-width: 0;
    border: none;
    outline: none;
    background: transparent;
    color: var(--copy);
    font-size: 14px;
  }

  .palette-list {
    list-style: none;
    margin: 0;
    padding: 6px;
    min-height: 0;
    max-height: 46vh;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .palette-item {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    text-align: left;
    padding: 8px 10px;
    border: none;
    border-radius: 8px;
    background: transparent;
    cursor: pointer;
  }

  .palette-item.selected {
    background: var(--violet-soft);
  }

  .palette-kind {
    flex-shrink: 0;
    font-size: 9.5px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--cyan);
    background: color-mix(in srgb, var(--cyan) 12%, transparent);
    border-radius: 6px;
    padding: 2px 7px;
  }

  .palette-title {
    font-size: 13px;
    color: var(--copy);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .palette-empty {
    padding: 14px 12px;
    font-size: 12px;
    color: var(--copy-muted);
  }

  .palette-hint {
    margin: 0;
    padding: 8px 14px;
    border-top: 1px solid var(--app-border);
    font-size: 10.5px;
    color: var(--copy-muted);
  }

  @media (prefers-reduced-motion: reduce) {
    .doc-card,
    .nav-link,
    .anchor-link,
    .docs-search {
      transition: none;
    }
  }
</style>
