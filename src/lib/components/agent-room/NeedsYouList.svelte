<script lang="ts">
  import { getCsrfToken } from '@beeblock/svelar/http';
  import { toast } from '@beeblock/svelar/ui';
  import { ChevronDown } from '@lucide/svelte';
  import { answerOwnerQuestion, attentionDecisionKind, attentionFeed, decideAttentionItem, ownerQuestionOptions } from './attention-feed.svelte.js';
  import { decisionLabels } from './attention-decision-labels.js';
  import type { AgentAttentionItem } from '$lib/modules/agent-room/domain/types.js';
  import * as m from '$lib/paraglide/messages.js';

  let { onOpen, limit = 6 }: { onOpen: (item: AgentAttentionItem) => void; limit?: number } = $props();

  let collapsed = $state(false);
  let busy = $state<Set<string>>(new Set());
  const items = $derived([...attentionFeed.items].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));

  function setBusy(id: string, on: boolean) {
    const next = new Set(busy);
    if (on) next.add(id);
    else next.delete(id);
    busy = next;
  }

  async function decide(item: AgentAttentionItem, decision: 'approve' | 'reject') {
    setBusy(item.id, true);
    const error = await decideAttentionItem(item, decision, getCsrfToken());
    setBusy(item.id, false);
    if (error !== null) toast.error(error || m['attention.decide_failed']());
  }

  async function answer(item: AgentAttentionItem, option: string) {
    setBusy(item.id, true);
    const delivered = await answerOwnerQuestion(item, option, getCsrfToken());
    setBusy(item.id, false);
    if (!delivered) toast.error(m['node_attention.answer_failed']());
  }
</script>

{#if items.length}
  <section class="needs-you" aria-labelledby="needs-you-title" data-testid="needs-you-list">
    <button type="button" class="heading" aria-expanded={!collapsed} onclick={() => (collapsed = !collapsed)}>
      <span id="needs-you-title">{m['needs_you.title']()}</span>
      <span class="count">{items.length}</span>
      <ChevronDown size={12} class={collapsed ? 'rotate-[-90deg]' : ''} />
    </button>
    {#if !collapsed}
      <ul>
        {#each items.slice(0, limit) as item (item.id)}
          {@const kind = attentionDecisionKind(item)}
          {@const options = ownerQuestionOptions(item)}
          <li class:danger={item.severity === 'error'}>
            <button type="button" class="open" onclick={() => onOpen(item)} title={item.title}>
              <span class="dot" aria-hidden="true"></span>
              <span class="text"><b>{item.title}</b>{#if item.nodeTitle}<small>{item.nodeTitle}</small>{/if}</span>
            </button>
            {#if kind}
              {@const labels = decisionLabels(kind)}
              <div class="actions">
                <button type="button" disabled={busy.has(item.id)} onclick={() => void decide(item, 'reject')}>{labels.reject}</button>
                <button type="button" class="primary" disabled={busy.has(item.id)} onclick={() => void decide(item, 'approve')}>{labels.approve}</button>
              </div>
            {:else if options.length}
              <div class="actions">
                {#each options.slice(0, 3) as option (option)}
                  <button type="button" class="primary" disabled={busy.has(item.id)} title={option} onclick={() => void answer(item, option)}><span class="option">{option}</span></button>
                {/each}
              </div>
            {/if}
          </li>
        {/each}
      </ul>
      {#if items.length > limit}
        <button type="button" class="more" onclick={() => window.dispatchEvent(new CustomEvent('orkestrai:open-attention'))}>{m['needs_you.more']({ count: items.length - limit })}</button>
      {/if}
    {/if}
  </section>
{/if}

<style>
  .needs-you {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 6px 8px 8px;
  }

  .heading {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 24px;
    padding: 0 4px;
    border: 0;
    background: transparent;
    color: var(--app-warning);
    font: inherit;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    cursor: pointer;
  }

  .count {
    min-width: 17px;
    height: 17px;
    padding: 0 5px;
    border-radius: 999px;
    background: var(--app-warning);
    color: #1b1300;
    font-size: 11px;
    line-height: 17px;
    text-align: center;
    letter-spacing: 0;
  }

  ul {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  li {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 7px 8px;
    border-radius: 9px;
    background: color-mix(in srgb, var(--app-warning) 8%, var(--app-surface));
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--app-warning) 24%, transparent);
  }

  li.danger {
    background: color-mix(in srgb, var(--app-danger) 8%, var(--app-surface));
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--app-danger) 24%, transparent);
  }

  .open {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--app-text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .dot {
    width: 7px;
    height: 7px;
    flex: none;
    margin-top: 5px;
    border-radius: 999px;
    background: var(--app-warning);
  }

  .danger .dot {
    background: var(--app-danger);
  }

  .text {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .text b {
    overflow: hidden;
    font-size: 12.5px;
    font-weight: 600;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
  }

  .text small {
    color: var(--app-text-muted);
    font-size: 11.5px;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    padding-left: 15px;
  }

  .actions button,
  .more {
    height: 24px;
    padding: 0 8px;
    border: 0;
    border-radius: 6px;
    background: var(--app-hover);
    color: var(--app-text);
    font: inherit;
    font-size: 11.5px;
    font-weight: 500;
    cursor: pointer;
  }

  .actions button.primary {
    background: var(--app-text);
    color: var(--app-surface);
  }

  .actions button:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .option {
    display: inline-block;
    max-width: 120px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    vertical-align: bottom;
  }

  .more {
    align-self: flex-start;
    background: transparent;
    color: var(--app-text-soft);
  }

  .heading:focus-visible,
  .open:focus-visible,
  .actions button:focus-visible,
  .more:focus-visible {
    outline: 2px solid var(--app-accent);
    outline-offset: 1px;
    border-radius: 6px;
  }
</style>
