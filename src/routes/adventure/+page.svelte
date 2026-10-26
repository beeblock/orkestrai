<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import AdventureStage from '$lib/components/agent-room/adventure/AdventureStage.svelte';
  import type { HeroLabel } from '$lib/components/agent-room/adventure/AdventureStage.svelte';
  import { Button } from '$lib/components/ui/button';
  import { FORMATION_LINGER_MS, lineup } from '$lib/components/agent-room/adventure/adventure-party.js';
  import type { AdventureSoundLevel } from '$lib/components/agent-room/adventure/adventure-audio.js';
  import { AdventureRequestError, adventureAction, loadAdventure, onAdventureChange, onAdventureSettings, reportBattle, type AdventureOutcome, type AdventureSnapshot } from '$lib/components/agent-room/adventure/adventure-client.js';
  import { ReportOutbox, retryable, type Battle } from '$lib/components/agent-room/adventure/adventure-outbox.js';
  import { heroLevelText, itemName } from '$lib/components/agent-room/adventure/adventure-text.js';
  import { agentStatus, retainAgentStatus } from '$lib/components/agent-room/agent-status.svelte.js';
  import { attentionFeed, retainAttentionFeed, scheduleAttentionRefresh } from '$lib/components/agent-room/attention-feed.svelte.js';
  import { agentDoingLabel, agentStateLabel } from '$lib/components/agent-room/agent-status-labels.js';
  import { getAppSettings } from '$lib/components/agent-room/app-settings.svelte.js';
  import { adventureCatalog } from '$lib/i18n/adventure/index.js';
  import { localeState } from '$lib/i18n/locale.svelte.js';
  import { RARITY_RULES, rarityIndex, type Rarity } from '$lib/modules/agent-room/domain/adventure/items.js';
  import { runeRule } from '$lib/modules/agent-room/domain/adventure/runes.js';
  import type { SimRules } from '$lib/modules/agent-room/domain/adventure/simulation.js';
  import type { StagePosition } from '$lib/modules/agent-room/domain/adventure/world.js';
  import type { HeroClassId } from '$lib/modules/agent-room/domain/adventure/catalog.js';
  import type { Workspace } from '$lib/modules/agent-room/domain/types.js';
  import * as m from '$lib/paraglide/messages.js';

  type Desktop = {
    setAdventureInteractive?: (interactive: boolean) => void;
    openInMainWindow?: (path: string) => void;
    setAdventureLayout?: (layout: { width: 'full' | 'compact'; height: number }) => void;
    resetAdventurePosition?: () => void;
    onAdventurePlacement?: (callback: (placement: { moved: boolean }) => void) => () => void;
  };

  /** How the strip looks, from Settings → Adventure. */
  type StripLook = { width: 'full' | 'compact'; size: 'small' | 'normal' | 'large'; scenery: 'full' | 'minimal'; hud: 'always' | 'hover' };
  // Field height and drawing scale per size; the window keeps room above for cards and banners.
  const SIZES: Record<StripLook['size'], { field: number; scale: number }> = {
    small: { field: 120, scale: 0.8 },
    normal: { field: 150, scale: 1 },
    large: { field: 190, scale: 1.27 },
  };
  const ROOM_ABOVE = 170;
  const desktop = (typeof window !== 'undefined' ? (window as unknown as { orkestraiDesktop?: Desktop }).orkestraiDesktop : undefined);

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
  let look = $state<StripLook>({ width: 'full', size: 'normal', scenery: 'full', hud: 'always' });
  // Whether the owner dragged the strip away from the Dock.
  let moved = $state(false);
  let selected = $state<{ id: string; left: number; top: number } | null>(null);
  let stage = $state<StageApi | null>(null);
  let pointerOverHero = false;
  let pointerOverUi = false;
  // Results of battles the server has not acknowledged yet, by workspace.
  const outbox = new ReportOutbox();
  let reporting = false;
  // So much battle waits for an absent server that the party camps until it answers.
  let holding = $state(false);
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
    const outcome = await loadAdventure(id, { offline: outbox.size(id) === 0 }).catch(() => null);
    if (!outcome || id !== workspaceId) return;
    apply(outcome, travel);
    const offline = outcome.snapshot.account.offline;
    if (offline) {
      stage?.announce(m['adventure.offline_back']({ minutes: offline.minutes, gold: offline.gold }), 'gold');
      void adventureAction(id, { type: 'dismiss-offline' }).catch(() => undefined);
    }
  }

  /** Takes what the battle on the stage produced since the last look. */
  function collect(id: string) {
    if (stage) outbox.add(id, stage.drain());
  }

  /**
   * Sends the battle's results, oldest first. A report whose answer never
   * came goes again exactly as it was; one the server refused for good is
   * dropped, with a word on the strip.
   */
  async function report() {
    if (reporting) return;
    reporting = true;
    try {
      for (let next = outbox.next(); next; next = outbox.next()) {
        const { workspaceId: id, reportId, battle } = next;
        try {
          const outcome = await reportBattle(id, {
            reportId,
            ...battle,
            gold: Math.round(battle.gold),
            xp: Object.fromEntries(Object.entries(battle.xp).map(([heroId, value]) => [heroId, Math.round(value)])),
          });
          outbox.settle(reportId);
          if (id === workspaceId) apply(outcome, false);
        } catch (error) {
          const status = error instanceof AdventureRequestError ? error.status : null;
          // The server is away or busy: the same report goes again on the next tick.
          if (retryable(status)) break;
          if (status === 404) outbox.drop(id);
          else outbox.settle(reportId);
          if (id === workspaceId) stage?.announce(m['adventure.report_refused'](), 'danger');
        }
      }
    } finally {
      reporting = false;
      holding = outbox.full();
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
      void refresh(id, true);
    });
    const releaseStatus = untrack(() => retainAgentStatus(id));
    const releaseAttention = untrack(() => retainAttentionFeed(id));
    const reportTimer = setInterval(() => { trackWork(); collect(id); void report(); }, REPORT_MS);
    const refreshTimer = setInterval(() => void refresh(id, true), REFRESH_MS);
    const stopListening = onAdventureChange((changed) => { if (changed === id) void refresh(id, true); });
    return () => {
      // Whatever this workspace fought goes to this workspace, even as the strip moves on.
      collect(id);
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

  // The window follows the strip's width and size.
  $effect(() => {
    desktop?.setAdventureLayout?.({ width: look.width, height: SIZES[look.size].field + ROOM_ABOVE });
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
    // The strip never takes focus, so it re-reads its settings on a timer, and at once when Settings says so.
    const readSettings = () => void getAppSettings(true).then((settings) => {
      const level = settings.adventureSound;
      if (level === 'off' || level === 'alerts' || level === 'all') soundLevel = level;
      look = {
        width: settings.adventureWidth === 'compact' ? 'compact' : 'full',
        size: settings.adventureSize === 'small' || settings.adventureSize === 'large' ? settings.adventureSize : 'normal',
        scenery: settings.adventureScenery === 'minimal' ? 'minimal' : 'full',
        hud: settings.adventureHud === 'hover' ? 'hover' : 'always',
      };
    }).catch(() => undefined);
    readSettings();
    const soundTimer = setInterval(readSettings, 30_000);
    const stopSettings = onAdventureSettings(readSettings);
    const stopPlacement = desktop?.onAdventurePlacement?.((placement) => (moved = placement.moved));
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
      stopSettings();
      stopPlacement?.();
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
        teamActive={(view?.teamActive ?? false) && !holding}
        supporters={view?.supporters ?? []}
        {labels}
        position={snapshot.account.position}
        {rules}
        activePet={snapshot.account.activePet}
        gold={snapshot.account.gold}
        chests={snapshot.account.chests.length}
        difficultyName={catalog.difficulties[snapshot.account.position.difficulty]}
        {soundLevel}
        height={SIZES[look.size].field}
        scale={SIZES[look.size].scale}
        scenery={look.scenery}
        hudMode={look.hud}
        draggable={Boolean(desktop?.setAdventureLayout)}
        {moved}
        onResetPosition={desktop?.resetAdventurePosition ? () => desktop.resetAdventurePosition?.() : undefined}
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
