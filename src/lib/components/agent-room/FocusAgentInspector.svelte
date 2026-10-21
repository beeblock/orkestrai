<script lang="ts">
  import { getCsrfToken } from '@beeblock/svelar/http';
  import { toast } from '@beeblock/svelar/ui';
  import { CircleAlert, Crosshair, ListChecks, SendHorizontal, X } from '@lucide/svelte';
  import AgentAvatar from './AgentAvatar.svelte';
  import StatusPill from './StatusPill.svelte';
  import AgentChatFace from './chat/AgentChatFace.svelte';
  import { agentStatus, statusClock } from './agent-status.svelte.js';
  import { agentTone, elapsedParts } from './agent-identity.js';
  import { activityEventLabel, agentDoingLabel, agentStateLabel, elapsedLabel } from './agent-status-labels.js';
  import { answerOwnerQuestion, attentionDecisionKind, attentionFeed, decideAttentionItem, isActiveAttention, ownerQuestionOptions, updateAttentionItem } from './attention-feed.svelte.js';
  import { decisionLabels } from './attention-decision-labels.js';
  import type { AgentActivity, AgentAttentionItem, CanvasNode, TerminalNodePayload } from '$lib/modules/agent-room/domain/types.js';
  import { getLocale } from '$lib/paraglide/runtime.js';
  import * as m from '$lib/paraglide/messages.js';

  /**
   * Beside an agent in Focus: what it is doing, its task, what waits for the
   * owner from it, its recent activity and a direct conversation (typed or spoken).
   */
  let {
    workspaceId,
    node,
    activity = [],
    onClose,
    onOpenTasks,
    onShowCanvas,
  }: {
    workspaceId: string;
    node: CanvasNode;
    activity?: AgentActivity[];
    onClose: () => void;
    onOpenTasks: () => void;
    onShowCanvas: () => void;
  } = $props();

  const payload = $derived((node.payload ?? {}) as TerminalNodePayload);
  const live = $derived(agentStatus.agents[node.id] ?? null);
  const agentState = $derived(live ? (live.sessionAlive ? live.state : 'disconnected') : 'idle');
  const since = $derived.by(() => {
    const parts = elapsedParts(live?.stateSince ?? null, statusClock.now);
    return parts ? elapsedLabel(parts) : null;
  });
  const pending = $derived((attentionFeed.byNode[node.id] ?? []).filter((item) => isActiveAttention(item)));
  const recent = $derived(activity.filter((event) => event.nodeId === node.id).slice(0, 8));

  let busy = $state<string | null>(null);
  let replies = $state<Record<string, string>>({});
  async function decide(item: AgentAttentionItem, decision: 'approve' | 'reject') {
    busy = item.id;
    const error = await decideAttentionItem(item, decision, getCsrfToken());
    busy = null;
    if (error !== null) toast.error(error || m['attention.decide_failed']());
  }
  async function answer(item: AgentAttentionItem, text: string) {
    busy = item.id;
    const ok = await answerOwnerQuestion(item, text, getCsrfToken());
    busy = null;
    if (!ok) toast.error(m['node_attention.answer_failed']());
  }
  async function resolve(item: AgentAttentionItem) {
    busy = item.id;
    const ok = await updateAttentionItem(item, 'resolved', getCsrfToken());
    busy = null;
    if (!ok) toast.error(m['focus_agent.action_failed']());
  }

  function when(iso: string): string {
    const date = new Date(iso);
    if (!Number.isFinite(date.getTime())) return '';
    return new Intl.DateTimeFormat(getLocale(), { hour: '2-digit', minute: '2-digit' }).format(date);
  }
</script>

<aside class="inspector" aria-label={m['focus_agent.label']({ name: node.title ?? '' })} data-testid="focus-agent-inspector">
  <header>
    <AgentAvatar nodeId={node.id} title={node.title ?? ''} size={30} />
    <div class="who">
      <strong>{node.title}</strong>
      <span>{[payload.role, payload.provider].filter(Boolean).join(' · ') || m['focus_agent.no_role']()}</span>
    </div>
    <button type="button" class="icon" onclick={onShowCanvas} aria-label={m['focus.show_canvas']()} title={m['focus.show_canvas']()}><Crosshair size={14} /></button>
    <button type="button" class="icon" onclick={onClose} aria-label={m['focus_agent.close']()} title={m['focus_agent.close']()}><X size={14} /></button>
  </header>

  <section class="now" aria-label={m['focus_agent.now']()}>
    <div class="line"><StatusPill tone={agentTone(agentState)} label={agentStateLabel(agentState)} />{#if since}<span class="muted">{since}</span>{/if}</div>
    {#if live}<p class="doing">{agentDoingLabel(live)}</p>{/if}
  </section>

  <section>
    <h3>{m['focus.task']()}</h3>
    {#if live?.currentTask}
      <button type="button" class="task" onclick={onOpenTasks} title={m['focus_agent.open_tasks']()}><ListChecks size={13} /><span>{live.currentTask.title}</span></button>
    {:else}
      <p class="muted">{m['focus_agent.no_task']()}</p>
    {/if}
  </section>

  {#if pending.length}
    <section>
      <h3>{m['focus.inbox_title']()} <span class="count">{pending.length}</span></h3>
      {#each pending.slice(0, 4) as item (item.id)}
        {@const kind = attentionDecisionKind(item)}
        {@const options = ownerQuestionOptions(item)}
        <article class="ask" data-testid="focus-agent-ask">
          <p class="ask-title"><CircleAlert size={13} /><span>{item.title}</span></p>
          {#if item.body}<p class="ask-body">{item.body}</p>{/if}
          <div class="ask-actions">
            {#if kind}
              {@const labels = decisionLabels(kind)}
              <button type="button" class="primary" disabled={busy === item.id} onclick={() => void decide(item, 'approve')}>{labels.approve}</button>
              <button type="button" disabled={busy === item.id} onclick={() => void decide(item, 'reject')}>{labels.reject}</button>
            {:else if item.sourceType === 'owner_question'}
              {#each options.slice(0, 3) as option, index (option)}
                <button type="button" class:primary={index === 0} disabled={busy === item.id} onclick={() => void answer(item, option)}>{option}</button>
              {/each}
              <form class="reply" onsubmit={(event) => { event.preventDefault(); const text = replies[item.id]?.trim(); if (text) void answer(item, text).then(() => (replies[item.id] = '')); }}>
                <input bind:value={replies[item.id]} placeholder={m['focus.answer_placeholder']()} aria-label={m['focus.answer_placeholder']()} disabled={busy === item.id} />
                <button type="submit" class="primary" disabled={busy === item.id || !replies[item.id]?.trim()} aria-label={m['focus.answer_send']()}><SendHorizontal size={13} /></button>
              </form>
            {:else}
              <button type="button" disabled={busy === item.id} onclick={() => void resolve(item)}>{m['focus.resolve']()}</button>
            {/if}
          </div>
        </article>
      {/each}
    </section>
  {/if}

  {#if recent.length}
    <section>
      <h3>{m['focus_agent.activity']()}</h3>
      <ol class="timeline">
        {#each recent as event (event.id)}
          <li><span class="time">{when(event.createdAt)}</span><span>{activityEventLabel(event)}</span></li>
        {/each}
      </ol>
    </section>
  {/if}

  <section class="conversation">
    <h3>{m['focus_agent.conversation']()}</h3>
    <div class="thread">{#key node.id}<AgentChatFace {workspaceId} nodeId={node.id} title={node.title ?? ''} voice />{/key}</div>
  </section>
</aside>

<style>
  .inspector {
    height: 100%;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 14px 14px 12px;
    overflow-y: auto;
    border-left: 1px solid var(--app-border);
    background: var(--app-sidebar);
  }

  header {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .who {
    min-width: 0;
    flex: 1;
    display: flex;
    flex-direction: column;
  }

  .who strong {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 14px;
    font-weight: 600;
  }

  .who span,
  .muted {
    color: var(--app-text-muted);
    font-size: 11.5px;
  }

  .icon {
    width: 26px;
    height: 26px;
    display: grid;
    place-items: center;
    border: 0;
    border-radius: 7px;
    background: transparent;
    color: var(--app-text-muted);
  }

  .icon:hover {
    background: var(--app-hover);
    color: var(--app-text);
  }

  section {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  h3 {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0;
    color: var(--app-text-muted);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  .count {
    padding: 0 6px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--app-warning) 18%, transparent);
    color: var(--app-text);
    letter-spacing: 0;
  }

  .now .line {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  p {
    margin: 0;
    color: var(--app-text-soft);
    font-size: 12.5px;
    line-height: 1.45;
  }

  .task {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 8px 10px;
    border: 1px solid var(--app-border);
    border-radius: 10px;
    background: var(--app-surface);
    color: var(--app-text);
    font-size: 12.5px;
    text-align: left;
  }

  .task:hover {
    border-color: var(--app-border-strong);
  }

  .ask {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 9px 10px;
    border-radius: 10px;
    background: color-mix(in srgb, var(--app-warning) 9%, var(--app-surface));
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--app-warning) 28%, transparent);
  }

  .doing {
    color: var(--app-text);
    font-size: 13px;
  }

  .ask-title {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    color: var(--app-text);
    font-weight: 600;
  }

  .ask-body {
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
    font-size: 12px;
  }

  .ask-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .ask-actions button {
    height: 26px;
    padding: 0 10px;
    border: 1px solid var(--app-border-strong);
    border-radius: 999px;
    background: transparent;
    color: var(--app-text);
    font-size: 12px;
  }

  .ask-actions button.primary {
    border-color: transparent;
    background: var(--app-accent);
    color: var(--app-accent-contrast);
    font-weight: 600;
  }

  .reply {
    flex-basis: 100%;
    display: flex;
    gap: 6px;
  }

  .reply input {
    flex: 1;
    min-width: 0;
    height: 28px;
    padding: 0 10px;
    border: 1px solid var(--app-border);
    border-radius: 8px;
    background: var(--app-surface);
    color: var(--app-text);
    font: inherit;
    font-size: 12px;
    outline: none;
  }

  .reply input:focus-visible {
    border-color: var(--app-accent);
  }

  .ask-actions .reply button {
    width: 28px;
    height: 28px;
    padding: 0;
    display: grid;
    place-items: center;
    border-radius: 8px;
  }

  .ask-actions button:disabled {
    opacity: 0.5;
  }

  .timeline {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 5px;
  }

  .timeline li {
    display: grid;
    grid-template-columns: 38px minmax(0, 1fr);
    gap: 8px;
    color: var(--app-text-soft);
    font-size: 12px;
    line-height: 1.4;
  }

  .timeline .time {
    color: var(--app-text-muted);
    font-family: var(--font-mono);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
  }

  .conversation {
    flex: 1;
    min-height: 260px;
  }

  .thread {
    flex: 1;
    min-height: 220px;
    overflow: hidden;
    border-radius: 12px;
    border: 1px solid var(--app-border);
    background: var(--app-surface);
  }

  button:focus-visible {
    outline: 2px solid var(--app-accent);
    outline-offset: 2px;
  }
</style>
