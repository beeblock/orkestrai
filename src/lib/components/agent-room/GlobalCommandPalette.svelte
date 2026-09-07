<script lang="ts">
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { goto } from '$app/navigation';
  import { createVirtualizer } from '@tanstack/svelte-virtual';
  import {
    Blocks,
    Activity,
    BellRing,
    BookOpen,
    BookMarked,
    Bot,
    File,
    Network,
    PanelBottomOpen,
    PanelRightOpen,
    Search,
    MessageSquareMore,
    Sparkles,
    SquareKanban,
    SquareTerminal,
    Star,
    StickyNote,
    UserRoundCog,
    Workflow,
  } from '@lucide/svelte';
  import * as Command from '$lib/components/ui/command';
  import * as Tooltip from '$lib/components/ui/tooltip';
  import { Button } from '$lib/components/ui/button';
  import type {
    WorkspaceSearchResult,
    WorkspaceSearchResultKind,
  } from '$lib/modules/agent-room/domain/types.js';
  import {
    WORKBENCH_OPEN_REQUEST,
    type WorkbenchOpenRequestDetail,
  } from './workbench-open.js';
  import { workbenchControlCenterItemId } from './workbench-control-center.js';
  import { workbenchReviewCenterItemId } from './workbench-review-center.js';
  import { workbenchWorkstreamsItemId } from './workbench-workstreams.js';
  import { workbenchMemoryItemId } from './workbench-memory.js';
  import { workbenchAnnotationsItemId } from './workbench-annotations.js';
  import { workbenchHuddlesItemId } from './workbench-huddles.js';
  import { workbenchAutomationsItemId } from './workbench-automations.js';
  import * as m from '$lib/paraglide/messages.js';
  import { localeState } from '$lib/i18n/locale.svelte.js';
  import { DOCS_PT } from '$lib/i18n/docs/pt-BR.js';
  import { DOCS_EN } from '$lib/i18n/docs/en.js';
  import { DOCS_ES } from '$lib/i18n/docs/es.js';
  import { searchDocsCatalog } from '$lib/i18n/docs/search.js';

  type PaletteKind = WorkspaceSearchResultKind | 'documentation' | 'command';
  type PaletteItem = Omit<WorkspaceSearchResult, 'kind'> & { kind: PaletteKind };

  const RECENTS_KEY = 'orkestrai.globalSearch.recents.v1';
  const FAVORITES_KEY = 'orkestrai.globalSearch.favorites.v1';
  const MAX_RECENTS = 8;
  const GROUP_ORDER: Exclude<PaletteKind, 'command'>[] = [
    'documentation',
    'workspace',
    'agent',
    'task',
    'note',
    'artifact',
    'role',
    'skill',
    'automation',
    'attention',
    'activity',
    'message',
    'memory',
    'huddle',
    'file',
  ];

  let open = $state(false);
  let query = $state('');
  const DOCS_CATALOGS = { 'pt-BR': DOCS_PT, en: DOCS_EN, es: DOCS_ES };
  const docsCatalog = $derived(DOCS_CATALOGS[localeState.current] ?? DOCS_EN);

  let results = $state<PaletteItem[]>([]);
  let recents = $state<PaletteItem[]>([]);
  let favorites = $state<PaletteItem[]>([]);
  let selectedId = $state('');
  let loading = $state(false);
  let listElement = $state<HTMLElement | null>(null);
  let commandWorkspaceId = $state('');

  function activeWorkspaceId(): string | null {
    return typeof localStorage === 'undefined' ? null : localStorage.getItem('orkestrai.activeWorkspaceId');
  }

  const commands = $derived.by<PaletteItem[]>(() => {
    const workspaceId = commandWorkspaceId;
    const command = (id: string, title: string, route: string): PaletteItem => ({
      id: `command:${id}`,
      kind: 'command',
      title,
      subtitle: 'Orkestrai',
      preview: null,
      workspaceId,
      workspaceName: '',
      nodeId: null,
      taskId: null,
      path: null,
      route,
      score: 0,
    });
    const workspaceCommands = workspaceId ? [
      command('council', m['global_search.command_council'](), `/canvas?workspace=${workspaceId}&council=1`),
      command('control-center', m['global_search.command_control_center'](), `/terminal?workspace=${workspaceId}&node=${encodeURIComponent(workbenchControlCenterItemId(workspaceId))}`),
      command('workstreams', m['global_search.command_workstreams'](), `/terminal?workspace=${workspaceId}&node=${encodeURIComponent(workbenchWorkstreamsItemId(workspaceId))}`),
      command('memory', m['global_search.command_memory'](), `/terminal?workspace=${workspaceId}&node=${encodeURIComponent(workbenchMemoryItemId(workspaceId))}`),
      command('annotations', m['global_search.command_annotations'](), `/terminal?workspace=${workspaceId}&node=${encodeURIComponent(workbenchAnnotationsItemId(workspaceId))}`),
      command('huddles', m['global_search.command_huddles'](), `/terminal?workspace=${workspaceId}&node=${encodeURIComponent(workbenchHuddlesItemId(workspaceId))}`),
      command('review-center', m['global_search.command_review_center'](), `/terminal?workspace=${workspaceId}&node=${encodeURIComponent(workbenchReviewCenterItemId(workspaceId))}`),
      command('automations', m['global_search.command_automations'](), `/terminal?workspace=${workspaceId}&node=${encodeURIComponent(workbenchAutomationsItemId(workspaceId))}`),
    ] : [];
    return [
      command('canvas', m['global_search.command_canvas'](), workspaceId ? `/canvas?workspace=${workspaceId}` : '/canvas'),
      command('workbench', m['global_search.command_workbench'](), workspaceId ? `/terminal?workspace=${workspaceId}` : '/terminal'),
      command('attention', m['global_search.command_attention'](), '#attention'),
      ...workspaceCommands,
      command('settings', m['global_search.command_settings'](), '/settings'),
      command('providers', m['global_search.command_providers'](), '/providers'),
      command('docs', m['global_search.command_docs'](), '/docs'),
      command('skills', m['global_search.command_skills'](), workspaceId ? `/skills?workspace=${workspaceId}` : '/skills'),
    ];
  });

  const idleItems = $derived.by<PaletteItem[]>(() => {
    const seen = new Set<string>();
    return [...favorites, ...recents, ...commands].filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });
  });
  const displayItems = $derived<PaletteItem[]>(query.trim() ? results : idleItems);
  const selectedItem = $derived(displayItems.find((item) => item.id === selectedId) ?? displayItems[0] ?? null);
  const virtualizer = createVirtualizer<HTMLElement, HTMLElement>({
    count: 0,
    getScrollElement: () => listElement,
    estimateSize: () => 42,
    overscan: 8,
  });
  const virtualRows = $derived($virtualizer.getVirtualItems());

  function documentationResults(term: string): PaletteItem[] {
    return searchDocsCatalog(docsCatalog, term, {
      quickstart: m['docs.quickstart_title'](),
      changelog: m['docs.changelog_title'](),
    }).map((entry) => ({
      id: `documentation:${localeState.current}:${entry.id}`,
      kind: 'documentation',
      title: entry.title,
      subtitle: m['global_search.kind_documentation'](),
      preview: entry.preview,
      workspaceId: '',
      workspaceName: '',
      nodeId: null,
      taskId: null,
      path: null,
      route: `/docs#${entry.hash}`,
      score: entry.score,
    }));
  }

  $effect(() => {
    get(virtualizer).setOptions({
      count: displayItems.length,
      getScrollElement: () => listElement,
      estimateSize: () => 42,
      overscan: 8,
    });
  });

  $effect(() => {
    if (!open) return;
    const term = query.trim();
    if (!term) {
      results = [];
      loading = false;
      selectedId = idleItems[0]?.id ?? '';
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      loading = true;
      const documentation = documentationResults(term);
      results = documentation;
      selectedId = documentation[0]?.id ?? '';
      const params = new URLSearchParams({ q: term, includeFiles: 'true', limit: '80' });
      const workspaceId = activeWorkspaceId();
      if (workspaceId) params.set('workspaceId', workspaceId);
      void fetch(`/api/agent-room/search?${params}`, { signal: controller.signal })
        .then((response) => response.json())
        .then((payload) => {
          if (controller.signal.aborted) return;
          results = [...documentation, ...(payload.data ?? [])]
            .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
            .slice(0, 80);
          selectedId = results[0]?.id ?? '';
        })
        .catch(() => {
          if (!controller.signal.aborted) results = documentation;
        })
        .finally(() => {
          if (!controller.signal.aborted) loading = false;
        });
    }, 120);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  });

  function parseStored(key: string): PaletteItem[] {
    try {
      const parsed = JSON.parse(localStorage.getItem(key) ?? '[]');
      return Array.isArray(parsed) ? parsed.filter((item) => item?.id && item?.title && item?.route) : [];
    } catch {
      return [];
    }
  }

  function saveStored(key: string, items: PaletteItem[]): void {
    localStorage.setItem(key, JSON.stringify(items));
  }

  function kindLabel(kind: PaletteKind): string {
    const labels: Record<PaletteKind, () => string> = {
      workspace: m['global_search.kind_workspace'],
      agent: m['global_search.kind_agent'],
      task: m['global_search.kind_task'],
      note: m['global_search.kind_note'],
      artifact: m['global_search.kind_artifact'],
      role: m['global_search.kind_role'],
      skill: m['global_search.kind_skill'],
      automation: m['global_search.kind_automation'],
      activity: m['global_search.kind_activity'],
      message: m['global_search.kind_message'],
      attention: m['global_search.kind_attention'],
      memory: m['global_search.kind_memory'],
      huddle: m['global_search.kind_huddle'],
      file: m['global_search.kind_file'],
      documentation: m['global_search.kind_documentation'],
      command: m['global_search.kind_command'],
    };
    return labels[kind]();
  }

  function remember(item: PaletteItem): void {
    recents = [item, ...recents.filter((candidate) => candidate.id !== item.id)].slice(0, MAX_RECENTS);
    saveStored(RECENTS_KEY, recents);
  }

  function toggleFavorite(item: PaletteItem): void {
    favorites = favorites.some((candidate) => candidate.id === item.id)
      ? favorites.filter((candidate) => candidate.id !== item.id)
      : [item, ...favorites];
    saveStored(FAVORITES_KEY, favorites);
  }

  function isFavorite(item: PaletteItem): boolean {
    return favorites.some((candidate) => candidate.id === item.id);
  }

  function routeWithSplit(item: PaletteItem, direction: 'horizontal' | 'vertical'): string {
    const params = new URLSearchParams({
      workspace: item.workspaceId,
      node: item.nodeId ?? '',
      split: direction,
    });
    return `/terminal?${params}`;
  }

  async function openItem(item: PaletteItem, direction: 'horizontal' | 'vertical' | null = null): Promise<void> {
    remember(item);
    open = false;
    query = '';

    if (item.id === 'command:council' && (location.pathname === '/canvas' || location.pathname === '/terminal')) {
      window.dispatchEvent(new CustomEvent('orkestrai:open-council', {
        detail: { workspaceId: item.workspaceId },
      }));
      return;
    }
    if (item.id === 'command:attention') {
      window.dispatchEvent(new CustomEvent('orkestrai:open-attention'));
      return;
    }
    if (
      location.pathname === '/terminal'
      && (item.id === 'command:control-center' || item.id === 'command:workstreams' || item.id === 'command:review-center' || item.id === 'command:automations')
      && item.workspaceId
    ) {
      const nodeId = item.id === 'command:control-center'
        ? workbenchControlCenterItemId(item.workspaceId)
        : item.id === 'command:workstreams'
          ? workbenchWorkstreamsItemId(item.workspaceId)
        : item.id === 'command:review-center'
          ? workbenchReviewCenterItemId(item.workspaceId)
          : workbenchAutomationsItemId(item.workspaceId);
      window.dispatchEvent(new CustomEvent<WorkbenchOpenRequestDetail>(WORKBENCH_OPEN_REQUEST, {
        detail: { workspaceId: item.workspaceId, nodeId, direction: null },
      }));
      return;
    }

    if (item.kind === 'role') {
      if (location.pathname === '/canvas') {
        window.dispatchEvent(new CustomEvent('orkestrai:menu-action', { detail: 'roles' }));
        return;
      }
      sessionStorage.setItem('orkestrai.menu-action', 'roles');
      await goto(`/canvas?workspace=${item.workspaceId}`);
      return;
    }
    if ((item.kind === 'file' || item.id.startsWith('design-code:')) && item.path) {
      if (location.pathname === '/terminal') {
        window.dispatchEvent(new CustomEvent('orkestrai:open-file', {
          detail: { workspaceId: item.workspaceId, path: item.path },
        }));
        return;
      }
      sessionStorage.setItem('orkestrai.open-file', JSON.stringify({ workspaceId: item.workspaceId, path: item.path }));
      await goto(`/terminal?workspace=${item.workspaceId}`);
      return;
    }
    if (direction && item.nodeId) {
      if (location.pathname === '/terminal' && activeWorkspaceId() === item.workspaceId) {
        window.dispatchEvent(new CustomEvent<WorkbenchOpenRequestDetail>(WORKBENCH_OPEN_REQUEST, {
          detail: { workspaceId: item.workspaceId, nodeId: item.nodeId, direction },
        }));
        return;
      }
      await goto(routeWithSplit(item, direction));
      return;
    }
    await goto(item.route);
  }

  function groupItems(kind: Exclude<PaletteKind, 'command'>): PaletteItem[] {
    return displayItems.filter((item) => item.kind === kind);
  }

  function measureVirtualRow(element: HTMLElement) {
    get(virtualizer).measureElement(element);
  }

  function handleDialogKeydown(event: KeyboardEvent): void {
    if (!open || !selectedItem || event.key !== 'Enter' || (!event.metaKey && !event.ctrlKey)) return;
    event.preventDefault();
    void openItem(selectedItem, event.shiftKey ? 'vertical' : 'horizontal');
  }

  onMount(() => {
    recents = parseStored(RECENTS_KEY);
    favorites = parseStored(FAVORITES_KEY);
    commandWorkspaceId = activeWorkspaceId() ?? '';
    const handleShortcut = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLocaleLowerCase() !== 'k') return;
      event.preventDefault();
      open = !open;
      if (open) {
        commandWorkspaceId = activeWorkspaceId() ?? '';
        selectedId = idleItems[0]?.id ?? '';
      }
    };
    const handleOpen = () => {
      commandWorkspaceId = activeWorkspaceId() ?? '';
      open = true;
      selectedId = idleItems[0]?.id ?? '';
    };
    window.addEventListener('keydown', handleShortcut);
    window.addEventListener('orkestrai:global-search', handleOpen);
    return () => {
      window.removeEventListener('keydown', handleShortcut);
      window.removeEventListener('orkestrai:global-search', handleOpen);
    };
  });
</script>

<svelte:window onkeydown={handleDialogKeydown} />

{#snippet itemIcon(kind: PaletteKind)}
  {#if kind === 'workspace'}<Network size={15} aria-hidden="true" />
  {:else if kind === 'documentation'}<BookOpen size={15} aria-hidden="true" />
  {:else if kind === 'agent'}<Bot size={15} aria-hidden="true" />
  {:else if kind === 'task'}<SquareKanban size={15} aria-hidden="true" />
  {:else if kind === 'note'}<StickyNote size={15} aria-hidden="true" />
  {:else if kind === 'artifact'}<Blocks size={15} aria-hidden="true" />
  {:else if kind === 'role'}<UserRoundCog size={15} aria-hidden="true" />
  {:else if kind === 'skill'}<Sparkles size={15} aria-hidden="true" />
  {:else if kind === 'automation'}<Workflow size={15} aria-hidden="true" />
  {:else if kind === 'activity'}<Activity size={15} aria-hidden="true" />
  {:else if kind === 'message'}<MessageSquareMore size={15} aria-hidden="true" />
  {:else if kind === 'attention'}<BellRing size={15} aria-hidden="true" />
  {:else if kind === 'memory'}<BookMarked size={15} aria-hidden="true" />
  {:else if kind === 'file'}<File size={15} aria-hidden="true" />
  {:else}<Search size={15} aria-hidden="true" />
  {/if}
{/snippet}

{#snippet resultItem(item: PaletteItem)}
  <Command.Item
    value={item.id}
    keywords={[item.title, item.subtitle, item.preview ?? '', kindLabel(item.kind)]}
    onSelect={() => void openItem(item)}
    onpointermove={() => (selectedId = item.id)}
    class="h-[42px] min-w-0 gap-2 px-2.5"
  >
    <span class="grid size-6 shrink-0 place-items-center rounded-[4px] bg-[var(--app-surface-raised)] text-[var(--app-text-muted)]">
      {@render itemIcon(item.kind)}
    </span>
    <span class="min-w-0 flex-1">
      <span class="block truncate text-xs font-medium text-[var(--app-text)]">{item.title}</span>
      <span class="block truncate text-ui-xs text-[var(--app-text-muted)]">{item.subtitle}</span>
    </span>
    <span class="shrink-0 text-ui-xs text-[var(--app-text-muted)]">{kindLabel(item.kind)}</span>
  </Command.Item>
{/snippet}

<Command.Dialog
  bind:open
  bind:value={selectedId}
  shouldFilter={false}
  title={m['global_search.title']()}
  description={m['global_search.description']()}
  class="top-[12vh] w-[min(900px,calc(100vw-32px))]! max-w-none! translate-y-0 border-[var(--app-border)] bg-[var(--app-surface)] shadow-2xl"
>
  <Command.Input bind:value={query} placeholder={m['global_search.placeholder']()} autofocus autocomplete="off" />
  <div class="grid min-h-0 grid-cols-[minmax(0,1fr)_300px] border-t border-[var(--app-border)] max-[760px]:grid-cols-1">
    {#if displayItems.length > 50}
      <Command.List bind:ref={listElement} class="max-h-[420px] min-h-[360px] border-r border-[var(--app-border)] max-[760px]:border-r-0">
        <div class="relative w-full" style:height={`${$virtualizer.getTotalSize()}px`}>
          {#each virtualRows as row (row.key)}
            {@const item = displayItems[row.index]}
            <div
              class="absolute left-0 top-0 w-full px-1"
              style:height={`${row.size}px`}
              style:transform={`translateY(${row.start}px)`}
              data-index={row.index}
              use:measureVirtualRow
            >
              {@render resultItem(item)}
            </div>
          {/each}
        </div>
      </Command.List>
    {:else}
      <Command.List bind:ref={listElement} class="max-h-[420px] min-h-[360px] border-r border-[var(--app-border)] max-[760px]:border-r-0">
        {#if loading}<Command.Loading>{m['global_search.searching']()}</Command.Loading>{/if}
        <Command.Empty>{m['global_search.empty']()}</Command.Empty>
        {#if query.trim()}
          {#each GROUP_ORDER as kind (kind)}
            {@const items = groupItems(kind)}
            {#if items.length}
              <Command.Group heading={kindLabel(kind)} value={`group:${kind}`}>
                {#each items as item (item.id)}{@render resultItem(item)}{/each}
              </Command.Group>
            {/if}
          {/each}
        {:else}
          {#if favorites.length}
            <Command.Group heading={m['global_search.favorites']()} value="group:favorites">
              {#each favorites as item (item.id)}{@render resultItem(item)}{/each}
            </Command.Group>
          {/if}
          {#if recents.length}
            <Command.Group heading={m['global_search.recent']()} value="group:recent">
              {#each recents.filter((item) => !isFavorite(item)) as item (item.id)}{@render resultItem(item)}{/each}
            </Command.Group>
          {/if}
          {@const storedIds = new Set([...favorites, ...recents].map((item) => item.id))}
          {@const remainingCommands = commands.filter((item) => !storedIds.has(item.id))}
          {#if remainingCommands.length}
            <Command.Group heading={m['global_search.commands']()} value="group:commands">
              {#each remainingCommands as item (item.id)}{@render resultItem(item)}{/each}
            </Command.Group>
          {/if}
        {/if}
      </Command.List>
    {/if}

    <aside class="flex min-h-[360px] min-w-0 flex-col bg-[var(--app-canvas)] p-4 max-[760px]:hidden" aria-label={m['global_search.results']()}>
      {#if selectedItem}
        <div class="flex items-start gap-3">
          <span class="grid size-8 shrink-0 place-items-center rounded-md border border-[var(--app-border)] bg-[var(--app-surface-raised)] text-[var(--app-text-soft)]">
            {@render itemIcon(selectedItem.kind)}
          </span>
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-semibold text-[var(--app-text)]">{selectedItem.title}</p>
            <p class="mt-0.5 truncate text-ui-xs text-[var(--app-text-muted)]">{selectedItem.subtitle}</p>
          </div>
          <Tooltip.Root>
            <Tooltip.Trigger>
              {#snippet child({ props })}
                <Button
                  {...props}
                  variant="ghost"
                  size="icon-sm"
                  aria-label={isFavorite(selectedItem) ? m['global_search.unfavorite']() : m['global_search.favorite']()}
                  onclick={() => toggleFavorite(selectedItem)}
                >
                  <Star size={15} fill={isFavorite(selectedItem) ? 'currentColor' : 'none'} aria-hidden="true" />
                </Button>
              {/snippet}
            </Tooltip.Trigger>
            <Tooltip.Content>{isFavorite(selectedItem) ? m['global_search.unfavorite']() : m['global_search.favorite']()}</Tooltip.Content>
          </Tooltip.Root>
        </div>
        <p class="mt-4 line-clamp-6 break-words text-xs leading-5 text-[var(--app-text-soft)]">
          {selectedItem.preview || m['global_search.preview']()}
        </p>
        <div class="mt-auto space-y-2 pt-4">
          <Button class="w-full justify-start" size="sm" onclick={() => void openItem(selectedItem)}>
            <SquareTerminal size={14} aria-hidden="true" />
            {m['global_search.open']()}
          </Button>
          {#if selectedItem.nodeId}
            <div class="grid grid-cols-2 gap-2">
              <Button variant="outline" size="sm" onclick={() => void openItem(selectedItem, 'horizontal')}>
                <PanelRightOpen size={14} aria-hidden="true" />
                {m['global_search.open_right']()}
              </Button>
              <Button variant="outline" size="sm" onclick={() => void openItem(selectedItem, 'vertical')}>
                <PanelBottomOpen size={14} aria-hidden="true" />
                {m['global_search.open_below']()}
              </Button>
            </div>
          {/if}
        </div>
      {:else}
        <div class="flex flex-1 items-center justify-center text-center">
          <div>
            <Search size={22} class="mx-auto text-[var(--app-text-muted)]" aria-hidden="true" />
            <p class="mt-2 text-xs leading-5 text-[var(--app-text-muted)]">{m['global_search.preview']()}</p>
          </div>
        </div>
      {/if}
      <p class="mt-3 border-t border-[var(--app-border)] pt-3 text-ui-xs leading-4 text-[var(--app-text-muted)]">
        {m['global_search.hint']()}
      </p>
    </aside>
  </div>
</Command.Dialog>
