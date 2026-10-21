<script lang="ts">
  import type { Node } from '@xyflow/svelte';
  import { MessagesSquare, Network, PanelsTopLeft, Search, Crosshair } from '@lucide/svelte';
  import * as Dialog from '$lib/components/ui/dialog';
  import AgentAvatar from '../AgentAvatar.svelte';
  import StatusPill from '../StatusPill.svelte';
  import { agentStatus, statusClock } from '../agent-status.svelte.js';
  import { attentionFeed } from '../attention-feed.svelte.js';
  import { agentColor, agentTone, elapsedParts, type AgentTone } from '../agent-identity.js';
  import { agentActionLabel, agentStateLabel, elapsedLabel } from '../agent-status-labels.js';
  import { providerIcons } from '$lib/modules/agent-room/domain/provider-icons.js';
  import * as m from '$lib/paraglide/messages.js';

  /**
   * The whole team at a glance: who leads, the named groups and every agent
   * with its state. Filters narrow the tree; a click inspects, a double click
   * flies the canvas to that node.
   */
  let {
    open = $bindable(false),
    nodes,
    onJump,
    onOpenFocus,
    onChat,
  }: {
    open?: boolean;
    nodes: Node[];
    onJump: (nodeId: string) => void;
    onOpenFocus: (nodeId: string) => void;
    onChat: (nodeId: string) => void;
  } = $props();

  type Filter = 'all' | 'working' | 'attention' | 'idle' | 'done';
  type Agent = { id: string; title: string; role: string | null; provider: string | null; state: string; tone: AgentTone; since: string | null; groupId: string | null; leader: boolean; task: string | null; action: string | null; floor: string | null };
  type Group = { id: string; title: string; tint: string; agents: Agent[] };

  let filter = $state<Filter>('all');
  let query = $state('');
  let selectedId = $state<string | null>(null);

  const ROW = 54;
  const PAD = 26;

  const model = $derived.by(() => {
    const groups = nodes.filter((node) => node.type === 'group');
    const membership = new Map<string, string>();
    for (const group of groups) {
      for (const memberId of ((group.data as { payload?: { members?: string[] } }).payload?.members ?? [])) {
        if (!membership.has(memberId)) membership.set(memberId, group.id);
      }
    }
    const agents: Agent[] = nodes
      .filter((node) => node.type === 'terminal' && (node.data as { payload?: { provider?: string } }).payload?.provider)
      .map((node) => {
        const payload = (node.data as { payload?: { provider?: string; role?: string | null; maestro?: boolean } }).payload ?? {};
        const live = agentStatus.agents[node.id];
        const state = live ? (live.sessionAlive ? live.state : 'disconnected') : 'idle';
        return {
          id: node.id,
          title: String((node.data as { title?: string }).title ?? ''),
          role: payload.role ?? live?.role ?? null,
          provider: payload.provider ?? null,
          state,
          tone: agentTone(state as never),
          since: live?.stateSince ?? null,
          groupId: membership.get(node.id) ?? null,
          leader: Boolean(payload.maestro),
          task: live?.currentTask?.title ?? null,
          action: agentActionLabel(live?.lastAction, live?.lastActionData),
          floor: live?.floorName ?? null,
        };
      });
    const groupList: Group[] = groups
      .map((group) => ({ id: group.id, title: String((group.data as { title?: string }).title ?? ''), tint: agentColor(group.id).bg, agents: agents.filter((agent) => agent.groupId === group.id) }))
      .filter((group) => group.agents.length);
    const loose = agents.filter((agent) => !agent.groupId);
    if (loose.length) groupList.push({ id: 'loose', title: m['orchestrator.ungrouped'](), tint: 'var(--app-text-muted)', agents: loose });
    const leader = agents.find((agent) => agent.leader) ?? null;
    const orchestrator = nodes.find((node) => node.type === 'orchestrator') ?? null;
    return { agents, groups: groupList, leader, orchestrator, loops: nodes.filter((node) => node.type === 'loop').length };
  });

  function bucket(tone: AgentTone): Exclude<Filter, 'all'> {
    if (tone === 'working') return 'working';
    if (tone === 'attention' || tone === 'blocked') return 'attention';
    if (tone === 'done') return 'done';
    return 'idle';
  }

  const counts = $derived.by(() => {
    const result: Record<Filter, number> = { all: model.agents.length, working: 0, attention: 0, idle: 0, done: 0 };
    for (const agent of model.agents) result[bucket(agent.tone)] += 1;
    return result;
  });

  function visible(agent: Agent): boolean {
    if (filter !== 'all' && bucket(agent.tone) !== filter) return false;
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return true;
    const group = model.groups.find((item) => item.id === agent.groupId);
    return [agent.title, agent.role ?? '', group?.title ?? ''].some((text) => text.toLocaleLowerCase().includes(needle));
  }

  // Layout: one column per level; each group sits beside the middle of its agents.
  const layout = $derived.by(() => {
    let y = PAD;
    const groups = model.groups.map((group) => {
      const start = y;
      const agents = group.agents.map((agent) => {
        const item = { agent, y: y + ROW / 2 };
        y += ROW;
        return item;
      });
      y += 18;
      return { group, y: start + (agents.length * ROW) / 2, agents };
    });
    const height = Math.max(y + PAD, 360);
    return { groups, height, rootY: height / 2 };
  });

  const selected = $derived(model.agents.find((agent) => agent.id === selectedId) ?? null);
  const selectedGroup = $derived(selected ? null : model.groups.find((group) => group.id === selectedId) ?? null);
  const rootTitle = $derived(model.orchestrator ? m['orchestrator.title']() : model.leader?.title ?? m['team_map.root_team']());

  function curve(x1: number, y1: number, x2: number, y2: number): string {
    const mid = (x1 + x2) / 2;
    return `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`;
  }

  function go(nodeId: string) {
    open = false;
    onJump(nodeId);
  }

  function since(value: string | null): string {
    const parts = elapsedParts(value, statusClock.now);
    return parts ? elapsedLabel(parts) : '—';
  }

  const PROVIDER_NAMES: Record<string, string> = { claude: 'Claude', codex: 'Codex', kimi: 'Kimi', opencode: 'OpenCode', cursor: 'Cursor', antigravity: 'Antigravity', cline: 'Cline', devin: 'Devin', copilot: 'Copilot', gemini: 'Gemini', qwen: 'Qwen', aider: 'Aider', goose: 'goose', amp: 'Amp' };

  const filters: Array<[Filter, () => string]> = [
    ['all', () => m['team_map.filter_all']()],
    ['working', () => m['team_map.filter_working']()],
    ['attention', () => m['team_map.filter_attention']()],
    ['idle', () => m['team_map.filter_idle']()],
    ['done', () => m['team_map.filter_done']()],
  ];
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="team-map sm:max-w-[min(1120px,94vw)]" data-testid="team-map">
    <header class="map-head">
      <span class="map-icon" aria-hidden="true"><Network size={17} /></span>
      <div class="min-w-0">
        <Dialog.Title class="map-title">{m['team_map.title']()}</Dialog.Title>
        <Dialog.Description class="map-sub">{m['team_map.subtitle']({ groups: model.groups.filter((group) => group.id !== 'loose').length, agents: model.agents.length, working: counts.working })}</Dialog.Description>
      </div>
    </header>

    <div class="map-tools">
      <div class="filters" role="radiogroup" aria-label={m['team_map.title']()}>
        {#each filters as [value, label] (value)}
          <button type="button" role="radio" aria-checked={filter === value} class="filter" class:on={filter === value} data-filter={value} onclick={() => (filter = value)}>
            {#if value !== 'all'}<span class="fdot" data-filter={value} aria-hidden="true"></span>{/if}
            {label()} <span class="num">{counts[value]}</span>
          </button>
        {/each}
      </div>
      <label class="search">
        <Search size={13} aria-hidden="true" />
        <input bind:value={query} placeholder={m['team_map.search']()} aria-label={m['team_map.search']()} />
      </label>
    </div>

    <div class="map-body">
      <div class="graph" role="tree" aria-label={m['team_map.title']()}>
        {#if model.agents.length === 0}
          <p class="graph-empty">{m['team_map.empty']()}</p>
        {:else}
          <div class="canvas" style:height={`${layout.height}px`}>
            <svg class="wires" width="100%" height={layout.height} viewBox={`0 0 720 ${layout.height}`} preserveAspectRatio="none" aria-hidden="true">
              {#each layout.groups as entry (entry.group.id)}
                <path d={curve(190, layout.rootY, 300, entry.y)} class="wire" class:dim={!entry.agents.some((item) => visible(item.agent))} />
                {#each entry.agents as item (item.agent.id)}
                  <path d={curve(440, entry.y, 520, item.y)} class="wire" class:hot={item.agent.tone === 'working'} class:dim={!visible(item.agent)} />
                {/each}
              {/each}
            </svg>
            <button type="button" class="root" style:top={`${layout.rootY}px`} onclick={() => (selectedId = null)}>
              {#if model.orchestrator}<span class="orb" aria-hidden="true"></span>{:else if model.leader}<AgentAvatar nodeId={model.leader.id} title={model.leader.title} size={22} />{/if}
              <span class="root-name">{rootTitle}</span>
              <span class="num">{model.agents.length}</span>
            </button>
            {#each layout.groups as entry (entry.group.id)}
              <button type="button" class="group" class:sel={selectedId === entry.group.id} style:top={`${entry.y}px`} style:--tint={entry.group.tint} onclick={() => (selectedId = entry.group.id)} ondblclick={() => entry.group.id !== 'loose' && go(entry.group.id)}>
                <span class="gdot" aria-hidden="true"></span>
                <span class="gname">{entry.group.title}</span>
                <span class="num">{entry.agents.filter((item) => item.agent.tone === 'working').length}/{entry.agents.length}</span>
              </button>
              {#each entry.agents as item (item.agent.id)}
                <button type="button" role="treeitem" aria-selected={selectedId === item.agent.id} class="agent" class:sel={selectedId === item.agent.id} class:dim={!visible(item.agent)} style:top={`${item.y}px`} onclick={() => (selectedId = item.agent.id)} ondblclick={() => go(item.agent.id)}>
                  <AgentAvatar nodeId={item.agent.id} title={item.agent.title} size={22} />
                  <span class="aname">
                    <b>{item.agent.title}</b>
                    <small>{item.agent.task ?? item.agent.role ?? agentStateLabel(item.agent.state as never)}</small>
                  </span>
                  <StatusPill tone={item.agent.tone} label={agentStateLabel(item.agent.state as never)} compact />
                </button>
              {/each}
            {/each}
          </div>
          {#if !model.agents.some(visible)}<p class="graph-empty overlay">{m['team_map.no_match']()}</p>{/if}
        {/if}
      </div>

      <aside class="side">
        {#if selected}
          {@const pending = attentionFeed.byNode[selected.id]?.length ?? 0}
          <div class="who">
            <AgentAvatar nodeId={selected.id} title={selected.title} size={40} />
            <div class="min-w-0">
              <h3>{selected.title}</h3>
              <StatusPill tone={selected.tone} label={agentStateLabel(selected.state as never)} />
            </div>
          </div>
          <button type="button" class="primary" onclick={() => go(selected.id)}><Crosshair size={14} />{m['team_map.go']()}</button>
          <div class="row-actions">
            <button type="button" class="ghost" onclick={() => { open = false; onOpenFocus(selected.id); }}><PanelsTopLeft size={13} />{m['team_map.focus']()}</button>
            <button type="button" class="ghost" onclick={() => { open = false; onChat(selected.id); }}><MessagesSquare size={13} />{m['team_map.chat']()}</button>
          </div>
          <dl class="kv">
            <dt>{m['team_map.state']()}</dt><dd>{agentStateLabel(selected.state as never)}</dd>
            <dt>{m['team_map.since']()}</dt><dd>{since(selected.since)}</dd>
            {#if selected.provider}<dt>{m['team_map.provider']()}</dt><dd class="prov">{#if providerIcons[selected.provider]}<img src={providerIcons[selected.provider]} width="12" height="12" alt="" class="app-logo-plate" />{/if}{PROVIDER_NAMES[selected.provider] ?? selected.provider}</dd>{/if}
            {#if selected.role}<dt>{m['team_map.role']()}</dt><dd>{selected.role}</dd>{/if}
            {#if selected.groupId}<dt>{m['team_map.group']()}</dt><dd>{model.groups.find((group) => group.id === selected.groupId)?.title}</dd>{/if}
            {#if pending}<dt>{m['team_map.pending']()}</dt><dd class="warn">{pending}</dd>{/if}
          </dl>
          {#if selected.action}<p class="last">{selected.action}</p>{/if}
        {:else if selectedGroup}
          <div class="who">
            <span class="gbig" style:--tint={selectedGroup.tint} aria-hidden="true"></span>
            <div class="min-w-0"><h3>{selectedGroup.title}</h3><span class="muted">{m['group.team_stats']({ count: selectedGroup.agents.length, working: selectedGroup.agents.filter((agent) => agent.tone === 'working').length })}</span></div>
          </div>
          {#if selectedGroup.id !== 'loose'}<button type="button" class="primary" onclick={() => go(selectedGroup.id)}><Crosshair size={14} />{m['team_map.go_group']()}</button>{/if}
        {:else}
          <p class="label">{m['team_map.fleet']()}</p>
          <div class="stat-card">
            {#each filters.slice(1) as [value, label] (value)}
              <button type="button" class="stat" onclick={() => (filter = value)}>
                <span class="fdot" data-filter={value} aria-hidden="true"></span><span class="grow">{label()}</span><span class="num">{counts[value]}</span>
              </button>
            {/each}
          </div>
          <p class="label">{m['team_map.structure']()}</p>
          <div class="stat-card">
            <div class="stat"><span class="grow">{m['team_map.leaders']()}</span><span class="num">{model.agents.filter((agent) => agent.leader).length}</span></div>
            <div class="stat"><span class="grow">{m['team_map.groups']()}</span><span class="num">{model.groups.filter((group) => group.id !== 'loose').length}</span></div>
            <div class="stat"><span class="grow">{m['team_map.agents']()}</span><span class="num">{model.agents.length}</span></div>
            <div class="stat"><span class="grow">{m['team_map.loops']()}</span><span class="num">{model.loops}</span></div>
          </div>
          <p class="hint">{m['team_map.hint']()}</p>
        {/if}
      </aside>
    </div>
  </Dialog.Content>
</Dialog.Root>

<style>
  :global(.team-map) {
    width: min(1120px, 94vw);
    max-height: min(760px, 88vh);
    display: flex !important;
    flex-direction: column;
    gap: 0 !important;
    padding: 0 !important;
    overflow: hidden;
    border-radius: 22px !important;
    background: var(--app-glass-strong) !important;
    -webkit-backdrop-filter: blur(26px) saturate(170%);
    backdrop-filter: blur(26px) saturate(170%);
    border: 1px solid var(--app-glass-line);
    box-shadow: var(--app-glass-shadow) !important;
  }

  .map-head {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 18px 22px 12px;
  }

  .map-icon {
    width: 36px;
    height: 36px;
    display: grid;
    place-items: center;
    border-radius: 11px;
    background: color-mix(in srgb, var(--app-accent) 14%, transparent);
    color: var(--app-accent);
  }

  :global(.map-title) {
    margin: 0;
    font-family: var(--font-headline);
    font-stretch: 62%;
    font-size: 30px;
    font-weight: 700;
    line-height: 1;
  }

  :global(.map-sub) {
    margin: 4px 0 0;
    color: var(--app-text-muted);
    font-size: 12.5px;
  }

  .map-tools {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0 22px 12px;
    flex-wrap: wrap;
  }

  .filters {
    display: flex;
    gap: 4px;
    flex-wrap: wrap;
  }

  .filter {
    height: 28px;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 0 11px;
    border: 1px solid var(--app-glass-line);
    border-radius: 999px;
    background: transparent;
    color: var(--app-text-soft);
    font-size: 12.5px;
  }

  .filter:hover {
    color: var(--app-text);
    background: var(--app-hover);
  }

  .filter.on {
    border-color: transparent;
    background: var(--app-accent);
    color: var(--app-accent-contrast);
    font-weight: 600;
  }

  .num {
    font-family: var(--font-mono);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    opacity: 0.8;
  }

  .fdot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--app-text-muted);
    flex: none;
  }

  .fdot[data-filter='working'] { background: var(--app-accent); }
  .fdot[data-filter='attention'] { background: var(--app-warning); }
  .fdot[data-filter='done'] { background: var(--app-success); }

  .search {
    margin-left: auto;
    width: 240px;
    height: 30px;
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 0 11px;
    border-radius: 999px;
    border: 1px solid var(--app-glass-line);
    color: var(--app-text-muted);
  }

  .search input {
    flex: 1;
    min-width: 0;
    border: 0;
    outline: none;
    background: transparent;
    color: var(--app-text);
    font-size: 12.5px;
  }

  .map-body {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: minmax(0, 1fr) 280px;
    border-top: 1px solid var(--app-glass-line);
  }

  .graph {
    position: relative;
    min-height: 360px;
    overflow: auto;
    background:
      radial-gradient(color-mix(in srgb, var(--app-text) 7%, transparent) 1px, transparent 1.2px) 0 0 / 22px 22px;
  }

  .canvas {
    position: relative;
    min-width: 720px;
  }

  .wires {
    position: absolute;
    inset: 0;
  }

  .wire {
    fill: none;
    stroke: color-mix(in srgb, var(--app-text) 22%, transparent);
    stroke-width: 1.3;
    stroke-dasharray: 3 5;
    transition: opacity var(--duration-quick) ease-out;
  }

  .wire.hot {
    stroke: var(--app-accent);
    stroke-dasharray: none;
    opacity: 0.85;
  }

  .wire.dim {
    opacity: 0.2;
  }

  .root,
  .group,
  .agent {
    position: absolute;
    transform: translateY(-50%);
    display: flex;
    align-items: center;
    gap: 8px;
    border: 1px solid var(--app-glass-line);
    background: var(--app-surface);
    color: var(--app-text);
    text-align: left;
    box-shadow: 0 6px 18px color-mix(in srgb, #000 22%, transparent);
    transition: border-color var(--duration-quick) ease-out, opacity var(--duration-quick) ease-out, transform var(--duration-quick) var(--ease-smooth-out);
  }

  .root {
    left: 3%;
    width: 22%;
    min-width: 150px;
    height: 46px;
    padding: 0 12px;
    border-radius: 14px;
    border-color: color-mix(in srgb, var(--app-accent) 40%, transparent);
  }

  .root-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 600;
  }

  .orb {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    flex: none;
    background: radial-gradient(circle at 35% 30%, #fff3c4 0, #f2c45c 32%, #d98a2b 70%, #8a4a12 100%);
    box-shadow: 0 0 10px color-mix(in srgb, #f2b445 55%, transparent);
  }

  .group {
    left: 41.6%;
    width: 19.4%;
    min-width: 130px;
    height: 34px;
    padding: 0 10px;
    border-radius: 999px;
    border-color: color-mix(in srgb, var(--tint) 45%, transparent);
    font-family: var(--font-mono);
    font-size: 11.5px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  .gdot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--tint);
    flex: none;
  }

  .gname {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .agent {
    left: 72.2%;
    width: 26%;
    min-width: 170px;
    height: 44px;
    padding: 0 8px;
    border-radius: 12px;
  }

  .aname {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    line-height: 1.2;
  }

  .aname b {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12.5px;
    font-weight: 600;
  }

  .aname small {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--app-text-muted);
    font-size: 11px;
  }

  .agent:hover,
  .group:hover,
  .root:hover {
    border-color: color-mix(in srgb, var(--app-text) 24%, transparent);
  }

  .agent.sel,
  .group.sel {
    border-color: var(--app-accent);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--app-accent) 16%, transparent), 0 6px 18px color-mix(in srgb, #000 22%, transparent);
  }

  .agent.dim {
    opacity: 0.32;
  }

  .agent:focus-visible,
  .group:focus-visible,
  .root:focus-visible {
    outline: 2px solid var(--app-accent);
    outline-offset: 2px;
  }

  .graph-empty {
    margin: 0;
    padding: 60px 20px;
    text-align: center;
    color: var(--app-text-muted);
  }

  .graph-empty.overlay {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    pointer-events: none;
  }

  .side {
    min-height: 0;
    overflow-y: auto;
    padding: 16px;
    border-left: 1px solid var(--app-glass-line);
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .label {
    margin: 4px 0 0;
    color: var(--app-text-muted);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  .stat-card {
    display: flex;
    flex-direction: column;
    padding: 4px;
    border-radius: 14px;
    border: 1px solid var(--app-glass-line);
    background: color-mix(in srgb, var(--app-surface) 50%, transparent);
  }

  .stat {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 32px;
    padding: 0 10px;
    border: 0;
    border-radius: 10px;
    background: transparent;
    color: var(--app-text-soft);
    font-size: 12.5px;
    text-align: left;
  }

  button.stat:hover {
    background: var(--app-hover);
    color: var(--app-text);
  }

  .grow {
    flex: 1;
  }

  .stat .num {
    color: var(--app-text);
    opacity: 1;
    font-size: 12px;
  }

  .hint {
    margin: 4px 0 0;
    color: var(--app-text-muted);
    font-size: 12px;
    line-height: 1.5;
  }

  .who {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .who h3 {
    margin: 0 0 4px;
    font-size: 15px;
    font-weight: 650;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .muted {
    color: var(--app-text-muted);
    font-size: 12px;
  }

  .gbig {
    width: 40px;
    height: 40px;
    border-radius: 12px;
    background: color-mix(in srgb, var(--tint) 30%, transparent);
    border: 1px solid var(--tint);
  }

  .primary {
    height: 34px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
    border: 0;
    border-radius: 999px;
    background: var(--app-accent);
    color: var(--app-accent-contrast);
    font-weight: 600;
    font-size: 13px;
    box-shadow: 0 6px 18px color-mix(in srgb, var(--app-accent) 26%, transparent);
  }

  .row-actions {
    display: flex;
    gap: 6px;
  }

  .ghost {
    flex: 1;
    height: 30px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    border: 1px solid var(--app-glass-line);
    border-radius: 999px;
    background: transparent;
    color: var(--app-text-soft);
    font-size: 12px;
  }

  .ghost:hover {
    background: var(--app-hover);
    color: var(--app-text);
  }

  .kv {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 7px 12px;
    margin: 4px 0 0;
    font-size: 12px;
  }

  .kv dt {
    color: var(--app-text-muted);
  }

  .kv dd {
    margin: 0;
    color: var(--app-text);
    text-align: right;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .kv dd.prov {
    display: inline-flex;
    justify-content: flex-end;
    align-items: center;
    gap: 6px;
  }

  .kv dd.warn {
    color: var(--app-warning);
    font-weight: 600;
  }

  .last {
    margin: 0;
    padding: 10px;
    border-radius: 10px;
    background: var(--app-hover);
    color: var(--app-text-soft);
    font-family: var(--font-mono);
    font-size: 11.5px;
    line-height: 1.5;
    overflow-wrap: anywhere;
  }

  @media (max-width: 900px) {
    .map-body {
      grid-template-columns: 1fr;
    }

    .side {
      border-left: 0;
      border-top: 1px solid var(--app-glass-line);
    }
  }
</style>
