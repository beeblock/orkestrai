<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { ArrowLeft, ArrowUp, BellRing, Hash, Inbox, LoaderCircle, MessagesSquare, UserRound, UsersRound } from '@lucide/svelte';
  import AgentAvatar from '$lib/components/agent-room/AgentAvatar.svelte';
  import AgentGlyph from '$lib/components/agent-room/AgentGlyph.svelte';
  import MarkdownView from '$lib/components/agent-room/MarkdownView.svelte';
  import * as NativeSelect from '$lib/components/ui/native-select';
  import QuestionCard from '$lib/components/agent-room/chat/QuestionCard.svelte';
  import { answersByQuestion, buildTimeline } from '$lib/components/agent-room/chat/chat-timeline.js';
  import { agentColor, agentTone, elapsedParts } from '$lib/components/agent-room/agent-identity.js';
  import { agentStateLabel, elapsedLabel } from '$lib/components/agent-room/agent-status-labels.js';
  import { decisionLabels } from '$lib/components/agent-room/attention-decision-labels.js';
  import { attentionDecisionKind, ownerQuestionOptions } from '$lib/components/agent-room/attention-feed.svelte.js';
  import { localeState } from '$lib/i18n/locale.svelte.js';
  import { TEAM_CHANNEL, type ChannelMessage } from '$lib/modules/agent-room/domain/channels.js';
  import type { AgentAttentionItem, ControlCenterSnapshot } from '$lib/modules/agent-room/domain/types.js';
  import * as m from '$lib/paraglide/messages.js';

  type Session = { locale: string; workspaces: Array<{ id: string; name: string }> };
  type ChannelSummary = { id: string; kind: 'team' | 'dm'; nodeId: string | null; title: string; last: ChannelMessage | null; openQuestions: number };
  type Tab = 'needs' | 'chat' | 'team';

  const TOKEN_KEY = 'orkestrai.mobile.token';
  const WORKSPACE_KEY = 'orkestrai.mobile.workspace';

  let token = $state<string | null>(null);
  let session = $state<Session | null>(null);
  let failure = $state<'pair' | 'offline' | null>(null);
  let workspaceId = $state<string | null>(null);
  let tab = $state<Tab>('needs');
  let attention = $state<AgentAttentionItem[]>([]);
  let channels = $state<ChannelSummary[]>([]);
  let channel = $state<string | null>(null);
  let messages = $state<ChannelMessage[]>([]);
  let control = $state<ControlCenterSnapshot | null>(null);
  let draft = $state('');
  let sending = $state(false);
  let busy = $state<Set<string>>(new Set());
  let now = $state(Date.now());
  let scroller = $state<HTMLElement | null>(null);

  const workspace = $derived(session?.workspaces.find((candidate) => candidate.id === workspaceId) ?? null);
  const titles = $derived(new Map((control?.agents ?? []).map((agent) => [agent.nodeId, agent.title])));
  const timeline = $derived(buildTimeline(messages));
  const answers = $derived(answersByQuestion(messages));
  const channelTitle = $derived(channel === TEAM_CHANNEL ? `#${m['chat.team_channel']()}` : channels.find((entry) => entry.id === channel)?.title ?? '');

  async function api<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(path, {
      ...init,
      cache: 'no-store',
      headers: { ...(init?.body ? { 'content-type': 'application/json' } : {}), ...(token ? { 'x-orkestrai-mobile-token': token } : {}) },
    });
    if (response.status === 401) {
      failure = 'pair';
      throw new Error('unpaired');
    }
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error ?? 'request failed');
    failure = null;
    return body.data as T;
  }

  const base = $derived(workspaceId ? `/api/agent-room/workspaces/${encodeURIComponent(workspaceId)}` : '');

  async function refresh() {
    if (!workspaceId) return;
    try {
      const [items, summary, snapshot] = await Promise.all([
        api<AgentAttentionItem[]>(`/api/agent-room/attention?workspaceId=${encodeURIComponent(workspaceId)}&limit=100`),
        api<{ channels: ChannelSummary[] }>(`${base}/channels`),
        api<ControlCenterSnapshot>(`${base}/control-center`),
      ]);
      const time = Date.now();
      attention = items.filter((item) => item.workspaceId === workspaceId && (item.status === 'open' || item.status === 'read' || (item.status === 'snoozed' && new Date(item.snoozedUntil ?? 0).getTime() <= time)));
      channels = summary.channels;
      control = snapshot;
      if (channel) await loadMessages(false);
    } catch (error) {
      if (!(error instanceof Error && error.message === 'unpaired')) failure = 'offline';
    }
  }

  async function loadMessages(scroll = true) {
    if (!channel || !base) return;
    const page = await api<ChannelMessage[]>(`${base}/channels/${encodeURIComponent(channel)}/messages?limit=60`);
    const stick = !scroller || scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 120;
    messages = page;
    await tick();
    if ((scroll || stick) && scroller) scroller.scrollTop = scroller.scrollHeight;
  }

  async function openChannel(id: string) {
    channel = id;
    messages = [];
    await loadMessages(true);
  }

  // Long requests stay clamped until tapped.
  let expanded = $state<Set<string>>(new Set());
  function toggleExpanded(id: string) {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    expanded = next;
  }

  function setBusy(id: string, on: boolean) {
    const next = new Set(busy);
    if (on) next.add(id);
    else next.delete(id);
    busy = next;
  }

  async function decide(item: AgentAttentionItem, decision: 'approve' | 'reject') {
    setBusy(item.id, true);
    try {
      await api(`/api/agent-room/attention/${encodeURIComponent(item.id)}/decide`, { method: 'POST', body: JSON.stringify({ workspaceId: item.workspaceId, decision }) });
      attention = attention.filter((candidate) => candidate.id !== item.id);
    } catch {
      // The card stays; the next refresh shows the current state.
    } finally {
      setBusy(item.id, false);
    }
  }

  async function answerItem(item: AgentAttentionItem, text: string) {
    if (typeof item.action?.channel !== 'string' || !item.sourceId) return;
    setBusy(item.id, true);
    try {
      await api(`${base}/channels/${encodeURIComponent(item.action.channel)}/messages`, { method: 'POST', body: JSON.stringify({ body: text, replyToId: item.sourceId }) });
      attention = attention.filter((candidate) => candidate.id !== item.id);
    } catch {
      // Keep the card; the agent did not get the answer.
    } finally {
      setBusy(item.id, false);
    }
  }

  async function answerInChat(questionId: string, text: string): Promise<boolean> {
    if (!channel) return false;
    try {
      await api(`${base}/channels/${encodeURIComponent(channel)}/messages`, { method: 'POST', body: JSON.stringify({ body: text, replyToId: questionId }) });
      await loadMessages(true);
      return true;
    } catch {
      return false;
    }
  }

  async function send() {
    const text = draft.trim();
    if (!text || !channel || sending) return;
    sending = true;
    try {
      await api(`${base}/channels/${encodeURIComponent(channel)}/messages`, { method: 'POST', body: JSON.stringify({ body: text }) });
      draft = '';
      await loadMessages(true);
    } catch {
      // The draft stays so it can be sent again.
    } finally {
      sending = false;
    }
  }

  function chooseWorkspace(id: string) {
    workspaceId = id;
    channel = null;
    messages = [];
    try { localStorage.setItem(WORKSPACE_KEY, id); } catch { /* storage unavailable */ }
    void refresh();
  }

  onMount(() => {
    const fromLink = new URLSearchParams(location.hash.slice(1)).get('t');
    try {
      if (fromLink) localStorage.setItem(TOKEN_KEY, fromLink);
      token = fromLink ?? localStorage.getItem(TOKEN_KEY);
    } catch {
      token = fromLink;
    }
    if (fromLink) history.replaceState(null, '', '/m');
    void api<Session>('/api/agent-room/mobile/session').then(async (data) => {
      session = data;
      if (data.locale === 'pt-BR' || data.locale === 'en' || data.locale === 'es') localeState.current = data.locale;
      let remembered: string | null = null;
      try { remembered = localStorage.getItem(WORKSPACE_KEY); } catch { remembered = null; }
      // Without a remembered choice, open the workspace with the most requests waiting.
      let busiest: string | null = null;
      if (!data.workspaces.some((candidate) => candidate.id === remembered)) {
        const items = await api<AgentAttentionItem[]>('/api/agent-room/attention?limit=300').catch(() => []);
        const counts = new Map<string, number>();
        for (const item of items) if (item.status !== 'resolved') counts.set(item.workspaceId, (counts.get(item.workspaceId) ?? 0) + 1);
        busiest = data.workspaces.map((candidate) => candidate.id).sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0))[0] ?? null;
      }
      const first = data.workspaces.find((candidate) => candidate.id === remembered)?.id ?? busiest ?? data.workspaces[0]?.id ?? null;
      if (first) chooseWorkspace(first);
    }).catch(() => { if (failure !== 'pair') failure = 'offline'; });
    const timer = setInterval(() => { now = Date.now(); void refresh(); }, 5_000);
    return () => clearInterval(timer);
  });
</script>

<svelte:head>
  <title>Orkestrai</title>
  <link rel="manifest" href="/pwa/phone.webmanifest" />
  <link rel="apple-touch-icon" href="/pwa/apple-touch-icon.png" />
  <meta name="theme-color" content="#0b0c0f" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-title" content="Orkestrai" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
</svelte:head>

<main class="phone">
  {#if failure === 'pair'}
    <section class="center">
      <BellRing size={28} />
      <h1 class="headline">{m['phone.pair_title']()}</h1>
      <p>{m['phone.pair_body']()}</p>
    </section>
  {:else if !session}
    <section class="center">
      {#if failure === 'offline'}<p>{m['phone.offline']()}</p>{:else}<LoaderCircle size={22} class="animate-spin" />{/if}
    </section>
  {:else}
    <header class="top">
      {#if tab === 'chat' && channel}
        <button type="button" class="back" onclick={() => { channel = null; messages = []; }} aria-label={m['phone.back']()}><ArrowLeft size={18} /></button>
        <h1 class="title-line">{channelTitle}</h1>
      {:else}
        <span class="ws-mark" aria-hidden="true" style={workspace ? `--mark-bg:${agentColor(workspace.id).bg};--mark-ink:${agentColor(workspace.id).ink}` : ''}>{workspace ? workspace.name.slice(0, 1).toUpperCase() : ''}</span>
        <span class="ws-block">
          {#if session.workspaces.length > 1}
            <NativeSelect.Root class="ws-select" value={workspaceId ?? undefined} onchange={(event: Event) => chooseWorkspace((event.currentTarget as HTMLSelectElement).value)} aria-label={m['chat.workspace_label']()}>
              {#each session.workspaces as option (option.id)}<NativeSelect.Option value={option.id}>{option.name}</NativeSelect.Option>{/each}
            </NativeSelect.Root>
          {:else}
            <b>{workspace?.name ?? ''}</b>
          {/if}
          <small class:off={failure === 'offline'}><span class="dot" aria-hidden="true"></span>{failure === 'offline' ? m['phone.offline_short']() : m['phone.connected']()}</small>
        </span>
      {/if}
    </header>
    {#if !(tab === 'chat' && channel)}
      <h1 class="headline">{tab === 'needs' ? (attention.length === 0 ? m['phone.all_clear']() : attention.length === 1 ? m['phone.headline_one']() : m['phone.headline_many']({ count: attention.length })) : tab === 'chat' ? m['workspace_view.chat']() : m['canvas.team']()}</h1>
    {/if}

    <div class="body" bind:this={scroller}>
      {#if tab === 'needs'}
        {#each attention as item (item.id)}
          {@const kind = attentionDecisionKind(item)}
          {@const options = ownerQuestionOptions(item)}
          <article class="card" class:danger={item.severity === 'error'} class:open={expanded.has(item.id)} data-testid="phone-needs-card">
            <header class="kind">
              {#if item.nodeId && item.nodeTitle}<AgentAvatar nodeId={item.nodeId} title={item.nodeTitle} size={20} />{/if}
              <b>{kind ? m['phone.kind_approval']() : item.sourceType === 'owner_question' ? m['phone.kind_question']() : item.severity === 'error' ? m['phone.kind_blocked']() : m['phone.kind_notice']()}</b>
              {#if item.nodeTitle}<span>{item.nodeTitle}</span>{/if}
            </header>
            <button type="button" class="card-text" aria-expanded={expanded.has(item.id)} onclick={() => toggleExpanded(item.id)}>
              <h2>{item.title}</h2>
              {#if item.body && !options.length}<p>{item.body}</p>{/if}
            </button>
            {#if kind}
              {@const labels = decisionLabels(kind)}
              <div class="actions">
                <button type="button" class="secondary" disabled={busy.has(item.id)} onclick={() => void decide(item, 'reject')}>{labels.reject}</button>
                <button type="button" class="primary" disabled={busy.has(item.id)} onclick={() => void decide(item, 'approve')}>{labels.approve}</button>
              </div>
            {:else if item.sourceType === 'owner_question'}
              <div class="actions wrap">
                {#each options as option, index (option)}
                  <button type="button" class={index === 0 ? 'primary' : 'secondary'} disabled={busy.has(item.id)} onclick={() => void answerItem(item, option)}>{option}</button>
                {/each}
                <button type="button" class="secondary" onclick={() => { tab = 'chat'; if (typeof item.action?.channel === 'string') void openChannel(item.action.channel); }}>{m['node_attention.answer_in_chat']()}</button>
              </div>
            {/if}
          </article>
        {:else}
          <p class="empty">{m['remote.needs_empty']()}</p>
        {/each}
        {#if (control?.agents ?? []).some((agent) => agent.state === 'working' || agent.state === 'starting')}
          <p class="section-label">{m['phone.working']()}</p>
          {#each (control?.agents ?? []).filter((agent) => agent.state === 'working' || agent.state === 'starting') as agent (agent.nodeId)}
            {@const parts = elapsedParts(agent.stateSince, now)}
            <div class="run">
              <span class="run-head"><AgentAvatar nodeId={agent.nodeId} title={agent.title} size={22} /><b>{agent.title}</b>{#if parts}<span class="num">{elapsedLabel(parts)}</span>{/if}</span>
              {#if agent.lastAction || agent.currentTask}<small>{agent.lastAction ?? agent.currentTask?.title}</small>{/if}
            </div>
          {/each}
        {/if}
      {:else if tab === 'chat' && !channel}
        {#each channels as entry (entry.id)}
          <button type="button" class="row" onclick={() => void openChannel(entry.id)}>
            {#if entry.kind === 'team'}<span class="hash"><Hash size={16} /></span>{:else}<AgentAvatar nodeId={entry.nodeId ?? ''} title={entry.title} size={32} />{/if}
            <span class="row-text">
              <b>{entry.kind === 'team' ? `#${m['chat.team_channel']()}` : entry.title}</b>
              {#if entry.last}<small>{entry.last.body}</small>{/if}
            </span>
            {#if entry.openQuestions}<span class="badge">{entry.openQuestions}</span>{/if}
          </button>
        {/each}
      {:else if tab === 'chat'}
        {#each timeline as row (row.key)}
          {#if row.type === 'event'}
            <p class="event">{row.message.meta.event === 'task_done' ? m['chat.event_task_done_unassigned']({ title: row.message.body }) : row.message.body}</p>
          {:else if row.type === 'group'}
            <div class="bubble-group" class:mine={row.authorKind === 'owner'}>
              <small>{row.authorKind === 'owner' ? m['chat.you']() : row.authorKind === 'external' ? String(row.messages[0].meta.sender ?? '') : titles.get(row.authorNodeId ?? '') ?? m['chat.unknown_agent']()}</small>
              {#each row.messages as message (message.id)}
                {#if message.kind === 'question'}
                  <QuestionCard question={message} answer={answers.get(message.id) ?? null} authorTitle={titles.get(message.authorNodeId ?? '') ?? ''} onAnswer={answerInChat} />
                {:else}
                  <div class="bubble">
                    {#if typeof message.meta.to === 'string'}<span class="to">→ {titles.get(message.meta.to) ?? m['chat.unknown_agent']()}</span>{/if}
                    <MarkdownView content={message.body} compact />
                    {#if typeof message.meta.reply === 'string' && message.meta.reply}
                      <div class="reply"><b>{titles.get(String(message.meta.to)) ?? ''}</b><MarkdownView content={message.meta.reply} compact /></div>
                    {/if}
                  </div>
                {/if}
              {/each}
            </div>
          {/if}
        {:else}
          <p class="empty">{m['chat.empty_team']()}</p>
        {/each}
      {:else}
        {#each control?.agents ?? [] as agent (agent.nodeId)}
          {@const activity = agent.sessionAlive ? agent.state : 'disconnected'}
          {@const parts = elapsedParts(agent.stateSince, now)}
          <div class="row static">
            <AgentAvatar nodeId={agent.nodeId} title={agent.title} size={32} />
            <span class="row-text">
              <b>{agent.title}</b>
              <small>{agentStateLabel(activity)}{#if parts}{` · ${elapsedLabel(parts)}`}{/if}{#if agent.currentTask}{` · ${agent.currentTask.title}`}{/if}</small>
            </span>
            <AgentGlyph tone={agentTone(activity)} label={agentStateLabel(activity)} />
          </div>
        {:else}
          <p class="empty">{m['chat.no_agents']()}</p>
        {/each}
      {/if}
    </div>

    {#if tab === 'chat' && channel}
      <form class="composer" onsubmit={(event) => { event.preventDefault(); void send(); }}>
        <input bind:value={draft} placeholder={m['composer.placeholder']()} aria-label={m['composer.send']()} />
        <button type="submit" disabled={!draft.trim() || sending} aria-label={m['composer.send']()}>
          {#if sending}<LoaderCircle size={16} class="animate-spin" />{:else}<ArrowUp size={16} />{/if}
        </button>
      </form>
    {/if}

    <nav class="tabs" aria-label={m['phone.tabs']()}>
      <button type="button" class:active={tab === 'needs'} onclick={() => (tab = 'needs')}>
        <Inbox size={19} /><span>{m['phone.tab_central']()}</span>{#if attention.length}<i>{attention.length}</i>{/if}
      </button>
      <button type="button" class:active={tab === 'chat'} onclick={() => (tab = 'chat')}>
        <MessagesSquare size={19} /><span>{m['workspace_view.chat']()}</span>
      </button>
      <button type="button" class:active={tab === 'team'} onclick={() => (tab = 'team')}>
        <UsersRound size={19} /><span>{m['canvas.team']()}</span>
      </button>
    </nav>
  {/if}
</main>

<style>
  .phone {
    height: 100dvh;
    display: flex;
    flex-direction: column;
    background: var(--app-bg);
    color: var(--app-text);
    padding-top: env(safe-area-inset-top);
  }

  .center {
    margin: auto;
    max-width: 320px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    padding: 24px;
    text-align: center;
    color: var(--app-text-soft);
  }

  .center h1 {
    margin: 0;
    color: var(--app-text);
    font-size: 28px;
  }

  .top {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 18px 18px 6px;
  }

  .title-line {
    margin: 0;
    flex: 1;
    min-width: 0;
    overflow: hidden;
    font-size: 17px;
    font-weight: 650;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ws-mark {
    width: 34px;
    height: 34px;
    flex: none;
    display: grid;
    place-items: center;
    border-radius: 10px;
    background: var(--mark-bg, var(--app-hover));
    color: var(--mark-ink, var(--app-text));
    font-size: 14px;
    font-weight: 700;
  }

  .ws-block {
    min-width: 0;
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .ws-block b {
    font-size: 15px;
    font-weight: 650;
  }

  .ws-block :global(.ws-select) {
    max-width: 100%;
  }

  .ws-block :global(.ws-select select) {
    height: 26px;
    padding-left: 0;
    border: 0;
    background: transparent;
    box-shadow: none;
    color: var(--app-text);
    font-size: 15px;
    font-weight: 650;
  }

  .ws-block small {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--app-text-muted);
    font-size: 12px;
  }

  .ws-block small .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--app-success);
  }

  .ws-block small.off {
    color: var(--app-warning);
  }

  .ws-block small.off .dot {
    background: var(--app-warning);
  }

  .headline {
    margin: 6px 18px 4px;
    font-family: var(--font-headline);
    font-stretch: 62%;
    font-size: 36px;
    font-weight: 700;
    line-height: 1;
    letter-spacing: -0.01em;
    text-wrap: balance;
  }

  .section-label {
    margin: 8px 2px 0;
    color: var(--app-text-muted);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  .run {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 12px 14px;
    border-radius: 14px;
    border: 1px solid var(--app-border);
  }

  .run-head {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .run-head b {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 550;
  }

  .run .num {
    color: var(--app-text-muted);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }

  .run small {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--app-text-muted);
    font-size: 12.5px;
  }

  .back {
    width: 36px;
    height: 36px;
    display: grid;
    place-items: center;
    border: 0;
    border-radius: 10px;
    background: var(--app-hover);
    color: var(--app-text);
  }

  .body {
    min-height: 0;
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 14px 16px;
    overflow-y: auto;
  }

  .card {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 14px;
    border-radius: 16px;
    background: var(--app-surface);
    box-shadow: inset 0 0 0 1px var(--app-border-strong);
  }

  .card.danger {
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--app-danger) 40%, transparent);
  }

  .kind {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .kind b {
    color: var(--app-warning);
    font-size: 11.5px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .danger .kind b {
    color: var(--app-danger);
  }

  .kind span {
    min-width: 0;
    overflow: hidden;
    color: var(--app-text-muted);
    font-size: 12.5px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .card-text {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 0;
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
  }

  .card h2,
  .card p {
    margin: 0;
    overflow: hidden;
    overflow-wrap: anywhere;
    display: -webkit-box;
    -webkit-box-orient: vertical;
  }

  .card h2 {
    font-size: 15px;
    font-weight: 550;
    line-height: 1.4;
    -webkit-line-clamp: 3;
    line-clamp: 3;
  }

  .card p {
    color: var(--app-text-soft);
    font-size: 14px;
    -webkit-line-clamp: 3;
    line-clamp: 3;
  }

  .card.open h2,
  .card.open p {
    display: block;
  }

  .card small,
  .row small,
  .bubble-group small {
    color: var(--app-text-muted);
    font-size: 12px;
  }

  .actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    margin-top: 6px;
  }

  .actions.wrap {
    display: flex;
    flex-wrap: wrap;
  }

  .actions button,
  .composer button {
    min-height: 44px;
    padding: 0 16px;
    border: 0;
    border-radius: 12px;
    font: inherit;
    font-size: 15px;
    font-weight: 600;
  }

  .actions .primary {
    background: var(--app-accent);
    color: var(--app-accent-contrast);
  }

  .actions .secondary {
    background: transparent;
    box-shadow: inset 0 0 0 1px var(--app-border-strong);
    color: var(--app-text);
  }

  .actions button:disabled {
    opacity: 0.5;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 56px;
    padding: 8px 4px;
    border: 0;
    border-bottom: 1px solid var(--app-border);
    background: transparent;
    color: var(--app-text);
    font: inherit;
    text-align: left;
  }

  .row-text {
    min-width: 0;
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .row-text b {
    font-size: 15px;
  }

  .row-text small {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .hash {
    width: 32px;
    height: 32px;
    display: grid;
    place-items: center;
    border-radius: 10px;
    background: var(--app-surface);
  }

  .badge,
  .tabs i {
    min-width: 20px;
    height: 20px;
    padding: 0 6px;
    border-radius: 999px;
    background: var(--app-warning);
    color: #1b1300;
    font-size: 12px;
    font-style: normal;
    font-weight: 700;
    line-height: 20px;
    text-align: center;
  }

  .bubble-group {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
  }

  .bubble-group.mine {
    align-items: flex-end;
  }

  .bubble {
    max-width: 88%;
    min-width: 0;
    overflow-wrap: anywhere;
    padding: 8px 12px;
    border-radius: 14px;
    background: var(--app-surface);
    font-size: 14.5px;
    line-height: 1.5;
  }

  .bubble .to {
    display: block;
    margin-bottom: 2px;
    color: var(--app-accent);
    font-size: 12px;
    font-weight: 600;
  }

  .bubble .reply {
    margin-top: 8px;
    padding: 6px 10px;
    border-left: 2px solid var(--app-border-strong);
    border-radius: 0 8px 8px 0;
    background: var(--app-surface-raised);
  }

  .bubble .reply b {
    font-size: 12px;
  }

  .mine .bubble {
    background: var(--app-accent-soft);
  }

  .event {
    align-self: center;
    margin: 0;
    color: var(--app-text-muted);
    font-size: 12.5px;
  }

  .empty {
    margin: 40px auto;
    color: var(--app-text-muted);
    font-size: 14px;
    text-align: center;
  }

  .composer {
    display: flex;
    gap: 8px;
    padding: 8px 12px;
    border-top: 1px solid var(--app-border);
  }

  .composer input {
    flex: 1;
    min-width: 0;
    min-height: 44px;
    padding: 0 14px;
    border: 0;
    border-radius: 12px;
    background: var(--app-surface);
    color: var(--app-text);
    font: inherit;
    font-size: 16px;
  }

  .composer button {
    width: 48px;
    padding: 0;
    display: grid;
    place-items: center;
    background: var(--app-accent);
    color: var(--app-accent-contrast);
  }

  .composer button:disabled {
    opacity: 0.5;
  }

  .tabs {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    border-top: 1px solid var(--app-border);
    padding-bottom: env(safe-area-inset-bottom);
    background: var(--app-sidebar);
  }

  .tabs button {
    position: relative;
    min-height: 58px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 3px;
    border: 0;
    background: transparent;
    color: var(--app-text-muted);
    font: inherit;
    font-size: 11.5px;
    font-weight: 600;
  }

  .tabs button.active {
    color: var(--app-accent);
  }

  .tabs i {
    position: absolute;
    top: 6px;
    left: calc(50% + 6px);
  }

  button:focus-visible,
  input:focus-visible {
    outline: 2px solid var(--app-accent);
    outline-offset: 2px;
  }
</style>
