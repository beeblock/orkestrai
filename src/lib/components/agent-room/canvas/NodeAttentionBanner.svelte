<script lang="ts">
  import { AlertTriangle, BellRing, Clock3, CornerDownLeft, Maximize2, ShieldAlert, SquareTerminal } from '@lucide/svelte';
  import { getCsrfToken } from '@beeblock/svelar/http';
  import { toast } from '@beeblock/svelar/ui';
  import { attentionDecisionKind, attentionFeed, decideAttentionItem, updateAttentionItem } from '../attention-feed.svelte.js';
  import { decisionLabels } from '../attention-decision-labels.js';
  import type { AgentActivityState, AgentAttentionItem } from '$lib/modules/agent-room/domain/types.js';
  import * as m from '$lib/paraglide/messages.js';

  let {
    nodeId,
    workspaceId,
    activity,
    onRespond,
    onShowTerminal,
  }: {
    nodeId: string;
    workspaceId: string;
    activity: AgentActivityState | null;
    onRespond: () => void;
    onShowTerminal: () => void;
  } = $props();

  const SEVERITY_ORDER = { error: 0, warning: 1, info: 2, success: 3 } as const;
  const items = $derived([...(attentionFeed.byNode[nodeId] ?? [])].sort((a, b) => (
    SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || b.createdAt.localeCompare(a.createdAt)
  )));
  const item = $derived<AgentAttentionItem | null>(items[0] ?? null);
  // Without a recorded item, the terminal itself is what is waiting.
  const live = $derived(!item && (activity === 'waiting_permission' || activity === 'waiting_input' || activity === 'blocked' || activity === 'error') ? activity : null);
  let busy = $state(false);
  // The whole message opens in place; another item starts collapsed again.
  let expandedId = $state<string | null>(null);
  const expanded = $derived(Boolean(item) && expandedId === item?.id);
  // Focus shows the agent's whole terminal next to its requests and conversation.
  const focusHref = $derived(`/terminal?${new URLSearchParams({ workspace: workspaceId, node: nodeId }).toString()}`);

  // A question the agent asked the owner can be answered right here.
  const question = $derived(item?.sourceType === 'owner_question' && item.sourceId ? item : null);
  const questionOptions = $derived(Array.isArray(question?.action?.options) ? (question.action.options as unknown[]).filter((option): option is string => typeof option === 'string').slice(0, 3) : []);
  const chatHref = $derived(question && typeof question.action?.channel === 'string'
    ? `/chat?${new URLSearchParams({ workspace: question.workspaceId, channel: question.action.channel }).toString()}`
    : null);

  async function answer(option: string) {
    if (!question?.sourceId || busy || typeof question.action?.channel !== 'string') return;
    busy = true;
    const csrf = getCsrfToken();
    const response = await fetch(`/api/agent-room/workspaces/${encodeURIComponent(question.workspaceId)}/channels/${encodeURIComponent(question.action.channel)}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(csrf ? { 'X-CSRF-Token': csrf } : {}) },
      body: JSON.stringify({ body: option, replyToId: question.sourceId }),
    }).catch(() => null);
    busy = false;
    const result = response?.ok ? await response.json().catch(() => null) : null;
    if (!result || result.data?.delivered?.some((entry: { ok: boolean }) => !entry.ok)) toast.error(m['node_attention.answer_failed']());
  }

  const decisionKind = $derived(item ? attentionDecisionKind(item) : null);

  async function decide(decision: 'approve' | 'reject') {
    if (!item || busy) return;
    busy = true;
    const error = await decideAttentionItem(item, decision, getCsrfToken());
    busy = false;
    if (error !== null) toast.error(error || m['attention.decide_failed']());
  }

  async function update(status: 'resolved' | 'snoozed') {
    if (!item || busy) return;
    busy = true;
    const ok = await updateAttentionItem(item, status, getCsrfToken(), status === 'snoozed' ? new Date(Date.now() + 60 * 60 * 1000).toISOString() : undefined);
    busy = false;
    if (!ok) toast.error(m['attention.update_error']());
  }
</script>

{#if item}
  <div class="banner nodrag" class:danger={item.severity === 'error'} role="status" data-testid="node-attention-banner">
    <span class="mark" aria-hidden="true">{#if item.category === 'review'}<ShieldAlert size={14} />{:else}<BellRing size={14} />{/if}</span>
    <button
      type="button"
      class="copy nowheel"
      class:expanded
      aria-expanded={expanded}
      title={expanded ? m['node_attention.collapse']() : m['node_attention.expand']()}
      onclick={() => (expandedId = expanded ? null : item.id)}
    >
      <strong><span class="title-text">{item.title}</span>{#if items.length > 1}<span class="more">+{items.length - 1}</span>{/if}</strong>
      {#if item.body}<span class="body-text">{item.body}</span>{/if}
    </button>
    <div class="actions">
      {#if question}
        {#each questionOptions as option (option)}
          <button type="button" class="primary" disabled={busy} onclick={() => void answer(option)} title={option}><span class="option">{option}</span></button>
        {/each}
        {#if chatHref}<a class="link" href={chatHref}><CornerDownLeft size={12} />{m['node_attention.answer_in_chat']()}</a>{/if}
      {:else if decisionKind}
        {@const labels = decisionLabels(decisionKind)}
        <button type="button" disabled={busy} onclick={() => void decide('reject')}>{labels.reject}</button>
        <button type="button" class="primary" disabled={busy} onclick={() => void decide('approve')}>{labels.approve}</button>
      {:else}
        <a class="link" href={focusHref} title={m['node_attention.open_focus_hint']()}><Maximize2 size={12} />{m['node_attention.open_focus']()}</a>
        <button type="button" class="primary" onclick={() => { expandedId = item.id; onRespond(); }}><CornerDownLeft size={12} />{m['node_attention.respond']()}</button>
        <button type="button" disabled={busy} onclick={() => void update('resolved')}>{m['attention.resolve']()}</button>
      {/if}
      <button type="button" class="icon" disabled={busy} onclick={() => void update('snoozed')} aria-label={m['attention.snooze']()} title={m['attention.snooze']()}><Clock3 size={13} /></button>
    </div>
  </div>
{:else if live}
  <div class="banner nodrag" class:danger={live === 'error' || live === 'blocked'} role="status" data-testid="node-attention-banner">
    <span class="mark" aria-hidden="true">{#if live === 'waiting_permission'}<ShieldAlert size={14} />{:else if live === 'waiting_input'}<BellRing size={14} />{:else}<AlertTriangle size={14} />{/if}</span>
    <div class="copy">
      <strong>{live === 'waiting_permission' ? m['node_attention.permission']() : live === 'waiting_input' ? m['node_attention.input']() : m['node_attention.stopped']()}</strong>
      <span>{live === 'waiting_permission' ? m['node_attention.permission_hint']() : live === 'waiting_input' ? m['node_attention.input_hint']() : m['node_attention.stopped_hint']()}</span>
    </div>
    <div class="actions">
      {#if live === 'waiting_input'}
        <button type="button" class="primary" onclick={onRespond}><CornerDownLeft size={12} />{m['node_attention.respond']()}</button>
      {/if}
      <button type="button" class:primary={live !== 'waiting_input'} onclick={onShowTerminal}><SquareTerminal size={12} />{m['node_attention.show_terminal']()}</button>
    </div>
  </div>
{/if}

<style>
  .banner {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 9px;
    margin: 0 8px 6px;
    padding: 8px 8px 8px 10px;
    border-radius: 10px;
    background: color-mix(in srgb, var(--app-warning) 13%, var(--app-surface));
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--app-warning) 34%, transparent);
    color: var(--app-text);
  }

  .banner.danger {
    background: color-mix(in srgb, var(--app-danger) 12%, var(--app-surface));
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--app-danger) 34%, transparent);
  }

  .mark {
    width: 26px;
    height: 26px;
    flex: none;
    display: grid;
    place-items: center;
    border-radius: 8px;
    background: color-mix(in srgb, var(--app-warning) 22%, transparent);
    color: var(--app-warning);
  }

  .danger .mark {
    background: color-mix(in srgb, var(--app-danger) 20%, transparent);
    color: var(--app-danger);
  }

  .copy {
    min-width: 0;
    flex: 1 1 200px;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  button.copy {
    padding: 0;
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  button.copy:focus-visible {
    border-radius: 4px;
    outline: 2px solid var(--app-accent);
    outline-offset: 2px;
  }

  .copy strong {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    font-size: 12.5px;
    font-weight: 600;
    line-height: 1.35;
  }

  .copy .title-text,
  .copy .body-text {
    display: -webkit-box;
    overflow: hidden;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    overflow-wrap: anywhere;
  }

  .copy .body-text,
  .copy > span {
    color: var(--app-text-soft);
    font-size: 11.5px;
    line-height: 1.4;
  }

  /* Opened, the whole message shows and scrolls inside the banner. */
  .copy.expanded {
    max-height: 220px;
    overflow-y: auto;
  }

  .copy.expanded .title-text,
  .copy.expanded .body-text {
    display: block;
    overflow: visible;
    -webkit-line-clamp: unset;
    line-clamp: none;
    white-space: pre-wrap;
  }

  .copy .more {
    flex: none;
    padding: 0 6px;
    border-radius: 999px;
    background: var(--app-hover);
    color: var(--app-text-soft);
    font-size: 11px;
    font-weight: 600;
  }

  .actions {
    display: flex;
    align-items: center;
    gap: 4px;
    flex: none;
    margin-left: auto;
  }

  .actions button,
  .actions .link {
    height: 26px;
    text-decoration: none;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 0 9px;
    border: 0;
    border-radius: 7px;
    background: var(--app-hover);
    color: var(--app-text);
    font: inherit;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
  }

  .actions button:hover:not(:disabled),
  .actions .link:hover {
    background: var(--app-active);
  }

  .actions button.primary {
    background: var(--app-text);
    color: var(--app-surface);
  }

  .actions button.primary:hover:not(:disabled) {
    background: color-mix(in srgb, var(--app-text) 86%, transparent);
  }

  .option {
    max-width: 140px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .actions button.icon {
    width: 26px;
    padding: 0;
    justify-content: center;
  }

  .actions button:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .actions button:focus-visible,
  .actions .link:focus-visible {
    outline: 2px solid var(--app-accent);
    outline-offset: 1px;
  }
</style>
