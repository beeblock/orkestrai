<script lang="ts">
  import { getCsrfToken } from '@beeblock/svelar/http';
  import { toast } from '@beeblock/svelar/ui';
  import { CheckCircle2, Clock3, Crosshair, LoaderCircle, PanelsTopLeft, SendHorizontal } from '@lucide/svelte';
  import { answerOwnerQuestion, attentionDecisionKind, attentionFeed, decideAttentionItem, ownerQuestionOptions, updateAttentionItem } from './attention-feed.svelte.js';
  import { decisionLabels } from './attention-decision-labels.js';
  import { agentStatus, statusClock } from './agent-status.svelte.js';
  import { agentTone, elapsedParts } from './agent-identity.js';
  import { elapsedLabel } from './agent-status-labels.js';
  import AgentGlyph from './AgentGlyph.svelte';
  import AgentAvatar from './AgentAvatar.svelte';
  import MarkdownView from './MarkdownView.svelte';
  import type { AgentAttentionItem } from '$lib/modules/agent-room/domain/types.js';
  import * as m from '$lib/paraglide/messages.js';

  /**
   * Focus home: what needs the owner, newest first, with the details and
   * the decision on the right; below, who is working right now.
   */
  let {
    onOpenAgent,
    onShowCanvas,
  }: {
    onOpenAgent: (nodeId: string) => void;
    onShowCanvas: (nodeId: string) => void;
  } = $props();

  type Kind = { label: string; tone: 'warn' | 'gold' | 'err' | 'muted' };

  const items = $derived([...attentionFeed.items].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
  let selectedId = $state<string | null>(null);
  const selected = $derived(items.find((item) => item.id === selectedId) ?? items[0] ?? null);
  let busy = $state(false);
  let draft = $state('');
  let resolved = $state<Array<{ id: string; text: string }>>([]);

  const working = $derived(Object.values(agentStatus.agents).filter((agent) => agent.state === 'working' || agent.state === 'starting'));

  function kindOf(item: AgentAttentionItem): Kind {
    const decision = attentionDecisionKind(item);
    if (item.sourceType === 'owner_question') return { label: m['focus.kind_question'](), tone: 'warn' };
    if (decision === 'gate' || decision === 'flow') return { label: m['focus.kind_approval'](), tone: 'warn' };
    if (decision === 'tool') return { label: m['focus.kind_tool'](), tone: 'warn' };
    if (decision === 'learning') return { label: m['focus.kind_lesson'](), tone: 'gold' };
    if (decision === 'review' || item.category === 'review') return { label: m['focus.kind_review'](), tone: 'gold' };
    if (item.severity === 'error') return { label: m['focus.kind_blocked'](), tone: 'err' };
    return { label: m['focus.kind_notice'](), tone: 'muted' };
  }

  function when(value: string): string {
    const parts = elapsedParts(value, statusClock.now);
    return parts ? elapsedLabel(parts) : '';
  }

  function nodeIdOf(item: AgentAttentionItem): string | null {
    return item.nodeId ?? (typeof item.action?.nodeId === 'string' ? item.action.nodeId : null);
  }

  function settle(item: AgentAttentionItem, text: string) {
    resolved = [{ id: item.id, text }, ...resolved].slice(0, 5);
    selectedId = null;
    draft = '';
  }

  async function decide(item: AgentAttentionItem, decision: 'approve' | 'reject') {
    busy = true;
    const error = await decideAttentionItem(item, decision, getCsrfToken());
    busy = false;
    if (error !== null) toast.error(error || m['attention.decide_failed']());
    else settle(item, `${decisionLabels(attentionDecisionKind(item) ?? 'gate')[decision]} · ${item.title}`);
  }

  async function answer(item: AgentAttentionItem, text: string) {
    const value = text.trim();
    if (!value) return;
    busy = true;
    const delivered = await answerOwnerQuestion(item, value, getCsrfToken());
    busy = false;
    if (!delivered) toast.error(m['node_attention.answer_failed']());
    else settle(item, `${value} · ${item.nodeTitle ?? item.title}`);
  }

  async function resolve(item: AgentAttentionItem) {
    busy = true;
    const ok = await updateAttentionItem(item, 'resolved', getCsrfToken());
    busy = false;
    if (ok) settle(item, item.title);
  }

  async function snooze(item: AgentAttentionItem) {
    busy = true;
    const ok = await updateAttentionItem(item, 'snoozed', getCsrfToken(), new Date(Date.now() + 60 * 60 * 1000).toISOString());
    busy = false;
    if (ok) selectedId = null;
  }
</script>

<div class="inbox" data-testid="focus-inbox">
  <section class="list" aria-labelledby="focus-inbox-title">
    <header class="page-head">
      <h1 id="focus-inbox-title">{m['focus.inbox_title']()}</h1>
      <span class="sub">{items.length ? m['focus.inbox_count']({ count: items.length }) : m['focus.inbox_none']()}</span>
    </header>
    <div class="scroll">
      {#each items as item (item.id)}
        {@const kind = kindOf(item)}
        <button type="button" class="row" class:on={selected?.id === item.id} onclick={() => (selectedId = item.id)} data-testid="focus-inbox-row">
          <span class="mark" data-tone={kind.tone} aria-hidden="true"></span>
          <span class="t"><span class="kind" data-tone={kind.tone}>{kind.label}</span>{item.title}</span>
          <span class="when">{when(item.updatedAt)}</span>
          <span class="m">{[item.nodeTitle, item.body?.split('\n')[0]].filter(Boolean).join(' · ')}</span>
        </button>
      {:else}
        <div class="empty"><CheckCircle2 size={22} /><strong>{m['focus.inbox_empty_title']()}</strong><span>{m['focus.inbox_empty_body']()}</span></div>
      {/each}

      {#if resolved.length}
        <p class="section-gap">{m['focus.resolved_now']()}</p>
        {#each resolved as entry (entry.id)}
          <div class="done-row"><CheckCircle2 size={14} /><span>{entry.text}</span></div>
        {/each}
      {/if}

      {#if working.length}
        <p class="section-gap">{m['focus.working']()}</p>
        {#each working as agent (agent.nodeId)}
          <button type="button" class="row" onclick={() => onOpenAgent(agent.nodeId)}>
            <span class="glyph"><AgentGlyph tone={agentTone(agent.state)} label={agent.state} /></span>
            <span class="t">{agent.title}{#if agent.currentTask}<span class="muted"> · {agent.currentTask.title}</span>{/if}</span>
            <span class="when">{when(agent.stateSince)}</span>
            {#if agent.lastAction}<span class="m mono">{agent.lastAction}</span>{/if}
          </button>
        {/each}
      {/if}
    </div>
  </section>

  <aside class="inspector" aria-label={selected?.title ?? m['focus.inbox_title']()}>
    {#if selected}
      {@const kind = kindOf(selected)}
      {@const decision = attentionDecisionKind(selected)}
      {@const options = ownerQuestionOptions(selected)}
      {@const nodeId = nodeIdOf(selected)}
      <div class="insp-head"><span class="kind" data-tone={kind.tone}>{kind.label}</span><span class="grow"></span><span class="when">{when(selected.updatedAt)}</span></div>
      <div class="insp-body">
        <h2>{selected.title}</h2>
        <dl class="kv">
          {#if selected.nodeTitle}<dt>{m['focus.agent']()}</dt><dd class="who">{#if nodeId}<AgentAvatar nodeId={nodeId} title={selected.nodeTitle} size={16} />{/if}{selected.nodeTitle}</dd>{/if}
          {#if nodeId && agentStatus.agents[nodeId]?.currentTask}<dt>{m['focus.task']()}</dt><dd>{agentStatus.agents[nodeId].currentTask?.title}</dd>{/if}
        </dl>
        {#if selected.body}<div class="body"><MarkdownView content={selected.body} compact /></div>{/if}

        {#if decision}
          {@const labels = decisionLabels(decision)}
          <div class="actions">
            <button type="button" class="btn primary" disabled={busy} onclick={() => void decide(selected, 'approve')}>{#if busy}<LoaderCircle size={13} class="animate-spin" />{/if}{labels.approve}</button>
            <button type="button" class="btn" disabled={busy} onclick={() => void decide(selected, 'reject')}>{labels.reject}</button>
          </div>
        {:else if selected.sourceType === 'owner_question'}
          {#if options.length}
            <div class="actions">
              {#each options as option, index (option)}
                <button type="button" class="btn" class:primary={index === 0} disabled={busy} onclick={() => void answer(selected, option)}>{option}</button>
              {/each}
            </div>
          {/if}
          <form class="reply" onsubmit={(event) => { event.preventDefault(); void answer(selected, draft); }}>
            <input bind:value={draft} placeholder={m['focus.answer_placeholder']()} aria-label={m['focus.answer_placeholder']()} disabled={busy} />
            <button type="submit" class="send" aria-label={m['focus.answer_send']()} disabled={busy || !draft.trim()}><SendHorizontal size={14} /></button>
          </form>
        {:else}
          <div class="actions">
            <button type="button" class="btn primary" disabled={busy} onclick={() => void resolve(selected)}>{m['focus.resolve']()}</button>
          </div>
        {/if}

        <div class="links">
          {#if nodeId}
            <button type="button" class="link" onclick={() => onOpenAgent(nodeId)}><PanelsTopLeft size={13} />{m['focus.open_agent']()}</button>
            <button type="button" class="link" onclick={() => onShowCanvas(nodeId)}><Crosshair size={13} />{m['focus.show_canvas']()}</button>
          {/if}
          <button type="button" class="link" disabled={busy} onclick={() => void snooze(selected)}><Clock3 size={13} />{m['focus.snooze']()}</button>
        </div>
      </div>
    {:else}
      <div class="insp-body"><p class="muted">{m['focus.select_item']()}</p></div>
    {/if}
  </aside>
</div>

<style>
  .inbox {
    height: 100%;
    min-height: 0;
    display: grid;
    grid-template-columns: minmax(0, 1fr) 320px;
  }

  .list {
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  .page-head {
    height: 48px;
    flex: none;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0 18px;
    border-bottom: 1px solid var(--app-border);
  }

  .page-head h1 {
    margin: 0;
    font-size: 13.5px;
    font-weight: 650;
  }

  .sub,
  .when,
  .muted {
    color: var(--app-text-muted);
  }

  .sub {
    font-size: 12.5px;
  }

  .scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
  }

  .row {
    width: 100%;
    display: grid;
    grid-template-columns: 20px minmax(0, 1fr) auto;
    column-gap: 12px;
    row-gap: 3px;
    align-items: center;
    padding: 12px 18px;
    border: 0;
    border-bottom: 1px solid var(--app-border);
    background: transparent;
    text-align: left;
    color: var(--app-text);
    transition: background-color var(--duration-quick) ease-out;
  }

  .row:hover {
    background: var(--app-hover);
  }

  .row.on {
    background: color-mix(in srgb, var(--app-text) 6%, transparent);
    box-shadow: inset 2px 0 0 var(--app-accent);
  }

  .row:focus-visible {
    outline: 2px solid var(--app-accent);
    outline-offset: -2px;
  }

  .mark {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    justify-self: center;
    background: var(--app-text-muted);
  }

  .mark[data-tone='warn'] { background: var(--app-warning); box-shadow: 0 0 0 3px color-mix(in srgb, var(--app-warning) 20%, transparent); }
  .mark[data-tone='gold'] { background: transparent; border: 1.8px solid var(--app-accent); }
  .mark[data-tone='err'] { border-radius: 2px; background: var(--app-danger); }

  .glyph {
    justify-self: center;
    display: inline-grid;
  }

  .t {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 13px;
    font-weight: 500;
  }

  .kind {
    margin-right: 8px;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--app-text-muted);
  }

  .kind[data-tone='warn'] { color: var(--app-warning); }
  .kind[data-tone='gold'] { color: var(--app-accent); }
  .kind[data-tone='err'] { color: var(--app-danger); }

  .when {
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .m {
    grid-column: 2 / 4;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--app-text-muted);
    font-size: 12px;
  }

  .mono {
    font-family: var(--font-mono);
    font-size: 11.5px;
  }

  .section-gap {
    margin: 0;
    padding: 20px 18px 8px;
    color: var(--app-text-muted);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }

  .done-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 9px 18px;
    border-bottom: 1px solid var(--app-border);
    color: var(--app-text-muted);
    font-size: 12.5px;
  }

  .done-row :global(svg) {
    color: var(--app-success);
    flex: none;
  }

  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 56px 24px;
    color: var(--app-text-muted);
    text-align: center;
  }

  .empty :global(svg) {
    color: var(--app-success);
  }

  .empty strong {
    color: var(--app-text);
    font-weight: 600;
  }

  .inspector {
    min-height: 0;
    display: flex;
    flex-direction: column;
    border-left: 1px solid var(--app-border);
    background: var(--app-page);
  }

  .insp-head {
    height: 48px;
    flex: none;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 16px;
    border-bottom: 1px solid var(--app-border);
  }

  .grow {
    flex: 1;
  }

  .insp-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .insp-body h2 {
    margin: 0;
    font-size: 15px;
    font-weight: 650;
    line-height: 1.35;
    text-wrap: balance;
    overflow-wrap: anywhere;
  }

  .kv {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 7px 12px;
    margin: 0;
    font-size: 12px;
  }

  .kv dt {
    color: var(--app-text-muted);
  }

  .kv dd {
    margin: 0;
    color: var(--app-text-soft);
    text-align: right;
    overflow-wrap: anywhere;
  }

  .kv dd.who {
    display: inline-flex;
    justify-content: flex-end;
    align-items: center;
    gap: 6px;
  }

  .body {
    max-height: 260px;
    overflow-y: auto;
    padding: 10px 12px;
    border-radius: 10px;
    border: 1px solid var(--app-border);
    background: var(--app-surface);
    font-size: 12.5px;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .btn {
    min-height: 30px;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 0 14px;
    border: 1px solid var(--app-border-strong);
    border-radius: 999px;
    background: transparent;
    color: var(--app-text);
    font-size: 12.5px;
    font-weight: 500;
  }

  .btn:hover:not(:disabled) {
    background: var(--app-hover);
  }

  .btn.primary {
    border-color: var(--app-accent);
    background: var(--app-accent);
    color: var(--app-accent-contrast);
    font-weight: 600;
  }

  .btn:disabled {
    opacity: 0.55;
  }

  .reply {
    display: flex;
    gap: 6px;
    padding: 4px 4px 4px 12px;
    border-radius: 999px;
    border: 1px solid var(--app-border-strong);
    background: var(--app-surface);
  }

  .reply input {
    flex: 1;
    min-width: 0;
    border: 0;
    outline: none;
    background: transparent;
    color: var(--app-text);
    font-size: 12.5px;
  }

  .send {
    width: 28px;
    height: 28px;
    display: grid;
    place-items: center;
    border: 0;
    border-radius: 50%;
    background: var(--app-accent);
    color: var(--app-accent-contrast);
  }

  .send:disabled {
    opacity: 0.45;
  }

  .links {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    padding-top: 6px;
    border-top: 1px solid var(--app-border);
  }

  .link {
    height: 28px;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 0 9px;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: var(--app-text-soft);
    font-size: 12px;
  }

  .link:hover:not(:disabled) {
    background: var(--app-hover);
    color: var(--app-text);
  }

  @media (max-width: 1100px) {
    .inbox {
      grid-template-columns: minmax(0, 1fr);
    }

    .inspector {
      display: none;
    }
  }
</style>
