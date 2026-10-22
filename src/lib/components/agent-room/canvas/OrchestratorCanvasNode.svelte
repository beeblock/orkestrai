<script lang="ts">
  import { useNodes, type NodeProps } from '@xyflow/svelte';
  import { getCsrfToken } from '@beeblock/svelar/http';
  import { ArrowUp, Cable, LoaderCircle, LocateFixed, Mic, Plus, Star, X } from '@lucide/svelte';
  import ComposerVoice from './ComposerVoice.svelte';
  import { sendToAgent } from './CanvasComposer.svelte';
  import { TEXT_DICTATION_COMMAND } from '../text-dictation.js';
  import NodeShell from './NodeShell.svelte';
  import HeaderIconButton from './HeaderIconButton.svelte';
  import AgentAvatar from '../AgentAvatar.svelte';
  import AttachmentList from '../AttachmentList.svelte';
  import ComposerAttachButton from '../ComposerAttachButton.svelte';
  import { ComposerAttachments } from '../composer-attachments.svelte.js';
  import StatusPill from '../StatusPill.svelte';
  import { agentStatus } from '../agent-status.svelte.js';
  import { agentColor, agentTone } from '../agent-identity.js';
  import { agentStateLabel } from '../agent-status-labels.js';
  import { providerIcons } from '$lib/modules/agent-room/domain/provider-icons.js';
  import { TEAM_CHANNEL } from '$lib/modules/agent-room/domain/channels.js';
  import * as m from '$lib/paraglide/messages.js';

  export type OrchestratorNodeData = {
    title: string;
    workspaceId: string;
    payload: Record<string, unknown>;
    onDelete: (id: string) => void;
    onResize?: (id: string, params: { x: number; y: number; width: number; height: number }) => void;
    onJumpToNode?: (nodeId: string) => void;
    onRecruit?: () => void;
    onConnectAll?: (id: string) => Promise<number> | number;
    onRename?: (id: string, title: string) => void;
    connections?: import('./NodeShell.svelte').NodeConnection[];
    onRemoveConnection?: (edgeId: string) => void;
    onToggleMaestro?: (id: string) => void;
  };

  let { id, data, selected } = $props<NodeProps & { data: OrchestratorNodeData }>();
  const staged = new ComposerAttachments(() => data.workspaceId);

  const PROVIDER_NAMES: Record<string, string> = { claude: 'Claude', codex: 'Codex', kimi: 'Kimi', opencode: 'OpenCode', cursor: 'Cursor', antigravity: 'Antigravity', cline: 'Cline', devin: 'Devin', copilot: 'Copilot', gemini: 'Gemini', qwen: 'Qwen', aider: 'Aider', goose: 'goose', amp: 'Amp' };

  type Row = { id: string; title: string; role: string | null; provider: string | null; leader: boolean; state: string; tone: ReturnType<typeof agentTone> };
  type Section = { id: string; title: string; tint: string | null; rows: Row[] };

  const nodesStore = useNodes();

  /** The team on this board: agents grouped by their named group frame. */
  const sections = $derived.by<Section[]>(() => {
    const all = nodesStore.current;
    const agents = all.filter((node) => node.type === 'terminal' && (node.data as { payload?: { provider?: string } }).payload?.provider);
    const groups = all.filter((node) => node.type === 'group');
    const placed = new Set<string>();
    const row = (node: (typeof agents)[number]): Row => {
      const payload = (node.data as { payload?: { provider?: string; role?: string | null; maestro?: boolean } }).payload ?? {};
      const live = agentStatus.agents[node.id];
      const state = live ? (live.sessionAlive ? live.state : 'disconnected') : 'idle';
      return { id: node.id, title: String((node.data as { title?: string }).title ?? ''), role: payload.role ?? null, provider: payload.provider ?? null, leader: Boolean(payload.maestro), state, tone: agentTone(state as never) };
    };
    const result: Section[] = [];
    for (const group of groups) {
      const members = new Set(((group.data as { payload?: { members?: string[] } }).payload?.members) ?? []);
      const rows = agents.filter((agent) => members.has(agent.id) && !placed.has(agent.id)).map(row);
      rows.forEach((item) => placed.add(item.id));
      if (rows.length) result.push({ id: group.id, title: String((group.data as { title?: string }).title ?? ''), tint: agentColor(group.id).bg, rows });
    }
    const loose = agents.filter((agent) => !placed.has(agent.id)).map(row);
    if (loose.length) result.unshift({ id: 'loose', title: '', tint: null, rows: loose });
    return result;
  });

  // Panels made before the rename kept the old default title; show the current name instead.
  const LEGACY_TITLES = new Set(['Orquestrador', 'Orchestrator', 'Orquestador']);
  const panelTitle = $derived(!data.title || LEGACY_TITLES.has(data.title) ? m['orchestrator.title']() : data.title);
  const total = $derived(sections.reduce((sum, section) => sum + section.rows.length, 0));
  const working = $derived(sections.reduce((sum, section) => sum + section.rows.filter((item) => item.tone === 'working').length, 0));
  const groupCount = $derived(sections.filter((section) => section.id !== 'loose').length);
  // This node is the leader's panel: the leader agent distributes what is said here.
  const leader = $derived(sections.flatMap((section) => section.rows).find((item) => item.leader) ?? null);
  // A teammate chosen in the list receives the next message directly.
  let recipient = $state<Row | null>(null);
  const prompt = $derived(recipient
    ? m['orchestrator.placeholder_direct']({ name: recipient.title })
    : leader ? m['orchestrator.placeholder_leader']({ name: leader.title }) : m['orchestrator.placeholder_no_leader']());

  let draft = $state('');
  // Without a leader, only @mentioned teammates would receive the message.
  const canSend = $derived(Boolean(recipient) || Boolean(leader) || draft.includes('@'));
  let voiceOpen = $state(false);
  let inputEl = $state<HTMLInputElement | null>(null);
  let mentionOpen = $state(false);
  let mentionFilter = $state('');
  const mentionOptions = $derived(sections.flatMap((section) => section.rows)
    .filter((item) => item.title.toLowerCase().includes(mentionFilter.toLowerCase()))
    .slice(0, 6));

  // Reads the field itself, so @ works whatever order the browser updates the binding in.
  function onDraftInput() {
    const match = (inputEl?.value ?? draft).match(/@([\p{L}\p{N} ._-]*)$/u);
    mentionOpen = Boolean(match);
    mentionFilter = match?.[1] ?? '';
  }

  function insertMention(item: Row) {
    draft = draft.replace(/@([\p{L}\p{N} ._-]*)$/u, `@${item.title} `);
    mentionOpen = false;
    inputEl?.focus();
  }

  function onDraftKeydown(event: KeyboardEvent) {
    if (mentionOpen && mentionOptions.length && (event.key === 'Enter' || event.key === 'Tab')) {
      event.preventDefault();
      insertMention(mentionOptions[0]);
    } else if (event.key === 'Escape' && mentionOpen) {
      event.stopPropagation();
      mentionOpen = false;
    }
  }

  function chooseRecipient(item: Row) {
    recipient = recipient?.id === item.id ? null : item;
    requestAnimationFrame(() => inputEl?.focus());
  }

  async function onVoiceTranscript(text: string, mode: 'send' | 'edit') {
    draft = draft.trim() ? `${draft.trimEnd()} ${text}` : text;
    if (mode === 'send') await send();
    else requestAnimationFrame(() => inputEl?.focus());
  }

  // Voice models not installed yet: the app's dictation flow offers the download.
  function onVoiceSetup() {
    voiceOpen = false;
    requestAnimationFrame(() => {
      inputEl?.focus();
      window.dispatchEvent(new Event(TEXT_DICTATION_COMMAND));
    });
  }
  let sending = $state(false);
  let feedback = $state<{ ok: boolean; text: string } | null>(null);
  let connecting = $state(false);
  let feedbackTimer: ReturnType<typeof setTimeout> | null = null;

  function flash(ok: boolean, text: string) {
    feedback = { ok, text };
    if (feedbackTimer) clearTimeout(feedbackTimer);
    feedbackTimer = setTimeout(() => (feedback = null), ok ? 2200 : 5000);
  }

  // One message to the team channel: unmentioned goes to the leader, who
  // distributes it; @mentions reach those teammates directly.
  async function send() {
    const text = draft.trim();
    const attachments = [...staged.items];
    if ((!text && !attachments.length) || sending || !canSend || staged.busy) return;
    sending = true;
    if (recipient) {
      const target = recipient;
      const delivered = await sendToAgent(data.workspaceId, target.id, text, attachments);
      sending = false;
      if (delivered) {
        staged.clear();
        if (draft.trim() === text) draft = '';
        flash(true, m['orchestrator.sent_direct']({ name: target.title }));
      } else {
        flash(false, m['orchestrator.failed']());
      }
      return;
    }
    const csrf = getCsrfToken();
    const response = await fetch(`/api/agent-room/workspaces/${encodeURIComponent(data.workspaceId)}/channels/${encodeURIComponent(TEAM_CHANNEL)}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(csrf ? { 'X-CSRF-Token': csrf } : {}) },
      body: JSON.stringify({ body: text, attachments }),
    }).catch(() => null);
    sending = false;
    if (response?.ok) {
      staged.clear();
      if (draft.trim() === text) draft = '';
      flash(true, leader && !text.includes('@') ? m['orchestrator.sent_leader']({ name: leader.title }) : m['orchestrator.sent']());
    } else {
      flash(false, m['orchestrator.failed']());
    }
  }

  async function connectAll() {
    if (!data.onConnectAll || connecting) return;
    connecting = true;
    const count = await data.onConnectAll(id);
    connecting = false;
    flash(true, m['orchestrator.connected']({ count }));
  }

  function providerName(provider: string | null): string {
    if (!provider) return '';
    return PROVIDER_NAMES[provider] ?? provider.charAt(0).toUpperCase() + provider.slice(1);
  }
</script>

<NodeShell
  {id}
  {selected}
  class="canvas-orchestrator"
  accent="var(--app-accent)"
  edge="color-mix(in srgb, var(--app-accent) 38%, transparent)"
  minWidth={300}
  minHeight={320}
  onResize={data.onResize}
  connections={data.connections ?? []}
  titleText={panelTitle}
  onRename={data.onRename}
  onJumpToNode={data.onJumpToNode}
  onRemoveConnection={data.onRemoveConnection}
>
  {#snippet icon()}<span class="orb" aria-hidden="true"></span>{/snippet}
  {#snippet title()}{panelTitle}{/snippet}
  {#snippet actions()}
    <span class="tally" title={m['orchestrator.working_count']({ working, total })}>
      <span class="ring" style:--pct={`${total ? Math.round((working / total) * 100) : 0}%`} aria-hidden="true"></span>
      {working}/{total}
    </span>
    <HeaderIconButton class="node-action-btn" label={m['term.remove_terminal']()} danger onclick={() => data.onDelete(id)}>
      <X size={13} />
    </HeaderIconButton>
  {/snippet}

  <div class="orch nodrag nowheel" data-testid="orchestrator-node">
    <div class="sub">
      <span>{m['orchestrator.summary']({ agents: total, groups: groupCount })}</span>
      <span class="grow"></span>
      {#if data.onRecruit}
        <button type="button" class="round" aria-label={m['orchestrator.recruit']()} title={m['orchestrator.recruit']()} onclick={() => data.onRecruit?.()}><Plus size={14} /></button>
      {/if}
      {#if data.onConnectAll}
        <button type="button" class="connect" title={m['orchestrator.connect_hint']()} disabled={connecting || total === 0} onclick={connectAll}>
          {#if connecting}<LoaderCircle size={13} class="animate-spin" />{:else}<Cable size={13} />{/if}
          {m['orchestrator.connect']()}
        </button>
      {/if}
    </div>

    {#if total > 0}
      {#if leader}
        <button type="button" class="leader" onclick={() => data.onJumpToNode?.(leader.id)} title={leader.title}>
          <Star size={13} class="star" aria-hidden="true" />
          <span class="leader-label">{m['orchestrator.led_by']()}</span>
          <AgentAvatar nodeId={leader.id} title={leader.title} size={18} />
          <b>{leader.title}</b>
        </button>
      {:else}
        <p class="no-leader" role="note">{m['orchestrator.no_leader']()}</p>
      {/if}
    {/if}

    <div class="list">
      {#each sections as section (section.id)}
        {#if section.title}
          {@const sectionWorking = section.rows.filter((item) => item.tone === 'working').length}
          <div class="section-head" style:--tint={section.tint}>
            <span class="dot" aria-hidden="true"></span>
            <span class="name">{section.title}</span>
            <span class="count">{sectionWorking}/{section.rows.length}</span>
          </div>
        {/if}
        {#each section.rows as item (item.id)}
          <div class="row-wrap" class:chosen={recipient?.id === item.id}>
          <button type="button" class="row" onclick={() => chooseRecipient(item)} aria-pressed={recipient?.id === item.id} title={m['orchestrator.talk_to']({ name: item.title })}>
            <span class="avatar">
              <AgentAvatar nodeId={item.id} title={item.title} size={26} />
              {#if item.provider && providerIcons[item.provider]}
                <img class="provider app-logo-plate" src={providerIcons[item.provider]} width="11" height="11" alt="" />
              {/if}
            </span>
            <span class="who">
              <b>{item.title}</b>
              <small>{[item.role, providerName(item.provider)].filter(Boolean).join(' · ')}</small>
            </span>
            {#if item.leader}<Star size={13} class="star" aria-label={m['orchestrator.leader']()} />{/if}
            <StatusPill tone={item.tone} label={agentStateLabel(item.state as never)} />
          </button>
          <button type="button" class="locate" onclick={() => data.onJumpToNode?.(item.id)} aria-label={m['orchestrator.show_on_canvas']({ name: item.title })} title={m['orchestrator.show_on_canvas']({ name: item.title })}><LocateFixed size={13} /></button>
          </div>
          {#if !leader && data.onToggleMaestro}
            <button type="button" class="make-leader" onclick={() => data.onToggleMaestro?.(item.id)}>{m['orchestrator.make_leader']({ name: item.title })}</button>
          {/if}
        {/each}
      {:else}
        <div class="empty">
          <span class="orb big" aria-hidden="true"></span>
          <strong>{m['orchestrator.empty_title']()}</strong>
          <p>{m['orchestrator.empty_body']()}</p>
          {#if data.onRecruit}<button type="button" class="connect solid" onclick={() => data.onRecruit?.()}><Plus size={13} />{m['orchestrator.recruit']()}</button>{/if}
        </div>
      {/each}
    </div>

    {#if feedback}<p class="feedback" class:error={!feedback.ok} role="status">{feedback.text}</p>{/if}
    {#if recipient}
      <div class="to-chip">
        <span>{m['orchestrator.to']()}</span>
        <AgentAvatar nodeId={recipient.id} title={recipient.title} size={16} />
        <b>{recipient.title}</b>
        <button type="button" onclick={() => (recipient = null)} aria-label={m['orchestrator.clear_recipient']()} title={m['orchestrator.clear_recipient']()}><X size={12} /></button>
      </div>
    {/if}
    {#if mentionOpen && mentionOptions.length}
      <div class="panel-mentions" role="listbox" aria-label={m['composer.mention']()}>
        {#each mentionOptions as option (option.id)}
          <button type="button" role="option" aria-selected="false" onclick={() => insertMention(option)}>
            <AgentAvatar nodeId={option.id} title={option.title} size={18} />
            <span>{option.title}</span>
          </button>
        {/each}
      </div>
    {/if}
    {#if staged.error}<p class="staged-error" role="alert">{staged.error}</p>{/if}
    {#if staged.items.length}<div class="staged"><AttachmentList workspaceId={data.workspaceId} attachments={staged.items} compact onRemove={staged.remove} /></div>{/if}
    <form class="command" class:voice={voiceOpen} class:dropping={staged.dragging} aria-label={m['composer.drop_files']()} onsubmit={(event) => { event.preventDefault(); void send(); }} ondragover={staged.dragover} ondragleave={staged.dragleave} ondrop={staged.drop}>
      {#if voiceOpen}
        <ComposerVoice onTranscript={onVoiceTranscript} onClose={() => (voiceOpen = false)} onSetupNeeded={onVoiceSetup} />
      {:else}
        <input bind:this={inputEl} bind:value={draft} placeholder={prompt} aria-label={prompt} disabled={total === 0} oninput={onDraftInput} onkeydown={onDraftKeydown} oncompositionend={onDraftInput} onpaste={staged.paste} />
        <ComposerAttachButton attachments={staged} class="attach" disabled={total === 0} />
        {#if draft.trim() || staged.items.length || sending}
          <button type="submit" class="send" aria-label={recipient ? m['orchestrator.send_leader']({ name: recipient.title }) : leader ? m['orchestrator.send_leader']({ name: leader.title }) : m['orchestrator.send']()} disabled={(!draft.trim() && !staged.items.length) || sending || !canSend || staged.busy}>
            {#if sending}<LoaderCircle size={14} class="animate-spin" />{:else}<ArrowUp size={14} strokeWidth={2.4} />{/if}
          </button>
        {:else}
          <button type="button" class="send" disabled={total === 0} onclick={() => (voiceOpen = true)} aria-label={m['composer.voice_start']()} title={m['composer.voice_start']()} data-testid="orchestrator-mic"><Mic size={14} strokeWidth={2.2} /></button>
        {/if}
      {/if}
    </form>
  </div>
</NodeShell>

<style>
  .orb {
    width: 16px;
    height: 16px;
    display: block;
    border-radius: 50%;
    background: radial-gradient(circle at 35% 30%, #fff3c4 0, #f2c45c 32%, #d98a2b 70%, #8a4a12 100%);
    box-shadow: 0 0 10px color-mix(in srgb, #f2b445 55%, transparent);
  }

  .leader {
    display: flex;
    align-items: center;
    gap: 7px;
    margin: 0 12px 6px;
    padding: 6px 10px;
    border: 0;
    border-radius: 10px;
    background: color-mix(in srgb, var(--app-accent) 10%, transparent);
    color: var(--app-text);
    font-size: 12px;
    text-align: left;
  }

  .leader:hover {
    background: color-mix(in srgb, var(--app-accent) 16%, transparent);
  }

  .leader b {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 600;
  }

  .leader-label {
    color: var(--app-text-muted);
  }

  .orch :global(.star) {
    flex: none;
    color: var(--app-accent);
    fill: var(--app-accent);
  }

  .no-leader {
    margin: 0 12px 6px;
    padding: 7px 10px;
    border-radius: 10px;
    background: color-mix(in srgb, var(--app-warning) 12%, transparent);
    color: var(--app-text-soft);
    font-size: 12px;
    line-height: 1.45;
  }

  .make-leader {
    align-self: flex-start;
    margin: -2px 0 4px 44px;
    padding: 2px 8px;
    border: 1px solid var(--app-border-strong);
    border-radius: 999px;
    background: transparent;
    color: var(--app-text-soft);
    font-size: 11px;
  }

  .make-leader:hover {
    border-color: var(--app-accent);
    color: var(--app-text);
  }

  .orb.big {
    width: 38px;
    height: 38px;
  }

  .tally {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin-right: 4px;
    color: var(--app-text-soft);
    font-family: var(--font-mono);
    font-size: 11.5px;
    font-variant-numeric: tabular-nums;
  }

  .ring {
    width: 13px;
    height: 13px;
    border-radius: 50%;
    background: conic-gradient(var(--app-accent) var(--pct), color-mix(in srgb, var(--app-text) 16%, transparent) 0);
    -webkit-mask: radial-gradient(circle, transparent 3.6px, #000 3.8px);
    mask: radial-gradient(circle, transparent 3.6px, #000 3.8px);
  }

  .orch {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  .sub {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 10px 12px 8px;
    color: var(--app-text-soft);
    font-size: 12.5px;
  }

  .grow {
    flex: 1;
  }

  .round {
    width: 28px;
    height: 28px;
    display: grid;
    place-items: center;
    border: 1px solid var(--app-glass-line);
    border-radius: 50%;
    background: transparent;
    color: var(--app-text-soft);
  }

  .round:hover {
    background: var(--app-hover);
    color: var(--app-text);
  }

  .connect {
    height: 28px;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 0 12px;
    border: 1px solid color-mix(in srgb, var(--app-accent) 55%, transparent);
    border-radius: 999px;
    background: color-mix(in srgb, var(--app-accent) 10%, transparent);
    color: var(--app-accent);
    font-size: 12.5px;
    font-weight: 600;
    transition: background-color var(--duration-quick) ease-out, transform var(--duration-quick) var(--ease-smooth-out);
  }

  .connect:hover:not(:disabled) {
    background: color-mix(in srgb, var(--app-accent) 18%, transparent);
  }

  .connect:active:not(:disabled) {
    transform: scale(var(--scale-press));
  }

  .connect:disabled {
    opacity: 0.5;
  }

  .connect.solid {
    background: var(--app-accent);
    color: var(--app-accent-contrast);
  }

  .list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 2px 6px 8px;
    border-top: 1px solid color-mix(in srgb, var(--app-text) 6%, transparent);
  }

  .section-head {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 10px 8px 4px;
    color: var(--app-text-soft);
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .section-head .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--tint, var(--app-text-muted));
  }

  .section-head .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .section-head .count {
    color: var(--app-text-muted);
    font-weight: 500;
    letter-spacing: 0;
  }

  .row {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 7px 8px;
    border: 0;
    border-radius: 10px;
    background: transparent;
    text-align: left;
    color: var(--app-text);
    transition: background-color var(--duration-quick) ease-out;
  }

  .row-wrap {
    position: relative;
    display: flex;
    align-items: center;
    border-radius: 10px;
  }

  .row-wrap.chosen {
    background: color-mix(in srgb, var(--app-accent) 12%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--app-accent) 40%, transparent);
  }

  .row-wrap .row {
    padding-right: 34px;
  }

  .locate {
    position: absolute;
    right: 4px;
    width: 26px;
    height: 26px;
    display: grid;
    place-items: center;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: var(--app-text-muted);
    opacity: 0;
    transition: opacity var(--duration-quick) ease-out;
  }

  .row-wrap:hover .locate,
  .locate:focus-visible {
    opacity: 1;
  }

  .locate:hover {
    background: var(--app-hover);
    color: var(--app-text);
  }

  .to-chip {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0 10px 6px;
    color: var(--app-text-muted);
    font-size: 11.5px;
  }

  .to-chip b {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--app-text);
    font-weight: 600;
  }

  .to-chip button {
    width: 18px;
    height: 18px;
    display: grid;
    place-items: center;
    border: 0;
    border-radius: 50%;
    background: transparent;
    color: var(--app-text-muted);
  }

  .to-chip button:hover {
    background: var(--app-hover);
    color: var(--app-text);
  }

  .panel-mentions {
    display: flex;
    flex-direction: column;
    margin: 0 8px 6px;
    padding: 4px;
    border-radius: 12px;
    background: var(--app-surface-raised);
    box-shadow: var(--app-shadow-border);
  }

  .panel-mentions button {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: var(--app-text);
    font-size: 12.5px;
    text-align: left;
  }

  .panel-mentions button:hover,
  .panel-mentions button:focus-visible {
    background: var(--app-hover);
  }

  .command.voice {
    padding: 3px 4px;
  }

  .row:hover {
    background: var(--app-hover);
  }

  .row:focus-visible {
    outline: 2px solid var(--app-accent);
    outline-offset: -2px;
  }

  .avatar {
    position: relative;
    flex: none;
    display: inline-flex;
  }

  .provider {
    position: absolute;
    right: -4px;
    bottom: -3px;
    width: 14px;
    height: 14px;
    padding: 1.5px;
    border-radius: 4px;
    box-shadow: 0 0 0 1.5px var(--app-surface);
  }

  .who {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    line-height: 1.25;
  }

  .who b {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 13px;
    font-weight: 600;
  }

  .who small {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--app-text-muted);
    font-size: 11.5px;
  }

  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 26px 18px;
    text-align: center;
  }

  .empty strong {
    font-size: 13px;
  }

  .empty p {
    margin: 0;
    max-width: 240px;
    color: var(--app-text-muted);
    font-size: 12px;
    line-height: 1.5;
  }

  .feedback {
    margin: 0 12px 6px;
    color: var(--app-success);
    font-size: 11.5px;
  }

  .feedback.error {
    color: var(--app-danger);
  }

  .command {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0 8px 8px;
    padding: 5px 5px 5px 12px;
    border-radius: 999px;
    border: 1px solid var(--app-glass-line);
    background: color-mix(in srgb, var(--app-surface-raised) 70%, transparent);
    transition: border-color var(--duration-quick) ease-out;
  }

  .command:focus-within {
    border-color: color-mix(in srgb, var(--app-accent) 50%, transparent);
  }

  .command.dropping {
    border-color: var(--app-accent);
    border-style: dashed;
  }

  .command :global(.attach) {
    width: 28px;
    height: 28px;
    flex: none;
    display: grid;
    place-items: center;
    border: 0;
    border-radius: 50%;
    background: transparent;
    color: var(--app-text-muted);
    cursor: pointer;
  }

  .command :global(.attach:hover:not(:disabled)) {
    background: var(--app-hover);
    color: var(--app-text);
  }

  .command :global(.attach:disabled) {
    opacity: 0.45;
    cursor: default;
  }

  .command :global(.attach:focus-visible) {
    outline: 2px solid var(--app-accent);
    outline-offset: 1px;
    border-radius: 50%;
  }

  .staged {
    margin: 0 12px 6px;
  }

  .staged-error {
    margin: 0 14px 6px;
    color: var(--app-danger);
    font-size: 11.5px;
  }

  .command input {
    flex: 1;
    min-width: 0;
    border: 0;
    outline: none;
    background: transparent;
    color: var(--app-text);
    font-size: 12.5px;
  }

  .command input::placeholder {
    color: var(--app-text-muted);
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
</style>
