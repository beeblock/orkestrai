<script lang="ts">
  import { onMount, tick, untrack, type Snippet } from 'svelte';
  import * as Accordion from '$lib/components/ui/accordion';
  import type { AgentUsageBlock } from '$lib/modules/agent-room/contracts/schemas/agent-runtime.schema.js';
  import { Brain, CalendarClock, Focus, MessageSquare, Network, X } from '@lucide/svelte';
  import AgentAvatar from '../AgentAvatar.svelte';
  import { getCsrfToken } from '@beeblock/svelar/http';
  import { toast } from '@beeblock/svelar/ui';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import AgentGlyph from '../AgentGlyph.svelte';
  import AgentAlwaysOnPanel from './AgentAlwaysOnPanel.svelte';
  import { agentStatus, statusClock } from '../agent-status.svelte.js';
  import { agentTone, elapsedParts, modelFromArgs } from '../agent-identity.js';
  import { agentActionLabel, agentStateLabel, elapsedLabel } from '../agent-status-labels.js';
  import { routineCadence, routineNextRun } from './routine-labels.js';
  import { subscribeKnowledge } from '../knowledge-live.js';
  import type { AgentLesson } from '$lib/modules/agent-room/domain/agent-learning.js';
  import { providerIcons } from '$lib/modules/agent-room/domain/provider-icons.js';
  import type { Routine, TerminalNodePayload, WorkspaceMemoryEntry } from '$lib/modules/agent-room/domain/types.js';
  import * as m from '$lib/paraglide/messages.js';

  let {
    workspaceId,
    nodeId,
    title,
    payload,
    onClose,
    onDirect,
    embedded = false,
    usageBlock = null,
    children: externalChannels,
    instructions,
    security,
    onAutomations,
    onSetupChannel,
  }: {
    workspaceId: string;
    nodeId: string;
    title: string;
    payload: TerminalNodePayload;
    onClose: () => void;
    onDirect: (nodeId: string) => void;
    embedded?: boolean;
    usageBlock?: AgentUsageBlock | null;
    children?: Snippet;
    instructions?: Snippet;
    security?: Snippet;
    onAutomations?: () => void;
    onSetupChannel?: (provider: 'telegram' | 'slack') => void;
  } = $props();

  let detailsOpen = $state<string[]>([]);
  let routinesTrigger = $state<HTMLButtonElement | null>(null);
  const profileScope = $derived(`${workspaceId}:${nodeId}`);
  $effect(() => { void profileScope; untrack(() => { detailsOpen = []; }); });
  export async function openRoutines() {
    detailsOpen = [...new Set([...detailsOpen, 'routines'])];
    await tick();
    routinesTrigger?.scrollIntoView({ block: 'nearest' });
    routinesTrigger?.focus({ preventScroll: true });
  }

  let routineDraft = $state('');
  let routineSending = $state(false);

  // The agent turns the sentence into an automation with its own tools and confirms in Chat.
  async function askRoutine() {
    const sentence = routineDraft.trim();
    if (!sentence || routineSending) return;
    routineSending = true;
    const csrf = getCsrfToken();
    const response = await fetch(`/api/agent-room/workspaces/${encodeURIComponent(workspaceId)}/channels/${encodeURIComponent(`dm:${nodeId}`)}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(csrf ? { 'X-CSRF-Token': csrf } : {}) },
      body: JSON.stringify({ body: m['chat.routine_request']({ sentence }) }),
    }).catch(() => null);
    routineSending = false;
    if (response?.ok) {
      routineDraft = '';
      toast.success(m['chat.routine_sent']({ name: title }));
    } else {
      toast.error(m['chat.send_failed']());
    }
  }

  type ProfileMemory = { id: string; title: string; content: string; updatedAt: string; lesson: boolean };
  let memory = $state<ProfileMemory[]>([]);
  let memoryLoading = $state(true);
  let memoryError = $state(false);
  let retryMemory = () => {};
  let routines = $state<Routine[]>([]);

  const status = $derived(agentStatus.agents[nodeId] ?? null);
  const activity = $derived(usageBlock ? 'blocked' : status ? (status.sessionAlive ? status.state : 'disconnected') : 'idle');
  const sleeping = $derived(!usageBlock && embedded && payload.agentRuntimeMode === 'on_demand' && !status?.sessionAlive
    && (!status || status.state === 'disconnected' || status.state === 'idle'));
  // Only the visible detail panel needs a per-second clock. Do not wake every Canvas node.
  let detailNow = $state(Date.now());
  onMount(() => {
    const timer = setInterval(() => { if (document.visibilityState === 'visible') detailNow = Date.now(); }, 1_000);
    return () => clearInterval(timer);
  });
  const since = $derived.by(() => {
    const parts = status ? elapsedParts(status.stateSince, Math.max(statusClock.now, detailNow)) : null;
    return parts ? elapsedLabel(parts) : null;
  });
  const model = $derived(modelFromArgs(payload.args ?? []));
  const query = $derived(`workspace=${encodeURIComponent(workspaceId)}&node=${encodeURIComponent(nodeId)}`);

  $effect(() => {
    const id = nodeId;
    const workspace = workspaceId;
    const controller = new AbortController();
    let generation = 0;
    let refresh: ReturnType<typeof setTimeout> | undefined;
    memory = [];
    memoryLoading = true;
    memoryError = false;
    routines = [];
    const root = `/api/agent-room/workspaces/${encodeURIComponent(workspace)}`;
    async function loadMemory() {
      const ticket = ++generation;
      try {
        const responses = await Promise.all([
          fetch(`${root}/memory?limit=8&nodeId=${encodeURIComponent(id)}`, { signal: controller.signal }),
          fetch(`${root}/learning?status=active&limit=8&nodeId=${encodeURIComponent(id)}`, { signal: controller.signal }),
        ]);
        if (responses.some(response => !response.ok)) throw new Error('memory_load_failed');
        const [facts, lessons] = await Promise.all(responses.map(response => response.json())) as [
          { data: WorkspaceMemoryEntry[] },
          { data: { agents: Array<{ id: string; mode: string }>; entries: AgentLesson[] } },
        ];
        if (controller.signal.aborted || ticket !== generation) return;
        const learning = lessons.data.agents.find(agent => agent.id === id)?.mode === 'off' ? [] : lessons.data.entries;
        memory = [
          ...facts.data.filter(entry => entry.createdByNodeId === id && entry.status === 'active').map(entry => ({ id: `memory:${entry.id}`, title: entry.title, content: entry.content, updatedAt: entry.updatedAt, lesson: false })),
          ...learning.filter(entry => entry.nodeId === id && entry.status === 'active').map(entry => ({ id: `learning:${entry.id}`, title: entry.title, content: entry.correction, updatedAt: entry.updatedAt, lesson: true })),
        ].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id)).slice(0, 8);
        memoryError = false;
      } catch {
        if (!controller.signal.aborted && ticket === generation) memoryError = true;
      } finally {
        if (!controller.signal.aborted && ticket === generation) memoryLoading = false;
      }
    }
    const scheduleMemory = () => { clearTimeout(refresh); refresh = setTimeout(() => void loadMemory(), 180); };
    retryMemory = () => { memoryLoading = true; void loadMemory(); };
    const unsubscribe = subscribeKnowledge(workspace, scheduleMemory, () => {}, ['memoryChanged']);
    void loadMemory();
    let routineTicket = 0, routineTimer: ReturnType<typeof setTimeout> | undefined;
    const loadRoutines = () => {
      clearTimeout(routineTimer);
      routineTimer = setTimeout(async () => {
        const ticket = ++routineTicket;
        try {
          const response = await fetch(`${root}/routines`, { signal: controller.signal });
          if (!response.ok) return;
          const body = await response.json() as { data?: Routine[] };
          if (!controller.signal.aborted && ticket === routineTicket) routines = (body.data ?? []).filter(routine => routine.targetNodeId === id);
        } catch { /* Keep the last confirmed snapshot until reconnection. */ }
      }, 150);
    };
    const releaseRoutines = subscribeKnowledge(workspace, loadRoutines, () => {}, ['routinesChanged']);
    loadRoutines();
    return () => { controller.abort(); clearTimeout(refresh); clearTimeout(routineTimer); unsubscribe(); releaseRoutines(); retryMemory = () => {}; };
  });
</script>

{#snippet factsContent()}
  <dl class="facts">
    {#if payload.provider}
      <dt>{m['chat.profile_provider']()}</dt>
      <dd>
        {#if providerIcons[payload.provider]}<span class="app-logo-plate mark"><img src={providerIcons[payload.provider]} width="12" height="12" alt="" /></span>{/if}
        {payload.provider}{#if model}{` · ${model}`}{/if}
      </dd>
    {/if}
    {#if status?.currentTask}
      <dt>{m['chat.profile_task']()}</dt>
      <dd>{status.currentTask.title}</dd>
    {/if}
    {#if agentActionLabel(status?.lastAction, status?.lastActionData)}
      <dt>{m['chat.profile_doing']()}</dt>
      <dd>{agentActionLabel(status?.lastAction, status?.lastActionData)}</dd>
    {/if}
    {#if status?.floorName}
      <dt>{m['chat.profile_floor']()}</dt>
      <dd>{status.floorName}</dd>
    {/if}
  </dl>
{/snippet}
{#snippet routinesContent(showHeading: boolean)}
  <section>
    {#if showHeading}<h3><CalendarClock size={13} />{m['chat.profile_routines']()}</h3>{/if}
    {#if routines.length}
      <ul>
        {#each routines as routine (routine.id)}
          <li class="routine" class:off={!routine.enabled}>
            <b>{routine.name}</b>
            <span>{[routineCadence(routine), routineNextRun(routine), routine.runCount ? m['chat.routine_runs']({ count: routine.runCount }) : null].filter(Boolean).join(' · ')}</span>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="empty">{m['chat.profile_routines_empty']()}</p>
    {/if}
    <form class="routine-form" onsubmit={(event) => { event.preventDefault(); void askRoutine(); }}>
      <Input bind:value={routineDraft} placeholder={m['chat.routine_placeholder']()} aria-label={m['chat.routine_label']()} />
      <Button size="sm" type="submit" disabled={!routineDraft.trim() || routineSending}>{m['chat.routine_create']()}</Button>
    </form>
  </section>
{/snippet}
{#snippet memoryContent(showHeading: boolean)}
  <section>
    {#if showHeading}<h3><Brain size={13} />{m['chat.profile_memory']()}</h3>{/if}
    {#if memoryLoading}
      <p class="empty" role="status">{m['chat.profile_memory_loading']()}</p>
    {:else if memoryError}
      <p class="empty" role="alert">{m['chat.profile_memory_error']()}</p>
      <Button size="sm" variant="outline" onclick={() => retryMemory()}>{m['chat.profile_memory_retry']()}</Button>
    {:else if memory.length}
      <ul>
        {#each memory as entry (entry.id)}<li title={entry.content}><b>{entry.title}</b>{#if entry.lesson}<span>{m['learning.active']()}</span>{/if}<span>{entry.content}</span></li>{/each}
      </ul>
    {:else}
      <p class="empty">{m['chat.profile_memory_empty']()}</p>
    {/if}
  </section>
{/snippet}

<aside class="profile" class:embedded aria-label={m['chat.profile_label']({ name: title })}>
  {#if !embedded}
    <header><button type="button" class="close" onclick={onClose} aria-label={m['chat.profile_close']()}><X size={14} /></button></header>
  <div class="identity">
    <AgentAvatar {nodeId} {title} size={56} />
    <h2 class="headline">{title}</h2>
    {#if payload.role}<p class="role">{payload.role}</p>{/if}
    <p class="status" data-testid="agent-profile-status"><AgentGlyph tone={agentTone(sleeping ? 'idle' : activity)} label={usageBlock ? m['bots.quota_paused']() : sleeping ? m['agent_runtime.sleeping']() : agentStateLabel(activity)} /> {usageBlock ? m['bots.quota_paused']() : sleeping ? m['agent_runtime.sleeping']() : agentStateLabel(activity)}{#if since && !sleeping}{` · ${since}`}{/if}</p>
  </div>
  {#if !embedded}<div class="actions">
    <button type="button" onclick={() => onDirect(nodeId)}><MessageSquare size={13} />{m['chat.profile_direct']()}</button>
    <a href={`/canvas?${query}`}><Network size={13} />{m['workspace_view.canvas']()}</a>
    <a href={`/terminal?${query}`}><Focus size={13} />{m['node_quickbar.focus']()}</a>
  </div>{/if}

    {@render factsContent()}
    {@render routinesContent(true)}
  {:else}
    <p class="status" data-testid="agent-profile-status"><AgentGlyph tone={agentTone(sleeping ? 'idle' : activity)} label={usageBlock ? m['bots.quota_paused']() : sleeping ? m['agent_runtime.sleeping']() : agentStateLabel(activity)} /> {usageBlock ? m['bots.quota_paused']() : sleeping ? m['agent_runtime.sleeping']() : agentStateLabel(activity)}{#if since && !sleeping}{` · ${since}`}{/if}</p>
  {/if}
  <AgentAlwaysOnPanel {workspaceId} {nodeId} {payload} botEvents={embedded} botTitle={title} {onSetupChannel}>
    {#snippet children({ runtime, channels, activity })}
      {#if embedded}
        <section class="bot-channels" aria-label={m['bots.profile_channels']()}>
          <h3>{m['bots.profile_channels']()}</h3>
          {@render externalChannels?.()}
          {@render channels(false)}
        </section>
        <Accordion.Root type="multiple" bind:value={detailsOpen} class="min-w-0 gap-1">
          <Accordion.Item value="routines" class="min-w-0 border-0">
            <Accordion.Trigger bind:ref={routinesTrigger} class="min-w-0 gap-2">{m['chat.profile_routines']()}</Accordion.Trigger>
            <Accordion.Content class="min-w-0">
              {@render routinesContent(false)}
              {#if onAutomations}<Button variant="outline" size="sm" class="mt-3 h-auto min-h-8 w-full min-w-0 whitespace-normal" onclick={onAutomations}>{m['bots.automations']()}</Button>{/if}
            </Accordion.Content>
          </Accordion.Item>
          {#if instructions}<Accordion.Item value="instructions" class="min-w-0 border-0">
            <Accordion.Trigger class="min-w-0 gap-2">{m['bots.instructions']()}</Accordion.Trigger>
            <Accordion.Content class="min-w-0">{@render instructions()}</Accordion.Content>
          </Accordion.Item>{/if}
          <Accordion.Item value="runtime" class="min-w-0 border-0">
            <Accordion.Trigger class="min-w-0 gap-2">{m['bots.profile_runtime']()}</Accordion.Trigger>
            <Accordion.Content class="min-w-0"><div class="grid min-w-0 gap-3">{@render factsContent()}{@render runtime(false)}</div></Accordion.Content>
          </Accordion.Item>
          {#if security}<Accordion.Item value="security" class="min-w-0 border-0">
            <Accordion.Trigger class="min-w-0 gap-2">{m['bots.profile_security']()}</Accordion.Trigger>
            <Accordion.Content class="min-w-0">{@render security()}</Accordion.Content>
          </Accordion.Item>{/if}
          <Accordion.Item value="activity" class="min-w-0 border-0">
            <Accordion.Trigger class="min-w-0 gap-2">{m['always_on.recent']()}</Accordion.Trigger>
            <Accordion.Content class="min-w-0">{@render activity(false)}</Accordion.Content>
          </Accordion.Item>
          <Accordion.Item value="memory" class="min-w-0 border-0">
            <Accordion.Trigger class="min-w-0 gap-2">{m['chat.profile_memory']()}</Accordion.Trigger>
            <Accordion.Content class="min-w-0">{@render memoryContent(false)}</Accordion.Content>
          </Accordion.Item>
        </Accordion.Root>
      {:else}
        {@render runtime(true)}
        {@render channels(true)}
        {@render activity(true)}
      {/if}
    {/snippet}
  </AgentAlwaysOnPanel>
  {#if !embedded}{@render externalChannels?.()}{@render memoryContent(true)}{/if}
</aside>

<style>
  .profile.embedded { width: 100%; min-inline-size: 0; max-inline-size: 100%; border-left: 0; padding: 0; overflow: visible; }
  .profile {
    min-inline-size: 0;
    overflow-wrap: anywhere;
    width: 320px;
    flex: none;
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding: 12px 16px 20px;
    overflow-y: auto;
    border-left: 1px solid var(--app-border);
    background: var(--app-sidebar);
  }

  header {
    display: flex;
    justify-content: flex-end;
  }

  .close {
    width: 26px;
    height: 26px;
    display: grid;
    place-items: center;
    border: 0;
    border-radius: 7px;
    background: transparent;
    color: var(--app-text-muted);
    cursor: pointer;
  }

  .close:hover {
    background: var(--app-hover);
    color: var(--app-text);
  }

  .identity {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    text-align: center;
  }

  .identity h2 {
    margin: 6px 0 0;
    font-size: 26px;
    color: var(--app-text);
  }

  .role {
    margin: 0;
    color: var(--app-text-soft);
    font-size: 13px;
  }

  .status {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin: 0;
    color: var(--app-text-muted);
    font-size: 12px;
  }

  .actions {
    display: flex;
    justify-content: center;
    gap: 6px;
  }

  .actions button,
  .actions a {
    height: 30px;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 0 10px;
    border: 0;
    border-radius: 8px;
    background: var(--app-hover);
    color: var(--app-text);
    font: inherit;
    font-size: 12.5px;
    text-decoration: none;
    cursor: pointer;
  }

  .actions button:hover,
  .actions a:hover {
    background: var(--app-active);
  }

  .actions button:focus-visible,
  .actions a:focus-visible,
  .close:focus-visible {
    outline: 2px solid var(--app-accent);
    outline-offset: 2px;
  }

  .facts {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 6px 12px;
    margin: 0;
    font-size: 12.5px;
  }

  dt {
    color: var(--app-text-muted);
  }

  dd {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    margin: 0;
    color: var(--app-text);
    overflow-wrap: anywhere;
  }

  .mark {
    width: 18px;
    height: 18px;
    display: inline-grid;
    place-items: center;
    border-radius: 5px;
  }

  section h3 {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0 0 8px;
    color: var(--app-text-muted);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  ul {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  li {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 8px 10px;
    border-radius: 9px;
    background: var(--app-surface);
    box-shadow: inset 0 0 0 1px var(--app-border);
    font-size: 12.5px;
  }

  li b {
    color: var(--app-text);
    font-weight: 600;
  }

  li span {
    overflow: hidden;
    color: var(--app-text-soft);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
  }

  .routine.off b {
    color: var(--app-text-muted);
  }

  .profile > :global(*), .bot-channels > :global(*) { min-inline-size: 0; }
  .bot-channels { display: flex; flex-direction: column; gap: 16px; min-inline-size: 0; }
  .routine-form :global(input) { flex: 1; min-inline-size: 0; inline-size: 0; }
  .routine-form :global(button) { flex: none; }

  .routine-form {
    display: flex;
    gap: 6px;
    margin-top: 8px;
  }

  .empty {
    margin: 0;
    color: var(--app-text-muted);
    font-size: 12.5px;
  }
</style>
