<script lang="ts">
  import { getCsrfToken } from '@beeblock/svelar/http';
  import { toast } from '@beeblock/svelar/ui';
  import { CheckCircle2, GitPullRequestArrow, LoaderCircle } from '@lucide/svelte';
  import { attentionDecisionKind, decideAttentionItem, updateAttentionItem } from '../attention-feed.svelte.js';
  import { decisionLabels } from '../attention-decision-labels.js';
  import AgentAvatar from '../AgentAvatar.svelte';
  import MarkdownView from '../MarkdownView.svelte';
  import type { AgentAttentionItem } from '$lib/modules/agent-room/domain/types.js';
  import * as m from '$lib/paraglide/messages.js';

  /** A request that waits for the owner, decided right in the conversation. */
  let { item }: { item: AgentAttentionItem } = $props();

  const kind = $derived(attentionDecisionKind(item));
  let busy = $state(false);
  let decided = $state<string | null>(null);

  async function decide(decision: 'approve' | 'reject') {
    if (!kind) return;
    busy = true;
    const error = await decideAttentionItem(item, decision, getCsrfToken());
    busy = false;
    if (error !== null) toast.error(error || m['attention.decide_failed']());
    else decided = decisionLabels(kind)[decision];
  }

  async function later() {
    busy = true;
    await updateAttentionItem(item, 'snoozed', getCsrfToken(), new Date(Date.now() + 60 * 60 * 1000).toISOString());
    busy = false;
  }
</script>

<article class="request" class:done={decided} data-testid="chat-request-card">
  {#if decided}
    <p class="done-line"><CheckCircle2 size={14} />{m['chat.request_done']({ decision: decided })} · {item.title}</p>
  {:else}
    <header>
      {#if item.nodeId && item.nodeTitle}<AgentAvatar nodeId={item.nodeId} title={item.nodeTitle} size={18} />{:else}<GitPullRequestArrow size={14} />{/if}
      <b>{item.title}</b>
      <span class="grow"></span>
      <span class="waits">{m['chat.request_waits']()}</span>
    </header>
    {#if item.body}<div class="body"><MarkdownView content={item.body} compact /></div>{/if}
    {#if kind}
      {@const labels = decisionLabels(kind)}
      <div class="actions">
        <button type="button" class="primary" disabled={busy} onclick={() => void decide('approve')}>{#if busy}<LoaderCircle size={13} class="animate-spin" />{/if}{labels.approve}</button>
        <button type="button" disabled={busy} onclick={() => void decide('reject')}>{labels.reject}</button>
        <button type="button" class="quiet" disabled={busy} onclick={() => void later()}>{m['chat.request_later']()}</button>
      </div>
    {/if}
  {/if}
</article>

<style>
  .request {
    max-width: 580px;
    margin: 6px 0 6px 46px;
    border: 1px solid var(--app-border-strong);
    border-radius: 14px;
    background: var(--app-surface);
    overflow: hidden;
    animation: card-in var(--duration-fast) var(--ease-smooth-out);
  }

  @keyframes card-in {
    from { opacity: 0; transform: translateY(4px); }
  }

  header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 12px;
    border-bottom: 1px solid var(--app-border);
    background: linear-gradient(90deg, color-mix(in srgb, var(--app-accent) 9%, transparent), transparent 70%);
    font-size: 13px;
  }

  header b {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 600;
  }

  .grow {
    flex: 1;
  }

  .waits {
    color: var(--app-warning);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    white-space: nowrap;
  }

  .body {
    max-height: 180px;
    overflow-y: auto;
    padding: 10px 12px 0;
    color: var(--app-text-soft);
    font-size: 12.5px;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    padding: 10px 12px 12px;
  }

  .actions button {
    min-height: 28px;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 0 12px;
    border: 1px solid var(--app-border-strong);
    border-radius: 999px;
    background: transparent;
    color: var(--app-text);
    font-size: 12.5px;
  }

  .actions button:hover:not(:disabled) {
    background: var(--app-hover);
  }

  .actions .primary {
    border-color: var(--app-accent);
    background: var(--app-accent);
    color: var(--app-accent-contrast);
    font-weight: 600;
  }

  .actions .quiet {
    border-color: transparent;
    color: var(--app-text-soft);
  }

  .actions button:disabled {
    opacity: 0.55;
  }

  .done-line {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0;
    padding: 10px 12px;
    color: var(--app-text-muted);
    font-size: 12.5px;
  }

  .done-line :global(svg) {
    color: var(--app-success);
  }
</style>
