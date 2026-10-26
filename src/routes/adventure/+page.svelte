<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { getCsrfToken } from '@beeblock/svelar/http';
  import AdventureStage from '$lib/components/agent-room/adventure/AdventureStage.svelte';
  import { Button } from '$lib/components/ui/button';
  import * as NativeSelect from '$lib/components/ui/native-select';
  import { buildParty, type AgentNode } from '$lib/components/agent-room/adventure/adventure-party.js';
  import type { AdventureSoundLevel } from '$lib/components/agent-room/adventure/adventure-audio.js';
  import { agentStatus, retainAgentStatus } from '$lib/components/agent-room/agent-status.svelte.js';
  import { attentionFeed, retainAttentionFeed, scheduleAttentionRefresh } from '$lib/components/agent-room/attention-feed.svelte.js';
  import { agentDoingLabel, agentStateLabel } from '$lib/components/agent-room/agent-status-labels.js';
  import { getAppSettings } from '$lib/components/agent-room/app-settings.svelte.js';
  import { TEAMMATE_CLASS_IDS, type HeroClassId } from '$lib/modules/agent-room/domain/adventure/catalog.js';
  import type { AdventureProgress } from '$lib/modules/agent-room/domain/adventure/simulation.js';
  import type { CanvasNode, TerminalNodePayload, Workspace } from '$lib/modules/agent-room/domain/types.js';
  import * as m from '$lib/paraglide/messages.js';

  type Desktop = {
    setAdventureInteractive?: (interactive: boolean) => void;
    openInMainWindow?: (path: string) => void;
    setAdventureStrip?: (enabled: boolean) => Promise<unknown>;
  };
  const desktop = (typeof window !== 'undefined' ? (window as unknown as { orkestraiDesktop?: Desktop }).orkestraiDesktop : undefined);

  let workspaceId = $state<string | null>(null);
  let workspaceName = $state('');
  let nodes = $state<AgentNode[]>([]);
  let chosen = $state<Record<string, HeroClassId>>({});
  let progress = $state<AdventureProgress | null>(null);
  let soundLevel = $state<AdventureSoundLevel>('alerts');
  let selected = $state<{ id: string; left: number; top: number } | null>(null);
  let stage = $state<{ quest: (title: string | null) => void } | null>(null);
  let pointerOverHero = false;
  let pointerOverUi = false;

  const party = $derived(buildParty(nodes, agentStatus.agents, chosen));
  const members = $derived(party.map(({ id, classId, leader, activity }) => ({ id, classId, leader, activity })));
  const labels = $derived(Object.fromEntries(party.map((hero) => [hero.id, { id: hero.id, title: hero.title, classId: hero.classId, asks: attentionFeed.byNode[hero.id]?.length ?? 0 }])));
  const card = $derived(selected ? party.find((hero) => hero.id === selected!.id) ?? null : null);
  const cardLive = $derived(card ? agentStatus.agents[card.id] ?? null : null);
  const cardState = $derived(agentStateLabel(cardLive?.sessionAlive ? cardLive.state : 'disconnected'));
  // What the agent is doing, when it says more than its state.
  const cardDoing = $derived.by(() => {
    const doing = cardLive?.sessionAlive ? agentDoingLabel(cardLive) : '';
    return doing && doing !== cardState ? doing : '';
  });

  async function api<T>(url: string, init?: RequestInit): Promise<T> {
    const csrf = getCsrfToken();
    const response = await fetch(url, { ...init, headers: { 'content-type': 'application/json', ...(csrf ? { 'X-CSRF-Token': csrf } : {}), ...(init?.headers ?? {}) } });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error ?? 'request failed');
    return body.data as T;
  }

  /** The workspace to follow: the one in the link, else the one last opened in the app. */
  function pickWorkspace(list: Workspace[]): string | null {
    const requested = new URLSearchParams(location.search).get('workspace');
    let remembered: string | null = null;
    try { remembered = localStorage.getItem('orkestrai.activeWorkspaceId'); } catch { /* private storage */ }
    return list.find((entry) => entry.id === requested)?.id ?? list.find((entry) => entry.id === remembered)?.id ?? list[0]?.id ?? null;
  }

  async function loadNodes(id: string) {
    const list = await api<CanvasNode[]>(`/api/agent-room/workspaces/${encodeURIComponent(id)}/nodes`).catch(() => null);
    if (!list || id !== workspaceId) return;
    nodes = list
      .filter((node) => node.type === 'terminal' && Boolean((node.payload as TerminalNodePayload).provider))
      .map((node) => ({ id: node.id, title: node.title ?? m['canvas.fallback_terminal'](), payload: node.payload as TerminalNodePayload }));
  }

  async function loadWorkspace(id: string) {
    progress = null;
    selected = null;
    const [record] = await Promise.all([
      api<{ progress: AdventureProgress; heroClasses: Record<string, HeroClassId> }>(`/api/agent-room/workspaces/${encodeURIComponent(id)}/adventure`).catch(() => null),
      loadNodes(id),
    ]);
    if (id !== workspaceId) return;
    chosen = record?.heroClasses ?? {};
    progress = record?.progress ?? { stageIndex: 0, wave: 0, xp: 0, gold: 0, kills: 0, bosses: 0, quests: 0 };
  }

  function saveProgress(next: AdventureProgress) {
    const id = workspaceId;
    if (!id) return;
    void api(`/api/agent-room/workspaces/${encodeURIComponent(id)}/adventure`, { method: 'PUT', body: JSON.stringify(next) }).catch(() => undefined);
  }

  async function chooseClass(heroId: string, classId: HeroClassId | null) {
    const id = workspaceId;
    if (!id) return;
    chosen = await api<Record<string, HeroClassId>>(`/api/agent-room/workspaces/${encodeURIComponent(id)}/adventure/heroes/${encodeURIComponent(heroId)}`, { method: 'PUT', body: JSON.stringify({ classId }) }).catch(() => chosen);
  }

  /** Opens a screen of the app: the main window on the desktop, the same tab elsewhere. */
  function open(path: string) {
    selected = null;
    if (desktop?.openInMainWindow) desktop.openInMainWindow(path);
    else location.assign(path);
  }

  function className(id: HeroClassId): string {
    return (m as unknown as Record<string, () => string>)[`adventure.class_${id}`]?.() ?? id;
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
    untrack(() => void loadWorkspace(id));
    const releaseStatus = untrack(() => retainAgentStatus(id));
    const releaseAttention = untrack(() => retainAttentionFeed(id));
    return () => { releaseStatus(); releaseAttention(); };
  });

  $effect(() => {
    void selected;
    untrack(syncInteractive);
  });

  onMount(() => {
    void api<Workspace[]>('/api/agent-room/workspaces').then((list) => {
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
      if (event.key === 'orkestrai.activeWorkspaceId' && event.newValue && event.newValue !== workspaceId) {
        void api<Workspace[]>('/api/agent-room/workspaces').then((list) => {
          workspaceName = list.find((entry) => entry.id === event.newValue)?.name ?? '';
          workspaceId = list.some((entry) => entry.id === event.newValue) ? event.newValue : workspaceId;
        }).catch(() => undefined);
      }
    };
    window.addEventListener('storage', onStorage);

    // Finished tasks become quests; recruits and dismissals change the party.
    let socket: WebSocket | null = null;
    let reconnect: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;
    const connect = () => {
      if (disposed) return;
      socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/agent-room/pty`);
      socket.onopen = () => socket?.send(JSON.stringify({ type: 'subscribe', events: ['channelMessage', 'workspaceChanged', 'attentionChanged'] }));
      socket.onmessage = (message) => {
        let frame: { type?: string; workspaceId?: string; message?: { kind?: string; body?: string; meta?: Record<string, unknown> } };
        try { frame = JSON.parse(String(message.data)); } catch { return; }
        if (!workspaceId || frame.workspaceId !== workspaceId) return;
        if (frame.type === 'channelMessage' && frame.message?.meta?.event === 'task_done') stage?.quest(frame.message.body ?? null);
        if (frame.type === 'workspaceChanged') void loadNodes(workspaceId);
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
  {#if progress && workspaceId}
    {#key workspaceId}
      <AdventureStage
        bind:this={stage}
        party={members}
        {labels}
        {progress}
        {soundLevel}
        onProgress={(next) => saveProgress(next)}
        onSelect={(id, box) => { selected = selected?.id === id ? null : { id, left: box.left + box.width / 2, top: box.top }; }}
        onHover={(id) => { pointerOverHero = id !== null; syncInteractive(); }}
      />
    {/key}
  {/if}

  {#if card && selected}
    <div class="card" data-adventure-interactive role="dialog" aria-label={card.title} style:left={`${Math.max(12, Math.min(selected.left - 150, window.innerWidth - 312))}px`} style:bottom={`${window.innerHeight - selected.top + 10}px`}>
      <header>
        <b>{card.title}</b>
        <span class="class">{card.leader ? `${className(card.classId)} · ${m['adventure.leader']()}` : className(card.classId)}</span>
      </header>
      <p class="state">
        <span class={`dot ${card.activity}`} aria-hidden="true"></span>
        {cardState}
        {#if cardDoing}<span class="doing">{`· ${cardDoing}`}</span>{/if}
      </p>
      {#if (attentionFeed.byNode[card.id]?.length ?? 0) > 0}
        <p class="asks">{m['adventure.asks']({ count: attentionFeed.byNode[card.id].length })}</p>
      {/if}
      {#if !card.leader}
        <label class="pick">
          <span>{m['adventure.class_pick']()}</span>
          <NativeSelect.Root size="sm" class="w-[150px] [&_select]:border-white/15 [&_select]:bg-white/10 [&_select]:text-[#f4ead2]" value={chosen[card.id] ?? ''} onchange={(event: Event) => void chooseClass(card!.id, ((event.currentTarget as HTMLSelectElement).value || null) as HeroClassId | null)} aria-label={m['adventure.class_pick']()}>
            <NativeSelect.Option value="">{m['adventure.class_auto']()}</NativeSelect.Option>
            {#each TEAMMATE_CLASS_IDS as classId (classId)}<NativeSelect.Option value={classId}>{className(classId)}</NativeSelect.Option>{/each}
          </NativeSelect.Root>
        </label>
      {/if}
      <div class="actions">
        <Button variant="ghost" size="sm" class="flex-1 bg-white/10 text-[#f4ead2] hover:bg-white/20 hover:text-[#f4ead2]" onclick={() => open(`/terminal?workspace=${encodeURIComponent(workspaceId ?? '')}&node=${encodeURIComponent(card!.id)}`)}>{m['adventure.open_focus']()}</Button>
        <Button size="sm" class="flex-1 bg-[#e8b84b] text-[#1a1405] hover:bg-[#f0c766]" onclick={() => open(`/chat?workspace=${encodeURIComponent(workspaceId ?? '')}&channel=${encodeURIComponent(`dm:${card!.id}`)}`)}>
          {(attentionFeed.byNode[card.id]?.length ?? 0) > 0 || card.activity === 'attention' ? m['adventure.answer']() : m['adventure.talk']()}
        </Button>
      </div>
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

  .where {
    margin: 0;
    color: rgba(244, 234, 210, 0.55);
  }

  .state,
  .asks {
    margin: 0;
    display: flex;
    align-items: baseline;
    gap: 6px;
    font-size: 12.5px;
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

  .pick {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    font-size: 12px;
    color: rgba(244, 234, 210, 0.75);
  }

  .actions {
    display: flex;
    gap: 6px;
  }
</style>
