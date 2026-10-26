<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { Backpack, BookOpen, Gem, Map as MapIcon, PawPrint, ScrollText, Swords } from '@lucide/svelte';
  import { toast } from '@beeblock/svelar/ui';
  import * as Tabs from '$lib/components/ui/tabs';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import { lineup } from '$lib/components/agent-room/adventure/adventure-party.js';
  import { AdventureRequestError, adventureAction, loadAdventure, onAdventureChange, type AdventureAction, type AdventureOutcome, type AdventureSnapshot } from '$lib/components/agent-room/adventure/adventure-client.js';
  import { errorText, formatNumber } from '$lib/components/agent-room/adventure/adventure-text.js';
  import CampHeroes from '$lib/components/agent-room/adventure/camp/CampHeroes.svelte';
  import CampInventory from '$lib/components/agent-room/adventure/camp/CampInventory.svelte';
  import CampCube from '$lib/components/agent-room/adventure/camp/CampCube.svelte';
  import CampRunes from '$lib/components/agent-room/adventure/camp/CampRunes.svelte';
  import CampPets from '$lib/components/agent-room/adventure/camp/CampPets.svelte';
  import CampMap from '$lib/components/agent-room/adventure/camp/CampMap.svelte';
  import CampLog from '$lib/components/agent-room/adventure/camp/CampLog.svelte';
  import { agentStatus, retainAgentStatus } from '$lib/components/agent-room/agent-status.svelte.js';
  import { adventureCatalog } from '$lib/i18n/adventure/index.js';
  import { localeState } from '$lib/i18n/locale.svelte.js';
  import type { Workspace } from '$lib/modules/agent-room/domain/types.js';
  import * as m from '$lib/paraglide/messages.js';

  type Tab = 'heroes' | 'inventory' | 'cube' | 'runes' | 'pets' | 'map' | 'log';
  const TABS: Array<{ id: Tab; icon: typeof Swords; label: () => string }> = [
    { id: 'heroes', icon: Swords, label: m['adventure.camp_tab_heroes'] },
    { id: 'inventory', icon: Backpack, label: m['adventure.camp_tab_inventory'] },
    { id: 'cube', icon: Gem, label: m['adventure.camp_tab_cube'] },
    { id: 'runes', icon: BookOpen, label: m['adventure.camp_tab_runes'] },
    { id: 'pets', icon: PawPrint, label: m['adventure.camp_tab_pets'] },
    { id: 'map', icon: MapIcon, label: m['adventure.camp_tab_map'] },
    { id: 'log', icon: ScrollText, label: m['adventure.camp_tab_log'] },
  ];

  let workspaceId = $state<string | null>(page.url.searchParams.get('workspace'));
  let snapshot = $state<AdventureSnapshot | null>(null);
  let failed = $state(false);
  let busy = $state(false);
  let tab = $state<Tab>((page.url.searchParams.get('tab') as Tab) || (page.url.searchParams.get('hero') ? 'heroes' : 'heroes'));
  let selectedHero = $state<string | null>(page.url.searchParams.get('hero'));

  const catalog = $derived(adventureCatalog(localeState.current));
  const view = $derived(snapshot ? lineup(snapshot, agentStatus.agents) : null);

  async function refresh(id: string) {
    try {
      const outcome = await loadAdventure(id);
      if (id !== workspaceId) return;
      snapshot = outcome.snapshot;
      failed = false;
      selectedHero ??= outcome.snapshot.heroes[0]?.nodeId ?? null;
    } catch {
      failed = true;
    }
  }

  /** Runs a camp action; the rules' refusals become a short, translated notice. */
  async function act(action: AdventureAction): Promise<AdventureOutcome | null> {
    const id = workspaceId;
    if (!id) return null;
    busy = true;
    try {
      const outcome = await adventureAction(id, action);
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

<main class="camp" data-testid="adventure-camp">
  <header class="camp-header">
    <div class="titles">
      <h1>{m['adventure.camp_title']()}</h1>
      <p>{m['adventure.camp_subtitle']()}</p>
    </div>
    {#if snapshot}
      <dl class="wallet" aria-label={m['adventure.camp_wallet']()}>
        <div><dt>{m['adventure.gold']()}</dt><dd class="gold">{formatNumber(snapshot.account.gold)}</dd></div>
        <div><dt>{m['adventure.camp_chests']()}</dt><dd>{snapshot.account.chests.length}/{snapshot.limits.chests}</dd></div>
        <div><dt>{m['adventure.camp_soulstones']()}</dt><dd>{Object.values(snapshot.account.soulstones).reduce((sum, count) => sum + count, 0)}</dd></div>
        <div><dt>{m['adventure.camp_coins']()}</dt><dd>{snapshot.account.coins}</dd></div>
        <div><dt>{m['adventure.camp_region']()}</dt><dd>{catalog.difficulties[snapshot.account.position.difficulty]} · {snapshot.account.position.act}-{snapshot.account.position.stage}</dd></div>
      </dl>
    {/if}
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
      <Tabs.List class="w-fit max-w-full gap-0.5 overflow-x-auto rounded-lg bg-app-hover p-0.5">
        {#each TABS as entry (entry.id)}
          <Tabs.Trigger value={entry.id} class="flex-none gap-1.5 rounded-md px-3 text-ui-md font-medium text-app-text-muted hover:text-app-text data-active:bg-app-surface-raised data-active:text-app-text data-active:shadow-border dark:data-active:border-transparent dark:data-active:bg-app-surface-raised dark:data-active:text-app-text [&[data-state=active]_svg]:text-app-accent" data-testid={`camp-tab-${entry.id}`}>
            <entry.icon size={14} aria-hidden="true" />{entry.label()}
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
    display: flex;
    flex-direction: column;
    gap: 14px;
    min-height: 100%;
    padding: 18px 22px 28px;
    background: var(--app-page);
    color: var(--app-text);
  }

  .camp-header {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    justify-content: space-between;
    gap: 12px 24px;
  }

  h1 {
    margin: 0;
    font-family: var(--font-display, inherit);
    font-size: 20px;
    font-weight: 600;
    letter-spacing: -0.015em;
  }

  .titles p {
    margin: 3px 0 0;
    color: var(--app-text-muted);
    font-size: 12px;
  }

  .wallet {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 18px;
    margin: 0;
  }

  .wallet div {
    display: grid;
    gap: 1px;
  }

  .wallet dt {
    color: var(--app-text-muted);
    font-size: 11px;
  }

  .wallet dd {
    margin: 0;
    font-size: 13px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }

  .gold {
    color: var(--app-accent);
  }

  .pip {
    min-width: 16px;
    padding: 0 5px;
    border-radius: 999px;
    background: var(--app-danger);
    color: #fff;
    font-size: 11px;
    line-height: 16px;
    text-align: center;
  }

  .loading {
    display: grid;
    gap: 12px;
  }

  .empty {
    color: var(--app-text-muted);
    font-size: 13px;
  }
</style>
