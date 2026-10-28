<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { page } from '$app/state';
  import { afterNavigate, goto } from '$app/navigation';
  import { ArrowLeft, Backpack, BookOpen, Gem, Map as MapIcon, PawPrint, ScrollText, Swords } from '@lucide/svelte';
  import { Button } from '$lib/components/ui/button';
  import { toast } from '@beeblock/svelar/ui';
  import * as Tabs from '$lib/components/ui/tabs';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import { lineup } from '$lib/components/agent-room/adventure/adventure-party.js';
  import { ATLAS_IDS, preloadAtlases } from '$lib/components/agent-room/adventure/atlas.js';
  import { AdventureRequestError, adventureAction, loadAdventure, onAdventureChange, type AdventureAction, type AdventureOutcome, type AdventureSnapshot } from '$lib/components/agent-room/adventure/adventure-client.js';
  import { errorText, formatNumber } from '$lib/components/agent-room/adventure/adventure-text.js';
  import CampHeroes from '$lib/components/agent-room/adventure/camp/CampHeroes.svelte';
  import CampInventory from '$lib/components/agent-room/adventure/camp/CampInventory.svelte';
  import CampCube from '$lib/components/agent-room/adventure/camp/CampCube.svelte';
  import CampRunes from '$lib/components/agent-room/adventure/camp/CampRunes.svelte';
  import CampPets from '$lib/components/agent-room/adventure/camp/CampPets.svelte';
  import CampMap from '$lib/components/agent-room/adventure/camp/CampMap.svelte';
  import CampLog from '$lib/components/agent-room/adventure/camp/CampLog.svelte';
  import ItemIcon from '$lib/components/agent-room/adventure/camp/ItemIcon.svelte';
  import '$lib/components/agent-room/adventure/camp/camp-skin.css';
  import { campArt } from '$lib/components/agent-room/adventure/camp-art.js';
  import { hasAtlas } from '$lib/components/agent-room/adventure/atlas.js';
  import { agentStatus, retainAgentStatus } from '$lib/components/agent-room/agent-status.svelte.js';
  import { adventureCatalog } from '$lib/i18n/adventure/index.js';
  import { localeState } from '$lib/i18n/locale.svelte.js';
  import type { Workspace } from '$lib/modules/agent-room/domain/types.js';
  import * as m from '$lib/paraglide/messages.js';

  type Tab = 'heroes' | 'inventory' | 'cube' | 'runes' | 'pets' | 'map' | 'log';
  // `frame`: the tab's picture in the camp icon sheet; the line icon stands in until it exists.
  const TABS: Array<{ id: Tab; icon: typeof Swords; frame: number; label: () => string }> = [
    { id: 'heroes', icon: Swords, frame: 0, label: m['adventure.camp_tab_heroes'] },
    { id: 'inventory', icon: Backpack, frame: 1, label: m['adventure.camp_tab_inventory'] },
    { id: 'cube', icon: Gem, frame: 2, label: m['adventure.camp_tab_cube'] },
    { id: 'runes', icon: BookOpen, frame: 3, label: m['adventure.camp_tab_runes'] },
    { id: 'pets', icon: PawPrint, frame: 4, label: m['adventure.camp_tab_pets'] },
    { id: 'map', icon: MapIcon, frame: 5, label: m['adventure.camp_tab_map'] },
    { id: 'log', icon: ScrollText, frame: 6, label: m['adventure.camp_tab_log'] },
  ];
  const TAB_ICONS = 'icons-camp-tabs';
  const banner = campArt('camp-banner');
  const corner = campArt('corner');

  function tabOf(value: string | null): Tab {
    return TABS.some((entry) => entry.id === value) ? (value as Tab) : 'heroes';
  }

  let workspaceId = $state<string | null>(page.url.searchParams.get('workspace'));
  let snapshot = $state<AdventureSnapshot | null>(null);
  let failed = $state(false);
  let busy = $state(false);
  let tab = $state<Tab>(tabOf(page.url.searchParams.get('tab')));
  let selectedHero = $state<string | null>(page.url.searchParams.get('hero'));
  // The link's parameters as last followed, so only the ones a new link changes are applied.
  let followed = { workspace: page.url.searchParams.get('workspace'), hero: page.url.searchParams.get('hero'), tab: page.url.searchParams.get('tab') };

  // Where the owner was before the camp (the canvas, a conversation…), to go back to it.
  let backTo = $state<string | null>(null);
  afterNavigate(({ from }) => {
    if (from?.url && !from.url.pathname.startsWith('/adventure')) backTo = `${from.url.pathname}${from.url.search}${from.url.hash}`;
  });

  function back() {
    void goto(backTo ?? (workspaceId ? `/canvas?workspace=${encodeURIComponent(workspaceId)}` : '/canvas'));
  }

  const catalog = $derived(adventureCatalog(localeState.current));
  const view = $derived(snapshot ? lineup(snapshot, agentStatus.agents) : null);

  async function refresh(id: string) {
    try {
      const outcome = await loadAdventure(id);
      if (id !== workspaceId) return;
      snapshot = outcome.snapshot;
      failed = false;
      selectedHero ??= outcome.snapshot.heroes[0]?.id ?? null;
    } catch {
      if (id === workspaceId) failed = true;
    }
  }

  /** Runs a camp action; the rules' refusals become a short, translated notice. */
  async function act(action: AdventureAction): Promise<AdventureOutcome | null> {
    const id = workspaceId;
    if (!id) return null;
    busy = true;
    try {
      const outcome = await adventureAction(id, action);
      // The camp moved to another workspace meanwhile: this answer is not about what is on screen.
      if (id !== workspaceId) return null;
      snapshot = outcome.snapshot;
      return outcome;
    } catch (error) {
      const code = error instanceof AdventureRequestError ? error.code : 'request';
      toast.error(errorText(catalog, code, m['adventure.camp_action_failed']()));
      return null;
    } finally {
      busy = false;
    }
  }

  function selectTab(next: string) {
    tab = next as Tab;
    const url = new URL(page.url);
    url.searchParams.set('tab', next);
    void goto(url, { replaceState: true, keepFocus: true, noScroll: true });
  }

  // Links inside the app reuse this page: a camp opened for another workspace,
  // hero or tab follows the link and forgets the previous workspace's save.
  $effect(() => {
    const params = page.url.searchParams;
    const next = { workspace: params.get('workspace'), hero: params.get('hero'), tab: params.get('tab') };
    untrack(() => {
      if (next.workspace && next.workspace !== followed.workspace && next.workspace !== workspaceId) {
        workspaceId = next.workspace;
        snapshot = null;
        failed = false;
        selectedHero = null;
      }
      if (next.hero && next.hero !== followed.hero) selectedHero = next.hero;
      if (next.tab !== followed.tab) tab = tabOf(next.tab);
      followed = next;
    });
  });

  $effect(() => {
    const id = workspaceId;
    if (!id) return;
    untrack(() => void refresh(id));
    const release = untrack(() => retainAgentStatus(id));
    const stop = onAdventureChange((changed) => { if (changed === id) void refresh(id); });
    // Battles on the strip keep the save moving; follow along.
    const timer = setInterval(() => void refresh(id), 15_000);
    return () => { release(); stop(); clearInterval(timer); };
  });

  onMount(() => {
    // Item icons for every tab, loading while the save does.
    preloadAtlases(ATLAS_IDS.filter((id) => id.startsWith('icons-')));
    if (workspaceId) return;
    void fetch('/api/agent-room/workspaces').then((response) => response.json()).then((body: { data?: Workspace[] }) => {
      let remembered: string | null = null;
      try { remembered = localStorage.getItem('orkestrai.activeWorkspaceId'); } catch { /* private storage */ }
      const list = body.data ?? [];
      workspaceId = list.find((entry) => entry.id === remembered)?.id ?? list[0]?.id ?? null;
    }).catch(() => { failed = true; });
  });
</script>

<svelte:head><title>{m['adventure.camp_title']()}</title></svelte:head>

<main class="camp" data-testid="adventure-camp" style:--camp-corner={corner ? `url(${corner})` : undefined}>
  <header class="banner" style:--banner={banner ? `url(${banner})` : undefined}>
    <Button variant="ghost" size="sm" class="back -ml-1 w-fit" onclick={back}>
      <ArrowLeft size={15} aria-hidden="true" />
      {m['adventure.camp_back']()}
    </Button>
    <div class="banner-row">
      <div class="titles">
        <h1 class="camp-title">{m['adventure.camp_title']()}</h1>
        <p>{m['adventure.camp_subtitle']()}</p>
      </div>
      {#if snapshot}
        <dl class="treasury" aria-label={m['adventure.camp_wallet']()}>
          <div class="camp-chip gold" title={m['adventure.gold']()}><ItemIcon atlasId="icons-misc" frame={6} size={22} /><dt class="sr-only">{m['adventure.gold']()}</dt><dd>{formatNumber(snapshot.account.gold)}</dd></div>
          <div class="camp-chip" title={m['adventure.camp_chests']()}><ItemIcon atlasId="icons-misc" frame={0} size={22} /><dt class="sr-only">{m['adventure.camp_chests']()}</dt><dd>{snapshot.account.chests.filter((chest) => chest.tier !== 'red').length}/{snapshot.limits.chests}</dd></div>
          <div class="camp-chip" title={m['adventure.camp_soulstones']()}><ItemIcon atlasId="icons-misc" frame={4} size={22} /><dt class="sr-only">{m['adventure.camp_soulstones']()}</dt><dd>{Object.values(snapshot.account.soulstones).reduce((sum, count) => sum + count, 0)}</dd></div>
          <div class="camp-chip" title={m['adventure.camp_coins']()}><ItemIcon atlasId="icons-misc" frame={5} size={22} /><dt class="sr-only">{m['adventure.camp_coins']()}</dt><dd>{snapshot.account.coins}</dd></div>
          <div class="camp-chip" title={m['adventure.camp_region']()}><ItemIcon atlasId="icons-misc" frame={8} size={22} /><dt class="sr-only">{m['adventure.camp_region']()}</dt><dd>{catalog.difficulties[snapshot.account.position.difficulty]} · {snapshot.account.position.act}-{snapshot.account.position.stage}</dd></div>
        </dl>
      {/if}
    </div>
  </header>

  {#if !snapshot}
    {#if failed}
      <p class="empty">{m['adventure.camp_load_failed']()}</p>
    {:else}
      <div class="loading" aria-hidden="true">
        <Skeleton class="h-9 w-[520px] max-w-full bg-[var(--app-surface-raised)]" />
        <Skeleton class="h-[420px] w-full bg-[var(--app-surface-raised)]" />
      </div>
    {/if}
  {:else if !snapshot.heroes.length}
    <p class="empty">{m['adventure.camp_no_heroes']()}</p>
  {:else if view}
    <Tabs.Root value={tab} onValueChange={selectTab} class="flex min-h-0 flex-1 flex-col gap-3">
      <Tabs.List class="camp-tabs h-auto w-full max-w-full justify-start gap-1 overflow-x-auto rounded-none bg-transparent p-0">
        {#each TABS as entry (entry.id)}
          <Tabs.Trigger value={entry.id} class="camp-tab h-auto flex-none gap-2 rounded-t-lg rounded-b-none border-0 px-3.5 py-2 text-ui-md font-semibold" data-testid={`camp-tab-${entry.id}`}>
            {#if hasAtlas(TAB_ICONS)}<ItemIcon atlasId={TAB_ICONS} frame={entry.frame} size={24} />{:else}<entry.icon size={15} aria-hidden="true" />{/if}
            <span>{entry.label()}</span>
            {#if entry.id === 'inventory' && snapshot.account.chests.length}<span class="pip">{snapshot.account.chests.length}</span>{/if}
          </Tabs.Trigger>
        {/each}
      </Tabs.List>
      <Tabs.Content value="heroes" class="m-0 min-h-0 flex-1">
        {#if tab === 'heroes'}<CampHeroes {snapshot} {catalog} heroes={view.heroes} {act} {busy} bind:selected={selectedHero} />{/if}
      </Tabs.Content>
      <Tabs.Content value="inventory" class="m-0 min-h-0 flex-1">
        {#if tab === 'inventory'}<CampInventory {snapshot} {catalog} heroes={view.heroes} {act} {busy} />{/if}
      </Tabs.Content>
      <Tabs.Content value="cube" class="m-0 min-h-0 flex-1">
        {#if tab === 'cube'}<CampCube {snapshot} {catalog} heroes={view.heroes} {act} {busy} />{/if}
      </Tabs.Content>
      <Tabs.Content value="runes" class="m-0 min-h-0 flex-1">
        {#if tab === 'runes'}<CampRunes {snapshot} {catalog} {act} {busy} />{/if}
      </Tabs.Content>
      <Tabs.Content value="pets" class="m-0 min-h-0 flex-1">
        {#if tab === 'pets'}<CampPets {snapshot} {catalog} {act} {busy} />{/if}
      </Tabs.Content>
      <Tabs.Content value="map" class="m-0 min-h-0 flex-1">
        {#if tab === 'map'}<CampMap {snapshot} {catalog} heroes={view.heroes} {act} {busy} />{/if}
      </Tabs.Content>
      <Tabs.Content value="log" class="m-0 min-h-0 flex-1">
        {#if tab === 'log'}<CampLog {snapshot} {catalog} />{/if}
      </Tabs.Content>
    </Tabs.Root>
  {/if}
</main>

<style>
  .camp {
    /* The shared app controls (buttons, selects, switches) take the camp's colors. */
    --app-text: var(--camp-ink);
    --app-text-soft: var(--camp-ink-soft);
    --app-text-muted: var(--camp-ink-muted);
    --app-border: var(--camp-edge);
    --app-border-strong: var(--camp-edge-strong);
    --app-surface: var(--camp-panel);
    --app-surface-raised: var(--camp-raised);
    --app-surface-subtle: var(--camp-inset);
    --app-accent: var(--camp-gold);
    --app-hover: color-mix(in srgb, var(--camp-gold) 10%, transparent);
    display: flex;
    flex-direction: column;
    gap: 14px;
    min-height: 100%;
    padding: 14px 22px 32px;
  }

  /* The banner: the camp at dusk, fading into the page under the title. */
  .banner {
    position: relative;
    display: grid;
    align-content: space-between;
    gap: 18px;
    min-height: 168px;
    margin: 0 -22px;
    padding: 6px 22px 16px;
    background:
      linear-gradient(90deg, var(--camp-bg) 0%, color-mix(in srgb, var(--camp-bg) 82%, transparent) 30%, color-mix(in srgb, var(--camp-bg) 20%, transparent) 62%, transparent 100%),
      linear-gradient(0deg, var(--camp-bg) 0%, transparent 45%),
      var(--banner, radial-gradient(80% 140% at 85% 100%, rgba(232, 184, 75, 0.22), transparent 60%)) center 62% / cover no-repeat;
  }

  .banner :global(.back) {
    color: var(--camp-ink-soft);
  }

  .banner-row {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    justify-content: space-between;
    gap: 14px 24px;
  }

  h1 {
    font-size: 28px;
    line-height: 1.15;
    text-shadow: 0 2px 10px rgba(0, 0, 0, 0.45);
  }

  :global(:root.light) h1 {
    text-shadow: 0 1px 0 rgba(255, 255, 255, 0.7);
  }

  .titles {
    display: grid;
    justify-items: start;
    max-width: 520px;
  }

  .titles p {
    margin: 4px 0 0;
    color: var(--camp-ink-soft);
    font-size: 12.5px;
  }

  .treasury {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin: 0;
  }

  .treasury dd {
    margin: 0;
    font-weight: 600;
  }

  .treasury .gold dd {
    color: var(--camp-gold-strong);
  }

  /* Tabs: plates on a gilded rule; the open one rises and glows. */
  .camp :global(.camp-tabs) {
    border-bottom: 1px solid var(--camp-edge-strong);
    box-shadow: 0 1px 0 var(--camp-glow);
  }

  .camp :global(.camp-tab) {
    color: var(--camp-ink-muted);
    background: transparent;
    transition: color 150ms ease, background-color 150ms ease;
  }

  .camp :global(.camp-tab:hover) {
    color: var(--camp-ink);
    background: color-mix(in srgb, var(--camp-gold) 7%, transparent);
  }

  .camp :global(.camp-tab[data-state='active']) {
    color: var(--camp-gold-strong);
    background: linear-gradient(180deg, var(--camp-raised), var(--camp-panel));
    box-shadow: inset 0 0 0 1px var(--camp-edge), inset 0 2px 0 var(--camp-gold), 0 -6px 16px var(--camp-glow);
  }

  .pip {
    min-width: 17px;
    padding: 0 5px;
    border-radius: 999px;
    background: #c4372b;
    color: #fff;
    font-size: 11px;
    line-height: 17px;
    text-align: center;
  }

  .loading {
    display: grid;
    gap: 12px;
  }

  .empty {
    color: var(--camp-ink-muted);
    font-size: 13px;
  }
</style>
