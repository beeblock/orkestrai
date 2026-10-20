<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import { goto } from '$app/navigation';
  import { getCsrfToken } from '@beeblock/svelar/http';
  import { ArrowUp, AtSign, CheckCheck, Clock3, CornerDownRight, Hash, LoaderCircle, Mic, PanelRightOpen, Plus, Smartphone, UserRound } from '@lucide/svelte';
  import AgentAvatar from '$lib/components/agent-room/AgentAvatar.svelte';
  import AgentGlyph from '$lib/components/agent-room/AgentGlyph.svelte';
  import MarkdownView from '$lib/components/agent-room/MarkdownView.svelte';
  import { routineCadence, routineNextRun } from '$lib/components/agent-room/chat/routine-labels.js';
  import NodeEmptyState from '$lib/components/agent-room/canvas/NodeEmptyState.svelte';
  import ComposerVoice from '$lib/components/agent-room/canvas/ComposerVoice.svelte';
  import { TEXT_DICTATION_COMMAND } from '$lib/components/agent-room/text-dictation.js';
  import QuestionCard from '$lib/components/agent-room/chat/QuestionCard.svelte';
  import RequestCard from '$lib/components/agent-room/chat/RequestCard.svelte';
  import NeedsYouList from '$lib/components/agent-room/NeedsYouList.svelte';
  import type { AgentAttentionItem } from '$lib/modules/agent-room/domain/types.js';
  import AgentProfilePanel from '$lib/components/agent-room/chat/AgentProfilePanel.svelte';
  import { answersByQuestion, buildTimeline, mergeLoaded, mergeOlder, oldestCreatedAt, upsertMessage } from '$lib/components/agent-room/chat/chat-timeline.js';
  import { agentStatus, retainAgentStatus, scheduleAgentStatusRefresh, statusClock } from '$lib/components/agent-room/agent-status.svelte.js';
  import { attentionDecisionKind, attentionFeed, retainAttentionFeed, scheduleAttentionRefresh } from '$lib/components/agent-room/attention-feed.svelte.js';
  import { agentTone, elapsedParts } from '$lib/components/agent-room/agent-identity.js';
  import { agentDoingLabel, agentStateLabel, elapsedLabel } from '$lib/components/agent-room/agent-status-labels.js';
  import { clearWorkspaceContext, publishWorkspaceContext, registerWorkspaceSelector } from '$lib/components/agent-room/workspace-context.svelte.js';
  import { directChannel, directChannelNode, TEAM_CHANNEL, type ChannelMessage } from '$lib/modules/agent-room/domain/channels.js';
  import type { CanvasNode, Routine, TerminalNodePayload, Workspace } from '$lib/modules/agent-room/domain/types.js';
  import type { ChannelBinding } from '$lib/modules/agent-room/domain/channels.js';
  import * as m from '$lib/paraglide/messages.js';
  import { getLocale } from '$lib/paraglide/runtime.js';

  type ChannelSummary = { id: string; kind: 'team' | 'dm'; nodeId: string | null; title: string; last: ChannelMessage | null; openQuestions: number };
  type Agent = { id: string; title: string; payload: TerminalNodePayload };

  const PAGE_SIZE = 80;

  let workspaces = $state<Workspace[]>([]);
  let workspaceId = $state<string | null>(null);
  let agents = $state<Agent[]>([]);
  let channels = $state<ChannelSummary[]>([]);
  let channel = $state<string>(TEAM_CHANNEL);
  let messages = $state<ChannelMessage[]>([]);
  let loading = $state(true);
  let loadingOlder = $state(false);
  let hasOlder = $state(false);
  let profileNodeId = $state<string | null>(null);
  // The profile column stays open beside the conversation unless the owner closes it.
  let profileHidden = $state(false);
  let routines = $state<Routine[]>([]);
  let bindings = $state<ChannelBinding[]>([]);
  let draft = $state('');
  let sending = $state(false);
  let sendError = $state('');
  let mentionOpen = $state(false);
  let mentionFilter = $state('');
  let scroller = $state<HTMLElement | null>(null);
  let input = $state<HTMLTextAreaElement | null>(null);
  let listening = $state(false);
  // A request opened from Needs you, waiting to be scrolled into view once its channel has loaded.
  let revealId = $state<string | null>(null);
  let highlightedId = $state<string | null>(null);

  const workspace = $derived(workspaces.find((candidate) => candidate.id === workspaceId) ?? null);
  const agentById = $derived(new Map(agents.map((agent) => [agent.id, agent])));
  const directNode = $derived(directChannelNode(channel));
  const channelTitle = $derived(channel === TEAM_CHANNEL ? m['chat.team_channel']() : agentById.get(directNode ?? '')?.title ?? '');
  const timeline = $derived(buildTimeline(messages));
  const answers = $derived(answersByQuestion(messages));
  const leader = $derived(agents.find((agent) => agent.payload.maestro) ?? null);
  const filteredMentions = $derived(agents.filter((agent) => agent.title.toLowerCase().includes(mentionFilter.toLowerCase())).slice(0, 8));
  const profileAgent = $derived(profileHidden ? null : agentById.get(profileNodeId ?? directNode ?? leader?.id ?? '') ?? null);
  // Requests that wait for a decision show up as cards in the team channel (and in that agent's conversation).
  const pendingRequests = $derived(attentionFeed.items.filter((item) => attentionDecisionKind(item) && (channel === TEAM_CHANNEL || item.nodeId === directNode)));
  const bindingKinds = $derived([...new Set(bindings.filter((binding) => binding.enabled).map((binding) => (binding.kind === 'slack' ? 'Slack' : 'Telegram')))]);

  async function api<T>(url: string, init?: RequestInit): Promise<T> {
    const csrf = getCsrfToken();
    const response = await fetch(url, {
      ...init,
      headers: { 'content-type': 'application/json', ...(csrf ? { 'X-CSRF-Token': csrf } : {}), ...(init?.headers ?? {}) },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error ?? m['chat.load_error']());
    return body.data as T;
  }

  function titleOf(nodeId: string | null): string {
    return (nodeId && agentById.get(nodeId)?.title) || m['chat.unknown_agent']();
  }

  function timeLabel(iso: string): string {
    return new Date(iso).toLocaleTimeString(getLocale(), { hour: '2-digit', minute: '2-digit' });
  }

  function dayLabel(iso: string): string {
    const date = new Date(iso);
    const today = new Date();
    const yesterday = new Date(Date.now() - 86_400_000);
    if (date.toDateString() === today.toDateString()) return m['chat.today']();
    if (date.toDateString() === yesterday.toDateString()) return m['chat.yesterday']();
    return date.toLocaleDateString(getLocale(), { weekday: 'long', day: 'numeric', month: 'long' });
  }

  function syncUrl() {
    if (!workspaceId) return;
    const params = new URLSearchParams({ workspace: workspaceId });
    if (channel !== TEAM_CHANNEL) params.set('channel', channel);
    void goto(`/chat?${params.toString()}`, { replaceState: true, keepFocus: true, noScroll: true });
  }

  async function loadWorkspace(id: string) {
    const [nodes, summaries] = await Promise.all([
      api<CanvasNode[]>(`/api/agent-room/workspaces/${encodeURIComponent(id)}/nodes`),
      api<{ channels: ChannelSummary[] }>(`/api/agent-room/workspaces/${encodeURIComponent(id)}/channels`),
    ]);
    if (id !== workspaceId) return;
    agents = nodes
      .filter((node) => node.type === 'terminal' && Boolean((node.payload as TerminalNodePayload).provider))
      .map((node) => ({ id: node.id, title: node.title ?? m['canvas.fallback_terminal'](), payload: node.payload as TerminalNodePayload }));
    channels = summaries.channels;
    // A conversation asked for in the link but with no such agent here opens the team channel.
    const requested = directChannelNode(channel);
    if (requested && !agents.some((agent) => agent.id === requested)) {
      channel = TEAM_CHANNEL;
      syncUrl();
    }
    const [routineList, bindingList] = await Promise.all([
      api<Routine[]>(`/api/agent-room/workspaces/${encodeURIComponent(id)}/routines`).catch(() => []),
      api<ChannelBinding[]>(`/api/agent-room/workspaces/${encodeURIComponent(id)}/channel-bindings`).catch(() => []),
    ]);
    if (id !== workspaceId) return;
    routines = Array.isArray(routineList) ? routineList : [];
    bindings = Array.isArray(bindingList) ? bindingList : [];
  }

  function routineLabel(routine: Routine): string {
    const target = routine.targetNodeId ? agentById.get(routine.targetNodeId)?.title : null;
    return [routineCadence(routine), routineNextRun(routine), target].filter(Boolean).join(' · ');
  }

  function doingOf(agentId: string): string {
    const live = agentStatus.agents[agentId];
    if (!live) return '';
    return agentDoingLabel(live);
  }

  async function refreshChannels() {
    if (!workspaceId) return;
    const id = workspaceId;
    const summaries = await api<{ channels: ChannelSummary[] }>(`/api/agent-room/workspaces/${encodeURIComponent(id)}/channels`).catch(() => null);
    if (summaries && id === workspaceId) channels = summaries.channels;
  }

  async function loadMessages(older = false) {
    if (!workspaceId) return;
    const id = workspaceId;
    const current = channel;
    const before = older ? oldestCreatedAt(messages) : null;
    const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
    if (before) params.set('before', before);
    if (older) loadingOlder = true;
    try {
      const page = await api<ChannelMessage[]>(`/api/agent-room/workspaces/${encodeURIComponent(id)}/channels/${encodeURIComponent(current)}/messages?${params.toString()}`);
      if (id !== workspaceId || current !== channel) return;
      hasOlder = page.length >= PAGE_SIZE;
      if (older) {
        const height = scroller?.scrollHeight ?? 0;
        messages = mergeOlder(page, messages);
        await tick();
        if (scroller) scroller.scrollTop += scroller.scrollHeight - height;
      } else {
        messages = mergeLoaded(page, messages.filter((message) => message.channel === current));
        await tick();
        scrollToEnd();
      }
    } catch {
      if (!older) messages = [];
    } finally {
      loadingOlder = false;
      loading = false;
    }
  }

  function scrollToEnd() {
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  }

  function nearEnd(): boolean {
    return !scroller || scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 120;
  }

  function selectChannel(next: string) {
    if (next === channel) return;
    channel = next;
    messages = [];
    loading = true;
    draft = '';
    sendError = '';
    syncUrl();
    void loadMessages();
  }

  function openAttentionItem(item: AgentAttentionItem) {
    if (item.action?.target === 'chat' && typeof item.action.channel === 'string') {
      selectChannel(item.action.channel);
      return;
    }
    // Decisions wait as cards in this conversation: show the whole card instead of leaving the page.
    if (attentionDecisionKind(item)) {
      if (channel !== TEAM_CHANNEL && item.nodeId !== directNode) selectChannel(TEAM_CHANNEL);
      revealId = item.id;
      return;
    }
    const params = new URLSearchParams({ workspace: item.workspaceId });
    if (item.nodeId) params.set('node', item.nodeId);
    void goto(`/canvas?${params.toString()}`);
  }

  // Reads the field itself, so a typed @ opens mentions whatever order the binding updates in.
  function onInput() {
    const match = (input?.value ?? draft).match(/@([\p{L}\p{N} ._-]*)$/u);
    mentionOpen = Boolean(match);
    mentionFilter = match?.[1] ?? '';
    if (input) {
      input.style.height = 'auto';
      input.style.height = `${Math.min(160, input.scrollHeight)}px`;
    }
  }

  function insertMention(agent: Agent) {
    draft = draft.replace(/@([\p{L}\p{N} ._-]*)$/u, `@${agent.title} `);
    mentionOpen = false;
    input?.focus();
  }

  async function post(body: string, replyToId: string | null = null): Promise<boolean> {
    if (!workspaceId) return false;
    const result = await api<{ message: ChannelMessage; answer?: ChannelMessage | null; delivered: Array<{ nodeId: string; ok: boolean }> }>(
      `/api/agent-room/workspaces/${encodeURIComponent(workspaceId)}/channels/${encodeURIComponent(channel)}/messages`,
      { method: 'POST', body: JSON.stringify({ body, replyToId }) },
    );
    messages = upsertMessage(messages, result.message);
    if (result.answer) messages = upsertMessage(messages, result.answer);
    await tick();
    scrollToEnd();
    const failed = result.delivered.filter((entry) => !entry.ok);
    if (failed.length) sendError = m['chat.delivery_failed']({ names: failed.map((entry) => titleOf(entry.nodeId)).join(', ') });
    return true;
  }

  async function send() {
    const text = draft.trim();
    if (!text || sending) return;
    sending = true;
    sendError = '';
    try {
      await post(text);
      if (draft.trim() === text) draft = '';
      onInput();
    } catch (error) {
      sendError = error instanceof Error ? error.message : m['chat.send_failed']();
    } finally {
      sending = false;
    }
  }

  async function onVoice(text: string, mode: 'send' | 'edit') {
    draft = draft.trim() ? `${draft.trimEnd()} ${text}` : text;
    if (mode === 'send') await send();
    else requestAnimationFrame(() => { input?.focus(); onInput(); });
  }

  // Without the voice models, the app's dictation flow takes over and installs them.
  function onVoiceSetup() {
    listening = false;
    requestAnimationFrame(() => {
      input?.focus();
      window.dispatchEvent(new Event(TEXT_DICTATION_COMMAND));
    });
  }

  async function answer(questionId: string, text: string): Promise<boolean> {
    try {
      return await post(text, questionId);
    } catch {
      return false;
    }
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      if (mentionOpen && filteredMentions.length) insertMention(filteredMentions[0]);
      else void send();
    }
    if (event.key === 'Escape') mentionOpen = false;
  }

  // Open workspace and channel come from the URL; the first workspace is the fallback.
  onMount(() => {
    const params = new URLSearchParams(location.search);
    const requestedChannel = params.get('channel');
    if (requestedChannel && (requestedChannel === TEAM_CHANNEL || directChannelNode(requestedChannel))) channel = requestedChannel;
    void api<Workspace[]>('/api/agent-room/workspaces').then((list) => {
      workspaces = list;
      const requested = params.get('workspace');
      const remembered = localStorage.getItem('orkestrai.activeWorkspaceId');
      workspaceId = list.find((candidate) => candidate.id === requested)?.id ?? list.find((candidate) => candidate.id === remembered)?.id ?? list[0]?.id ?? null;
      if (!workspaceId) loading = false;
    }).catch(() => (loading = false));
    // The top bar's workspace tabs switch the conversation in place.
    const unregister = registerWorkspaceSelector((id) => {
      if (id === workspaceId) return;
      localStorage.setItem('orkestrai.activeWorkspaceId', id);
      workspaceId = id;
      channel = TEAM_CHANNEL;
      messages = [];
      profileNodeId = null;
      profileHidden = false;
    });
    return () => {
      unregister();
      clearWorkspaceContext('chat');
    };
  });

  $effect(() => {
    const id = workspaceId;
    if (!id) return;
    untrack(() => {
      loading = true;
      syncUrl();
      void loadWorkspace(id).then(() => loadMessages()).catch(() => (loading = false));
    });
  });

  $effect(() => {
    publishWorkspaceContext('chat', workspaceId, profileNodeId ?? directNode);
  });

  $effect(() => {
    const id = revealId;
    if (!id || loading) return;
    untrack(() => {
      revealId = null;
      void tick().then(() => {
        const card = scroller?.querySelector<HTMLElement>(`[data-attention-id="${CSS.escape(id)}"]`);
        if (!card) return;
        card.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
        highlightedId = id;
        setTimeout(() => { if (highlightedId === id) highlightedId = null; }, 2_000);
      });
    });
  });

  $effect(() => {
    const id = workspaceId;
    return untrack(() => retainAgentStatus(id));
  });

  $effect(() => {
    const id = workspaceId;
    return untrack(() => retainAttentionFeed(id));
  });

  // Live updates: new channel messages, agent asks and status changes.
  onMount(() => {
    let socket: WebSocket | null = null;
    let disposed = false;
    let reconnect: ReturnType<typeof setTimeout> | null = null;
    let channelsTimer: ReturnType<typeof setTimeout> | null = null;
    let reloadTimer: ReturnType<typeof setTimeout> | null = null;
    const refreshSoon = () => {
      if (channelsTimer) return;
      channelsTimer = setTimeout(() => { channelsTimer = null; void refreshChannels(); }, 400);
    };
    const connect = () => {
      if (disposed) return;
      socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/agent-room/pty`);
      socket.onopen = () => {
        socket?.send(JSON.stringify({ type: 'subscribe', events: ['channelMessage', 'messageDelivery', 'controlCenterChanged', 'attentionChanged'] }));
        // Messages sent before this subscription (first load or a reconnect) come from a reload.
        if (workspaceId) void loadMessages();
      };
      socket.onmessage = async (event) => {
        let frame: { type?: string; workspaceId?: string; channel?: string; message?: ChannelMessage };
        try { frame = JSON.parse(String(event.data)); } catch { return; }
        if (frame.workspaceId && frame.workspaceId !== workspaceId) return;
        if (frame.type === 'channelMessage' && frame.message) {
          refreshSoon();
          if (frame.channel !== channel) return;
          const stick = nearEnd();
          messages = upsertMessage(messages, frame.message);
          await tick();
          if (stick) scrollToEnd();
        }
        if (frame.type === 'messageDelivery' && channel === TEAM_CHANNEL && !reloadTimer) {
          reloadTimer = setTimeout(() => { reloadTimer = null; void loadMessages(); }, 600);
        }
        if (frame.type === 'controlCenterChanged') scheduleAgentStatusRefresh();
        if (frame.type === 'attentionChanged') {
          scheduleAttentionRefresh();
          window.dispatchEvent(new CustomEvent('orkestrai:attention-changed'));
        }
      };
      socket.onclose = () => {
        if (!disposed) reconnect = setTimeout(connect, 3_000);
      };
    };
    connect();
    return () => {
      disposed = true;
      if (reconnect) clearTimeout(reconnect);
      if (channelsTimer) clearTimeout(channelsTimer);
      if (reloadTimer) clearTimeout(reloadTimer);
      socket?.close();
    };
  });
</script>

<svelte:head><title>{m['chat.page_title']()}</title></svelte:head>

<main class="chat-page">
  <nav class="channels" aria-label={m['chat.channels_label']()}>
    <NeedsYouList onOpen={openAttentionItem} limit={4} />
    <h2>{m['chat.channels']()}</h2>
    {#each channels.filter((entry) => entry.kind === 'team') as entry (entry.id)}
      <button type="button" class="channel" class:active={channel === entry.id} onclick={() => selectChannel(entry.id)} aria-current={channel === entry.id ? 'page' : undefined}>
        <span class="hash"><Hash size={14} /></span>
        <span class="name">{m['chat.team_channel']()}</span>
        {#if entry.openQuestions}<span class="badge">{entry.openQuestions}</span>{/if}
      </button>
    {/each}
    <h2 class="with-action">
      <span>{m['chat.team_heading']()}</span>
      {#if workspaceId}<a class="mini-action" href={`/canvas?workspace=${encodeURIComponent(workspaceId)}`} aria-label={m['chat.recruit']()} title={m['chat.recruit']()}><Plus size={13} /></a>{/if}
    </h2>
    {#each agents as agent (agent.id)}
      {@const summary = channels.find((entry) => entry.nodeId === agent.id)}
      {@const live = agentStatus.agents[agent.id]}
      {@const activity = live ? (live.sessionAlive ? live.state : 'disconnected') : 'idle'}
      <button type="button" class="channel dm" class:active={channel === directChannel(agent.id)} onclick={() => { profileHidden = false; profileNodeId = agent.id; selectChannel(directChannel(agent.id)); }} aria-current={channel === directChannel(agent.id) ? 'page' : undefined}>
        <AgentAvatar nodeId={agent.id} title={agent.title} size={24} />
        <span class="dm-text">
          <span class="name">{agent.title}{#if agent.payload.agentRuntimeMode === 'persistent' || agent.payload.agentRuntimeMode === 'on_demand'}<span class="always-on" title={m['always_on.title']()}>24/7</span>{/if}</span>
          <span class="doing">{doingOf(agent.id)}</span>
        </span>
        <AgentGlyph tone={agentTone(activity)} label={agentStateLabel(activity)} />
        {#if summary?.openQuestions}<span class="badge">{summary.openQuestions}</span>{/if}
      </button>
    {:else}
      <p class="hint">{m['chat.no_agents']()}</p>
    {/each}
    {#if routines.length}
      <h2>{m['chat.routines']()}</h2>
      {#each routines.slice(0, 8) as routine (routine.id)}
        <div class="routine"><Clock3 size={14} /><span class="dm-text"><span class="name">{routine.name}</span><span class="doing">{routineLabel(routine)}</span></span></div>
      {/each}
    {/if}
    {#if bindingKinds.length}
      <p class="also-on"><Smartphone size={13} />{m['chat.also_on']({ channels: bindingKinds.join(' · ') })}</p>
    {/if}
  </nav>

  <section class="conversation" aria-label={channelTitle}>
    <header class="conversation-header">
      {#if directNode}
        <button type="button" class="who" onclick={() => { profileHidden = false; profileNodeId = directNode; }}>
          <AgentAvatar nodeId={directNode} title={channelTitle} size={28} />
          <span class="headline">{channelTitle}</span>
        </button>
        {#if agentStatus.agents[directNode]}
          {@const live = agentStatus.agents[directNode]}
          {@const activity = live.sessionAlive ? live.state : 'disconnected'}
          {@const parts = elapsedParts(live.stateSince, statusClock.now)}
          <span class="presence"><AgentGlyph tone={agentTone(activity)} label={agentStateLabel(activity)} />{agentStateLabel(activity)}{#if parts}{` · ${elapsedLabel(parts)}`}{/if}</span>
        {/if}
      {:else}
        <span class="headline"><span class="hash-mark">#</span>{channelTitle}</span>
        <span class="presence">{m['chat.channel_sub_team']()}</span>
        <span class="spacer"></span>
        {#if bindingKinds.length}<span class="channels-note"><Smartphone size={13} />{m['chat.also_on']({ channels: bindingKinds.join(' · ') })}</span>{/if}
        <span class="faces" aria-label={m['chat.team_members']({ count: agents.length })}>
          {#each agents.slice(0, 6) as agent (agent.id)}<AgentAvatar nodeId={agent.id} title={agent.title} size={22} />{/each}
        </span>
      {/if}
      {#if directNode}<span class="spacer"></span>{/if}
      {#if !profileAgent && (directNode || leader)}
        <button type="button" class="icon" onclick={() => { profileHidden = false; profileNodeId = directNode ?? leader?.id ?? null; }} aria-label={m['chat.profile_open']()} title={m['chat.profile_open']()}><PanelRightOpen size={15} /></button>
      {/if}
    </header>

    <div class="timeline" bind:this={scroller} data-testid="chat-timeline">
      {#if hasOlder}
        <button type="button" class="older" disabled={loadingOlder} onclick={() => void loadMessages(true)}>
          {#if loadingOlder}<LoaderCircle size={13} class="animate-spin" />{/if}{m['chat.load_older']()}
        </button>
      {/if}
      {#if loading}
        <p class="status-line"><LoaderCircle size={14} class="animate-spin" /> {m['chat.loading']()}</p>
      {:else if !workspace}
        <NodeEmptyState icon={Hash} title={m['chat.no_workspace']()} />
      {:else if !messages.length}
        <div class="empty">
          <NodeEmptyState icon={Hash} title={directNode ? m['chat.empty_direct']({ name: channelTitle }) : m['chat.empty_team']()} description={directNode ? m['chat.empty_direct_hint']() : m['chat.empty_team_hint']()} />
        </div>
      {/if}
      {#each timeline as row (row.key)}
        {#if row.type === 'day'}
          <div class="day"><span>{dayLabel(row.date)}</span></div>
        {:else if row.type === 'event'}
          <div class="event">
            <CheckCheck size={13} />
            <span>{row.message.meta.event === 'task_done'
              ? (row.message.meta.assigneeNodeId ? m['chat.event_task_done']({ name: titleOf(String(row.message.meta.assigneeNodeId)), title: row.message.body }) : m['chat.event_task_done_unassigned']({ title: row.message.body }))
              : row.message.body}</span>
            <time>{timeLabel(row.message.createdAt)}</time>
          </div>
        {:else}
          <article class="group" class:owner={row.authorKind === 'owner'}>
            {#if row.authorKind === 'owner'}
              <span class="owner-avatar" aria-hidden="true"><UserRound size={15} /></span>
            {:else if row.authorKind === 'external'}
              <span class="owner-avatar external" aria-hidden="true"><UserRound size={15} /></span>
            {:else}
              <button type="button" class="avatar-button" onclick={() => { profileHidden = false; profileNodeId = row.authorNodeId; }} aria-label={m['chat.profile_open_for']({ name: titleOf(row.authorNodeId) })}>
                <AgentAvatar nodeId={row.authorNodeId ?? 'unknown'} title={titleOf(row.authorNodeId)} size={34} />
              </button>
            {/if}
            <div class="group-body">
              <header>
                <b>{row.authorKind === 'owner' ? m['chat.you']() : row.authorKind === 'external' ? String(row.messages[0].meta.sender ?? '') : titleOf(row.authorNodeId)}</b>
                {#if row.authorKind === 'external'}<span class="via">{m['chat.via']({ channel: row.messages[0].meta.via === 'slack' ? 'Slack' : 'Telegram' })}</span>{/if}
                <time>{timeLabel(row.messages[0].createdAt)}</time>
              </header>
              {#each row.messages as message (message.id)}
                {#if message.kind === 'question'}
                  <QuestionCard question={message} answer={answers.get(message.id) ?? null} authorTitle={titleOf(message.authorNodeId)} onAnswer={answer} />
                {:else}
                  <div class="message" data-testid="chat-message">
                    {#if typeof message.meta.to === 'string'}
                      <span class="to"><CornerDownRight size={12} />{titleOf(message.meta.to)}</span>
                    {:else if message.kind === 'answer'}
                      <span class="to"><CornerDownRight size={12} />{m['chat.answered_question']()}</span>
                    {/if}
                    <MarkdownView content={message.body} compact {workspaceId} />
                    {#if typeof message.meta.reply === 'string' && message.meta.reply}
                      <div class="reply">
                        <AgentAvatar nodeId={String(message.meta.to)} title={titleOf(String(message.meta.to))} size={18} />
                        <div><b>{titleOf(String(message.meta.to))}</b><MarkdownView content={message.meta.reply} compact {workspaceId} /></div>
                      </div>
                    {/if}
                  </div>
                {/if}
              {/each}
            </div>
          </article>
        {/if}
      {/each}
      {#if pendingRequests.length && !loading}
        <div class="day"><span>{m['chat.pending_requests']()}</span></div>
        {#each pendingRequests as item (item.id)}<RequestCard {item} highlighted={highlightedId === item.id} />{/each}
      {/if}
    </div>

    <footer class="composer-area">
      {#if mentionOpen && filteredMentions.length}
        <div class="mentions" role="listbox" aria-label={m['composer.mention']()}>
          {#each filteredMentions as agent (agent.id)}
            <button type="button" role="option" aria-selected="false" onclick={() => insertMention(agent)}>
              <AgentAvatar nodeId={agent.id} title={agent.title} size={18} />{agent.title}
            </button>
          {/each}
        </div>
      {/if}
      {#if sendError}<p class="send-error" role="alert">{sendError}</p>{/if}
      <div class="composer">
        {#if listening}
          <ComposerVoice onTranscript={onVoice} onClose={() => (listening = false)} onSetupNeeded={onVoiceSetup} />
        {:else}
          <label class="sr-only" for="chat-composer-input">{channelTitle}</label>
          <textarea
            id="chat-composer-input"
            bind:this={input}
            bind:value={draft}
            rows="1"
            disabled={!workspace || (!agents.length)}
            placeholder={directNode ? m['chat.placeholder_direct']({ name: channelTitle }) : leader ? m['chat.placeholder_team']({ name: leader.title }) : m['chat.placeholder_team_no_leader']()}
            oninput={onInput}
            oncompositionend={onInput}
            onkeydown={onKeydown}
          ></textarea>
          <button type="button" class="icon" onclick={() => { draft = `${draft}@`; onInput(); input?.focus(); }} aria-label={m['composer.mention']()} disabled={!agents.length}><AtSign size={16} /></button>
          {#if !draft.trim() && !sending}
            <button type="button" class="send" onclick={() => (listening = true)} disabled={!workspace || !agents.length} aria-label={m['composer.voice_label']()} title={m['composer.voice_label']()}><Mic size={15} /></button>
          {:else}
            <button type="button" class="send" onclick={() => void send()} disabled={!draft.trim() || sending} aria-label={m['composer.send']()}>
              {#if sending}<LoaderCircle size={15} class="animate-spin" />{:else}<ArrowUp size={15} strokeWidth={2.4} />{/if}
            </button>
          {/if}
        {/if}
      </div>
      <p class="composer-hint">{directNode ? m['chat.composer_hint_direct']() : leader ? m['chat.composer_hint_team']({ name: leader.title }) : m['chat.composer_hint_team_plain']()}</p>
    </footer>
  </section>

  {#if profileAgent && workspaceId}
    <AgentProfilePanel
      {workspaceId}
      nodeId={profileAgent.id}
      title={profileAgent.title}
      payload={profileAgent.payload}
      onClose={() => { profileHidden = true; profileNodeId = null; }}
      onDirect={(id) => selectChannel(directChannel(id))}
    />
  {/if}
</main>

<style>
  .chat-page {
    height: 100%;
    min-height: 0;
    display: flex;
    background: var(--app-bg);
    color: var(--app-text);
  }

  .channels {
    width: 260px;
    flex: none;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 14px 10px;
    overflow-y: auto;
    border-right: 1px solid var(--app-border);
    background: var(--app-sidebar);
  }

  .channels h2 {
    display: flex;
    align-items: center;
    margin: 14px 8px 4px;
    color: var(--app-text-muted);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .channel {
    height: 34px;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 8px;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: var(--app-text-soft);
    font: inherit;
    font-size: 13.5px;
    text-align: left;
    cursor: pointer;
  }

  .channel:hover {
    background: var(--app-hover);
    color: var(--app-text);
  }

  .channel.active {
    background: var(--app-active);
    color: var(--app-text);
    font-weight: 600;
  }

  .channel.dm {
    height: auto;
    min-height: 44px;
    padding: 5px 8px;
  }

  .dm-text {
    min-width: 0;
    flex: 1;
    display: flex;
    flex-direction: column;
    line-height: 1.3;
  }

  .dm-text .name {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--app-text);
    font-weight: 500;
  }

  .doing {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--app-text-muted);
    font-size: 12px;
    font-weight: 400;
  }

  .with-action span {
    flex: 1;
  }

  .mini-action {
    width: 22px;
    height: 22px;
    display: grid;
    place-items: center;
    border-radius: 6px;
    color: var(--app-text-muted);
  }

  .mini-action:hover {
    background: var(--app-hover);
    color: var(--app-text);
  }

  .routine {
    display: flex;
    align-items: center;
    gap: 9px;
    min-height: 40px;
    padding: 4px 8px;
    color: var(--app-text-muted);
    font-size: 13px;
  }

  .also-on {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: auto 0 0;
    padding: 12px 8px 0;
    border-top: 1px solid var(--app-border);
    color: var(--app-text-muted);
    font-size: 12px;
  }

  .channel:focus-visible,
  .icon:focus-visible,
  .send:focus-visible,
  .who:focus-visible,
  .avatar-button:focus-visible,
  .older:focus-visible {
    outline: 2px solid var(--app-accent);
    outline-offset: 1px;
  }

  .hash {
    width: 22px;
    height: 22px;
    display: grid;
    place-items: center;
    border-radius: 6px;
    background: var(--app-surface);
  }

  .name {
    min-width: 0;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .badge {
    min-width: 18px;
    height: 18px;
    padding: 0 5px;
    border-radius: 999px;
    background: var(--app-warning);
    color: #1b1300;
    font-size: 11px;
    font-weight: 700;
    line-height: 18px;
    text-align: center;
  }

  .hint {
    margin: 4px 8px;
    color: var(--app-text-muted);
    font-size: 12.5px;
  }

  .conversation {
    min-width: 0;
    flex: 1;
    display: flex;
    flex-direction: column;
  }

  .conversation-header {
    height: 60px;
    flex: none;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 0 20px;
    border-bottom: 1px solid var(--app-border);
  }

  .conversation-header .headline {
    display: inline-flex;
    align-items: baseline;
    gap: 2px;
    font-family: var(--font-headline);
    font-stretch: 62%;
    font-size: 30px;
    font-weight: 700;
    line-height: 1;
  }

  .hash-mark {
    color: var(--app-text-muted);
  }

  .channels-note {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--app-text-muted);
    font-size: 12px;
    white-space: nowrap;
  }

  .faces {
    display: inline-flex;
  }

  .faces :global(> *) {
    margin-left: -5px;
    box-shadow: 0 0 0 2px var(--app-page);
    border-radius: 7px;
  }

  .who {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    padding: 4px 6px;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: var(--app-text);
    cursor: pointer;
  }

  .who:hover {
    background: var(--app-hover);
  }

  .presence {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--app-text-muted);
    font-size: 12.5px;
  }

  .spacer {
    flex: 1;
  }

  .icon,
  .send {
    width: 34px;
    height: 34px;
    flex: none;
    display: grid;
    place-items: center;
    border: 0;
    border-radius: 999px;
    cursor: pointer;
  }

  .icon {
    background: transparent;
    color: var(--app-text-muted);
  }

  .icon:hover:not(:disabled) {
    background: var(--app-hover);
    color: var(--app-text);
  }

  .send {
    background: var(--app-accent);
    color: var(--app-accent-contrast);
  }

  .send:disabled,
  .icon:disabled {
    opacity: 0.45;
    cursor: default;
  }

  .timeline {
    min-height: 0;
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 16px 24px 12px;
    overflow-y: auto;
  }

  /* Cards that clip their own overflow must not shrink into thin stripes once the timeline scrolls. */
  .timeline > :global(*) {
    flex-shrink: 0;
  }

  .older {
    align-self: center;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 28px;
    margin-bottom: 8px;
    padding: 0 12px;
    border: 0;
    border-radius: 999px;
    background: var(--app-hover);
    color: var(--app-text-soft);
    font: inherit;
    font-size: 12px;
    cursor: pointer;
  }

  .status-line {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    margin: auto;
    color: var(--app-text-muted);
    font-size: 13px;
  }

  .empty {
    margin: auto;
    max-width: 420px;
  }

  .day {
    display: flex;
    align-items: center;
    gap: 12px;
    margin: 14px 0 6px;
    color: var(--app-text-muted);
    font-size: 11.5px;
    font-weight: 600;
    text-transform: capitalize;
  }

  .day::before,
  .day::after {
    content: '';
    flex: 1;
    height: 1px;
    background: var(--app-border);
  }

  .event {
    align-self: center;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin: 4px 0;
    padding: 4px 10px;
    border-radius: 999px;
    background: var(--app-surface);
    color: var(--app-text-soft);
    font-size: 12px;
  }

  .event :global(svg) {
    color: var(--app-success);
  }

  .event time {
    color: var(--app-text-muted);
  }

  .group {
    display: flex;
    gap: 12px;
    padding: 8px 0;
  }

  .avatar-button {
    height: fit-content;
    padding: 0;
    border: 0;
    border-radius: 10px;
    background: transparent;
    cursor: pointer;
  }

  .owner-avatar {
    width: 34px;
    height: 34px;
    flex: none;
    display: grid;
    place-items: center;
    border-radius: 10px;
    background: var(--app-text);
    color: var(--app-surface);
  }

  .owner-avatar.external {
    background: var(--app-info-soft);
    color: var(--app-info);
  }

  .via {
    padding: 0 7px;
    border-radius: 999px;
    background: var(--app-info-soft);
    color: var(--app-info);
    font-size: 11px;
    font-weight: 600;
  }

  .always-on {
    padding: 0 5px;
    border-radius: 5px;
    background: var(--app-success-soft);
    color: var(--app-success);
    font-size: 11px;
    font-weight: 700;
  }

  .group-body {
    min-width: 0;
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .group-body header {
    display: flex;
    align-items: baseline;
    gap: 8px;
  }

  .group-body header b {
    font-size: 13.5px;
    font-weight: 650;
  }

  .group-body time {
    color: var(--app-text-muted);
    font-size: 11.5px;
  }

  .message {
    max-width: 760px;
    color: var(--app-text);
    font-size: 13.5px;
    line-height: 1.55;
  }

  .to {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    margin-bottom: 2px;
    padding: 1px 8px;
    border-radius: 999px;
    background: var(--app-accent-soft);
    color: var(--app-accent);
    font-size: 11.5px;
    font-weight: 600;
  }

  .reply {
    display: flex;
    gap: 8px;
    margin-top: 6px;
    padding: 8px 10px;
    border-left: 2px solid var(--app-border-strong);
    border-radius: 0 8px 8px 0;
    background: var(--app-surface);
  }

  .reply b {
    font-size: 12.5px;
  }

  .composer-area {
    position: relative;
    flex: none;
    padding: 8px 24px 18px;
  }

  .composer {
    display: flex;
    align-items: flex-end;
    gap: 6px;
    padding: 7px;
    border-radius: 18px;
    border: 1px solid var(--app-border-strong);
    background: var(--app-surface);
    box-shadow: var(--app-shadow-card);
    transition: border-color var(--duration-quick) ease-out, box-shadow var(--duration-quick) ease-out;
  }

  .composer:focus-within {
    border-color: color-mix(in srgb, var(--app-accent) 55%, transparent);
    box-shadow: var(--app-shadow-card), 0 0 0 4px color-mix(in srgb, var(--app-accent) 9%, transparent);
  }

  .composer-hint {
    margin: 6px 6px 0;
    color: var(--app-text-muted);
    font-size: 11.5px;
  }

  textarea {
    flex: 1;
    min-width: 0;
    min-height: 34px;
    max-height: 160px;
    resize: none;
    border: 0;
    outline: none;
    background: transparent;
    color: var(--app-text);
    font: inherit;
    font-size: 14px;
    line-height: 1.45;
    padding: 7px 8px;
  }

  textarea::placeholder {
    color: var(--app-text-muted);
  }

  .mentions {
    position: absolute;
    left: 30px;
    bottom: calc(100% - 4px);
    min-width: 240px;
    padding: 4px;
    border-radius: 12px;
    background: var(--app-surface-raised);
    box-shadow: 0 0 0 1px var(--app-ring-hairline), var(--app-shadow-overlay);
  }

  .mentions button {
    width: 100%;
    height: 32px;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 10px;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: var(--app-text);
    font: inherit;
    font-size: 13px;
    cursor: pointer;
  }

  .mentions button:hover,
  .mentions button:focus-visible {
    background: var(--app-hover);
    outline: none;
  }

  .send-error {
    margin: 0 0 6px;
    color: var(--app-danger);
    font-size: 12.5px;
  }

  @media (max-width: 900px) {
    .channels {
      display: none;
    }
  }
</style>
