<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { uuidv7 } from '@beeblock/svelar/support';
  import AdventureStage from '$lib/components/agent-room/adventure/AdventureStage.svelte';
  import type { HeroLabel } from '$lib/components/agent-room/adventure/AdventureStage.svelte';
  import { Button } from '$lib/components/ui/button';
  import { FORMATION_LINGER_MS, lineup } from '$lib/components/agent-room/adventure/adventure-party.js';
  import type { AdventureSoundLevel } from '$lib/components/agent-room/adventure/adventure-audio.js';
  import { adventureAction, loadAdventure, onAdventureChange, reportBattle, type AdventureOutcome, type AdventureSnapshot } from '$lib/components/agent-room/adventure/adventure-client.js';
  import { heroLevelText, itemName } from '$lib/components/agent-room/adventure/adventure-text.js';
  import { agentStatus, retainAgentStatus } from '$lib/components/agent-room/agent-status.svelte.js';
  import { attentionFeed, retainAttentionFeed, scheduleAttentionRefresh } from '$lib/components/agent-room/attention-feed.svelte.js';
  import { agentDoingLabel, agentStateLabel } from '$lib/components/agent-room/agent-status-labels.js';
  import { getAppSettings } from '$lib/components/agent-room/app-settings.svelte.js';
  import { adventureCatalog } from '$lib/i18n/adventure/index.js';
  import { localeState } from '$lib/i18n/locale.svelte.js';
  import { RARITY_RULES, rarityIndex, type Rarity } from '$lib/modules/agent-room/domain/adventure/items.js';
  import { runeRule } from '$lib/modules/agent-room/domain/adventure/runes.js';
  import type { PendingReport, SimRules } from '$lib/modules/agent-room/domain/adventure/simulation.js';
  import type { StagePosition } from '$lib/modules/agent-room/domain/adventure/world.js';
  import type { HeroClassId } from '$lib/modules/agent-room/domain/adventure/catalog.js';
  import type { Workspace } from '$lib/modules/agent-room/domain/types.js';
  import * as m from '$lib/paraglide/messages.js';

  type Desktop = {
    setAdventureInteractive?: (interactive: boolean) => void;
    openInMainWindow?: (path: string) => void;
  };
  const desktop = (typeof window !== 'undefined' ? (window as unknown as { orkestraiDesktop?: Desktop }).orkestraiDesktop : undefined);

  type Battle = PendingReport & { position: StagePosition; wave: number };
  type StageApi = {
    quest: (title: string | null) => void;
    drain: () => Battle;
    configure: (rules: Partial<SimRules>, travelTo?: StagePosition) => void;
    levelUp: (heroId: string) => void;
    loot: (rarities: Rarity[]) => void;
    announce: (text: string, tone?: 'gold' | 'danger' | 'info' | 'loot', color?: string) => void;
  };

  const REPORT_MS = 5_000;
  const REFRESH_MS = 60_000;

  let workspaceId = $state<string | null>(null);
  let workspaceName = $state('');
  let snapshot = $state<AdventureSnapshot | null>(null);
  let soundLevel = $state<AdventureSoundLevel>('alerts');
  let selected = $state<{ id: string; left: number; top: number } | null>(null);
  let stage = $state<StageApi | null>(null);
  let pointerOverHero = false;
  let pointerOverUi = false;
  // Results of battles the server has not acknowledged yet.
  let unsent: Battle | null = null;
  let reporting = false;
  // When each hero's agent was last seen working, to keep the formation steady between turns.
  const workedAt = new Map<string, number>();
  let lingering = $state<ReadonlySet<string>>(new Set());

  const catalog = $derived(adventureCatalog(localeState.current));
  const view = $derived(snapshot ? lineup(snapshot, agentStatus.agents, { lingering }) : null);
  const members = $derived(view?.members ?? []);
  const labels = $derived<Record<string, HeroLabel>>(Object.fromEntries((view?.heroes ?? []).map((hero) => [hero.id, {
    id: hero.id,
    name: hero.name,
    agentTitle: hero.agent?.title ?? null,
    classId: hero.classId,
    level: hero.level,
    paragon: hero.paragon,
    asks: asksOf(hero.agent?.nodeId),
    visualTier: hero.build.visualTier,
    weaponRarity: hero.build.weaponRarity,
  }])));
  const rules = $derived<Partial<SimRules>>(snapshot ? simRules(snapshot) : {});
  const card = $derived(selected && view ? view.heroes.find((hero) => hero.id === selected!.id) ?? null : null);
  const cardAgent = $derived(card?.agent ?? null);
  const cardLive = $derived(cardAgent ? agentStatus.agents[cardAgent.nodeId] ?? null : null);
  const cardAsks = $derived(asksOf(cardAgent?.nodeId));
  const cardState = $derived(agentStateLabel(cardLive?.sessionAlive ? cardLive.state : 'disconnected'));
  // What the agent is doing, when it says more than its state.
  const cardDoing = $derived.by(() => {
    const doing = cardLive?.sessionAlive ? agentDoingLabel(cardLive) : '';
    return doing && doing !== cardState ? doing : '';
  });

  function asksOf(nodeId: string | undefined): number {
    return nodeId ? attentionFeed.byNode[nodeId]?.length ?? 0 : 0;
  }

  /** Notes which heroes' agents work now and which worked within the linger window. */
  function trackWork() {
    const now = Date.now();
    for (const hero of snapshot?.heroes ?? []) {
      const live = hero.agent ? agentStatus.agents[hero.agent.nodeId] : undefined;
      if (live?.sessionAlive && (live.state === 'working' || live.state === 'starting')) workedAt.set(hero.id, now);
    }
    for (const [heroId, at] of workedAt) if (now - at >= FORMATION_LINGER_MS) workedAt.delete(heroId);
    const next = new Set(workedAt.keys());
    if (next.size !== lingering.size || [...next].some((heroId) => !lingering.has(heroId))) lingering = next;
  }

  function simRules(save: AdventureSnapshot): Partial<SimRules> {
    return {
      autoAdvance: save.account.settings.autoAdvance,
      autoRetry: save.account.settings.autoRetry,
      reviveMs: Math.round(20_000 * (1 - runeRule(save.account.runes, 'revive') / 100)),
      blueChestBonus: runeRule(save.account.runes, 'blue-chance'),
      cleared: save.account.cleared[save.account.position.difficulty],
    };
  }

  function className(id: HeroClassId): string {
    return (m as unknown as Record<string, () => string>)[`adventure.class_${id}`]?.() ?? id;
  }

  /** The workspace to follow: the one in the link, else the one last opened in the app. */
  function pickWorkspace(list: Workspace[]): string | null {
    const requested = new URLSearchParams(location.search).get('workspace');
    let remembered: string | null = null;
    try { remembered = localStorage.getItem('orkestrai.activeWorkspaceId'); } catch { /* private storage */ }
    return list.find((entry) => entry.id === requested)?.id ?? list.find((entry) => entry.id === remembered)?.id ?? list[0]?.id ?? null;
  }

  function samePosition(a: StagePosition, b: StagePosition): boolean {
    return a.difficulty === b.difficulty && a.act === b.act && a.stage === b.stage;
  }

  /**
   * Takes what the server answered: the new save, and the moments to show —
   * level-ups, loot from chests that opened themselves, quests and pets.
   * `travel` is true when the position may have changed elsewhere (the camp).
   */
  function apply(outcome: AdventureOutcome, travel: boolean) {
    const previous = snapshot;
    snapshot = outcome.snapshot;
    const position = outcome.snapshot.account.position;
    stage?.configure(simRules(outcome.snapshot), travel && previous && !samePosition(previous.account.position, position) ? position : undefined);
    for (const { heroId, level, paragon } of outcome.levelUps) {
      stage?.levelUp(heroId);
      const hero = outcome.snapshot.heroes.find((entry) => entry.id === heroId);
      if (hero) stage?.announce(paragon ? m['adventure.hero_paragon_up']({ name: hero.name, level: paragon }) : m['adventure.hero_level_up']({ name: hero.name, level }), 'gold');
    }
    const items = outcome.opened.flatMap((opened) => opened.items);
    if (items.length) {
      stage?.loot(items.map((item) => item.rarity));
      const best = [...items].sort((a, b) => rarityIndex(b.rarity) - rarityIndex(a.rarity))[0];
      if (rarityIndex(best.rarity) >= 4) stage?.announce(m['adventure.loot_found']({ rarity: catalog.rarities[best.rarity], item: itemName(catalog, best) }), 'loot', RARITY_RULES[best.rarity].color);
    }
    for (const quest of outcome.quests) stage?.quest(quest.title);
    for (const petId of outcome.pets) stage?.announce(m['adventure.pet_joined']({ pet: catalog.pets[petId] }), 'gold');
  }

  async function refresh(id: string, travel: boolean) {
    const outcome = await loadAdventure(id).catch(() => null);
    if (!outcome || id !== workspaceId) return;
    apply(outcome, travel);
    const offline = outcome.snapshot.account.offline;
    if (offline) {
      stage?.announce(m['adventure.offline_back']({ minutes: offline.minutes, gold: offline.gold }), 'gold');
      void adventureAction(id, { type: 'dismiss-offline' }).catch(() => undefined);
    }
  }

  function merge(a: Battle, b: Battle): Battle {
    const xp = { ...a.xp };
    for (const [heroId, value] of Object.entries(b.xp)) xp[heroId] = (xp[heroId] ?? 0) + value;
    const kills = { ...a.kills };
    for (const [monster, value] of Object.entries(b.kills) as Array<[keyof typeof kills, number]>) kills[monster] = (kills[monster] ?? 0) + value;
    return { elapsedMs: a.elapsedMs + b.elapsedMs, xp, gold: a.gold + b.gold, kills, chests: [...a.chests, ...b.chests], bosses: [...a.bosses, ...b.bosses], stages: [...a.stages, ...b.stages], position: b.position, wave: b.wave };
  }

  /** Sends the battle's results; a failed send keeps them for the next one. */
  async function report() {
    const id = workspaceId;
    if (!id || !stage || reporting) return;
    const fresh = stage.drain();
    unsent = unsent ? merge(unsent, fresh) : fresh;
    const batch = unsent;
    const empty = batch.elapsedMs === 0 && !batch.chests.length && !batch.stages.length && !Object.keys(batch.xp).length;
    if (empty) { unsent = null; return; }
    reporting = true;
    try {
      const outcome = await reportBattle(id, {
        reportId: uuidv7(),
        ...batch,
        gold: Math.round(batch.gold),
        xp: Object.fromEntries(Object.entries(batch.xp).map(([heroId, value]) => [heroId, Math.round(value)])),
      });
      if (unsent === batch) unsent = null;
      if (id === workspaceId) apply(outcome, false);
    } catch {
      // Kept in `unsent`; the next tick tries again with everything.
    } finally {
      reporting = false;
    }
  }

  /** Opens a screen of the app: the main window on the desktop, the same tab elsewhere. */
  function open(path: string) {
    selected = null;
    if (desktop?.openInMainWindow) desktop.openInMainWindow(path);
    else location.assign(path);
  }

  function openCamp(heroId?: string) {
    if (!workspaceId) return;
    open(`/adventure/camp?workspace=${encodeURIComponent(workspaceId)}${heroId ? `&hero=${encodeURIComponent(heroId)}` : ''}`);
  }

  /** The strip lets clicks through everywhere except heroes, the HUD and the card. */
  function syncInteractive() {
    desktop?.setAdventureInteractive?.(pointerOverHero || pointerOverUi || selected !== null);
  }

  function onPointerMove(event: PointerEvent) {
    const over = event.target instanceof Element && Boolean(event.target.closest('[data-adventure-interactive]'));
    if (over !== pointerOverUi) { pointerOverUi = over; syncInteractive(); }
  }

  $effect(() => {
    const id = workspaceId;
    if (!id) return;
    untrack(() => {
      snapshot = null;
      unsent = null;
      void refresh(id, true);
    });
    const releaseStatus = untrack(() => retainAgentStatus(id));
    const releaseAttention = untrack(() => retainAttentionFeed(id));
    const reportTimer = setInterval(() => { trackWork(); void report(); }, REPORT_MS);
    const refreshTimer = setInterval(() => void refresh(id, true), REFRESH_MS);
    const stopListening = onAdventureChange((changed) => { if (changed === id) void refresh(id, true); });
    return () => {
      void report();
      clearInterval(reportTimer);
      clearInterval(refreshTimer);
      stopListening();
      releaseStatus();
      releaseAttention();
    };
  });

  $effect(() => {
    void selected;
    untrack(syncInteractive);
  });

  // A hero whose agent starts working takes its place right away; leaving waits for the linger window.
  $effect(() => {
    for (const hero of snapshot?.heroes ?? []) {
      const live = hero.agent ? agentStatus.agents[hero.agent.nodeId] : undefined;
      void live?.state;
      void live?.sessionAlive;
    }
    untrack(trackWork);
  });

  onMount(() => {
    const workspaces = () => fetch('/api/agent-room/workspaces').then((response) => response.json()).then((body: { data?: Workspace[] }) => body.data ?? []);
    void workspaces().then((list) => {
      const id = pickWorkspace(list);
      workspaceName = list.find((entry) => entry.id === id)?.name ?? '';
      workspaceId = id;
    }).catch(() => undefined);
    // The strip never takes focus, so it re-reads the sound setting on a timer.
    const readSound = () => void getAppSettings().then((settings) => {
      const level = settings.adventureSound;
      if (level === 'off' || level === 'alerts' || level === 'all') soundLevel = level;
    });
    readSound();
    const soundTimer = setInterval(readSound, 30_000);
    // The party follows the workspace opened in the app.
    const onStorage = (event: StorageEvent) => {
      if (event.key !== 'orkestrai.activeWorkspaceId' || !event.newValue || event.newValue === workspaceId) return;
      const next = event.newValue;
      void workspaces().then((list) => {
        if (!list.some((entry) => entry.id === next)) return;
        workspaceName = list.find((entry) => entry.id === next)?.name ?? '';
        workspaceId = next;
      }).catch(() => undefined);
    };
    window.addEventListener('storage', onStorage);

    // A finished card is a quest: ask the server right away instead of waiting for the next look.
    let socket: WebSocket | null = null;
    let reconnect: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;
    const connect = () => {
      if (disposed) return;
      socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/agent-room/pty`);
      socket.onopen = () => socket?.send(JSON.stringify({ type: 'subscribe', events: ['channelMessage', 'attentionChanged'] }));
      socket.onmessage = (message) => {
        let frame: { type?: string; workspaceId?: string; message?: { meta?: Record<string, unknown> } };
        try { frame = JSON.parse(String(message.data)); } catch { return; }
        const id = workspaceId;
        if (!id || frame.workspaceId !== id) return;
        if (frame.type === 'channelMessage' && frame.message?.meta?.event === 'task_done') setTimeout(() => void refresh(id, true), 1_500);
        if (frame.type === 'attentionChanged') scheduleAttentionRefresh();
      };
      socket.onclose = () => { if (!disposed) reconnect = setTimeout(connect, 3_000); };
    };
    connect();
    return () => {
      disposed = true;
      clearInterval(soundTimer);
      if (reconnect) clearTimeout(reconnect);
      socket?.close();
      window.removeEventListener('storage', onStorage);
    };
  });
</script>

<svelte:head><title>{m['adventure.title']()}</title></svelte:head>
<svelte:window onpointermove={onPointerMove} onkeydown={(event) => { if (event.key === 'Escape') selected = null; }} />

<main class="adventure" class:desktop={Boolean(desktop?.setAdventureInteractive)}>
  {#if snapshot && workspaceId}
    {#key workspaceId}
      <AdventureStage
        bind:this={stage}
        party={members}
        teamActive={view?.teamActive ?? false}
        supporters={view?.supporters ?? []}
        {labels}
        position={snapshot.account.position}
        {rules}
        activePet={snapshot.account.activePet}
        gold={snapshot.account.gold}
        chests={snapshot.account.chests.length}
        difficultyName={catalog.difficulties[snapshot.account.position.difficulty]}
        {soundLevel}
        onSelect={(id, box) => { selected = selected?.id === id ? null : { id, left: box.left + box.width / 2, top: box.top }; }}
        onHover={(id) => { pointerOverHero = id !== null; syncInteractive(); }}
        onOpenCamp={() => openCamp()}
      />
    {/key}
  {/if}

  {#if card && selected}
    <div class="card" data-adventure-interactive role="dialog" aria-label={card.name} style:left={`${Math.max(12, Math.min(selected.left - 150, window.innerWidth - 312))}px`} style:bottom={`${window.innerHeight - selected.top + 10}px`}>
      <header>
        <b>{card.name}</b>
        <span class="class">{card.leader ? `${className(card.classId)} · ${m['adventure.leader']()}` : className(card.classId)} · {heroLevelText(card.level, card.paragon)}</span>
        <span class="played">{cardAgent ? m['adventure.played_by']({ agent: cardAgent.title }) : m['adventure.resting_in_guild']()}</span>
      </header>
      <div class="xp" title={m['adventure.xp']({ into: card.xp, next: card.build.xpToNext })}>
        <span style:width={`${Math.min(100, Math.round((card.xp / Math.max(1, card.build.xpToNext)) * 100))}%`}></span>
      </div>
      {#if cardAgent}
        <p class="state">
          <span class={`dot ${card.activity}`} aria-hidden="true"></span>
          {cardState}
          {#if cardDoing}<span class="doing">{`· ${cardDoing}`}</span>{/if}
        </p>
        {#if card.activity === 'working'}<p class="inspired">{m['adventure.inspired']()}</p>{/if}
      {:else}
        <p class="state rest">{m['adventure.resting_hint']()}</p>
      {/if}
      <p class="gear">
        {catalog.outfits[String(card.build.visualTier) as '1']} · {m['adventure.power']({ rating: card.build.rating })}
        {#if !card.deployed}<span class="reserve">{`· ${m['adventure.reserve']()}`}</span>{/if}
      </p>
      {#if cardAsks > 0}
        <p class="asks">{m['adventure.asks']({ count: cardAsks })}</p>
      {/if}
      {#if cardAgent}
        <div class="actions">
          <Button variant="ghost" size="sm" class="flex-1 bg-white/10 text-[#f4ead2] hover:bg-white/20 hover:text-[#f4ead2]" onclick={() => open(`/terminal?workspace=${encodeURIComponent(workspaceId ?? '')}&node=${encodeURIComponent(cardAgent!.nodeId)}`)}>{m['adventure.open_focus']()}</Button>
          <Button size="sm" class="flex-1 bg-[#e8b84b] text-[#1a1405] hover:bg-[#f0c766]" onclick={() => open(`/chat?workspace=${encodeURIComponent(workspaceId ?? '')}&channel=${encodeURIComponent(`dm:${cardAgent!.nodeId}`)}`)}>
            {cardAsks > 0 || card.activity === 'attention' ? m['adventure.answer']() : m['adventure.talk']()}
          </Button>
        </div>
      {/if}
      <Button variant="ghost" size="sm" class="w-full bg-white/5 text-[#ffe9b3] hover:bg-white/15 hover:text-[#ffe9b3]" onclick={() => openCamp(card!.id)}>{m['adventure.open_equipment']()}</Button>
      <p class="where">{workspaceName}</p>
    </div>
  {/if}
</main>

<style>
  :global(html),
  :global(body) {
    background: transparent !important;
    overflow: hidden;
  }

  .adventure {
    position: fixed;
    inset: 0;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    pointer-events: none;
  }

  .adventure :global(canvas),
  .adventure :global([data-adventure-interactive]) {
    pointer-events: auto;
  }

  /* In a browser tab the page is opaque, so the strip reads on any desktop wallpaper. */
  .adventure:not(.desktop) {
    background: linear-gradient(180deg, #2b3a55 0%, #4b6382 60%, #6a7f95 100%);
  }

  .card {
    position: fixed;
    width: 300px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px 14px;
    border-radius: 12px;
    background: rgba(23, 20, 15, 0.94);
    color: #f4ead2;
    font: 13px/1.4 ui-sans-serif, system-ui, sans-serif;
    box-shadow: 0 0 0 1px rgba(232, 184, 75, 0.45), 0 14px 36px rgba(0, 0, 0, 0.45);
  }

  .card header {
    display: flex;
    flex-direction: column;
  }

  .card header b {
    font-size: 14px;
  }

  .class,
  .where {
    color: #e8b84b;
    font-size: 12px;
  }

  .played {
    color: rgba(244, 234, 210, 0.65);
    font-size: 12px;
  }

  .inspired {
    margin: 0;
    color: #ffd877;
    font-size: 12px;
  }

  .state.rest {
    color: rgba(244, 234, 210, 0.7);
    font-size: 12px;
  }

  .where {
    margin: 0;
    color: rgba(244, 234, 210, 0.55);
  }

  .xp {
    position: relative;
    height: 4px;
    border-radius: 2px;
    background: rgba(244, 234, 210, 0.15);
    overflow: hidden;
  }

  .xp > span {
    position: absolute;
    inset: 0 auto 0 0;
    background: linear-gradient(90deg, #b98a2e, #e8b84b);
  }

  .state,
  .asks,
  .gear {
    margin: 0;
    display: flex;
    align-items: baseline;
    gap: 6px;
    font-size: 12.5px;
  }

  .gear {
    color: rgba(244, 234, 210, 0.75);
    font-size: 12px;
  }

  .reserve {
    color: rgba(244, 234, 210, 0.55);
  }

  .doing {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: rgba(244, 234, 210, 0.7);
  }

  .asks {
    color: #ffcf6e;
  }

  .dot {
    width: 7px;
    height: 7px;
    flex: none;
    border-radius: 50%;
    background: #8d8a80;
    align-self: center;
  }

  .dot.working { background: #e8b84b; }
  .dot.attention { background: #ff9f43; }
  .dot.stunned { background: #e8574b; }

  .actions {
    display: flex;
    gap: 6px;
  }
</style>
