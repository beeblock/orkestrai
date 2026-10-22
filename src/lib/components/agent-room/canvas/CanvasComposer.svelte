<script lang="ts" module>
  import { getCsrfToken } from '@beeblock/svelar/http';
  import type { WorkspaceAttachment } from '$lib/modules/agent-room/domain/types.js';

  export type ComposerTarget = { id: string; title: string };
  export type ComposerMention = { id: string; title: string; type: string };

  /**
   * Sends `text` to the agent's direct conversation: it is recorded in Chat
   * and reaches the agent through its inbox, which wakes an on-demand agent
   * and waits for a busy one to finish its turn. Returns the stored message
   * id once it is queued, or null when it was not accepted.
   */
  export async function sendToAgent(workspaceId: string, nodeId: string, text: string, attachments: WorkspaceAttachment[] = []): Promise<string | null> {
    const csrf = getCsrfToken();
    const response = await fetch(`/api/agent-room/workspaces/${encodeURIComponent(workspaceId)}/channels/${encodeURIComponent(`dm:${nodeId}`)}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(csrf ? { 'X-CSRF-Token': csrf } : {}) },
      body: JSON.stringify({ body: text, attachments }),
    }).catch(() => null);
    const result = response?.ok ? await response.json().catch(() => null) as { data?: { message?: { id?: string }; delivered?: Array<{ ok: boolean }> } } | null : null;
    const accepted = Boolean(result?.data?.delivered?.length) && !result!.data!.delivered!.some((entry) => !entry.ok);
    return accepted ? result?.data?.message?.id ?? null : null;
  }
</script>

<script lang="ts">
  import { onMount } from 'svelte';
  import { ArrowUp, AtSign, Check, ChevronDown, ChevronUp, Clock3, FileText, Globe, LoaderCircle, MessageSquareText, Mic, SquareTerminal, Volume2, VolumeX, X } from '@lucide/svelte';
  import { toast } from '@beeblock/svelar/ui';
  import AgentChatFace from '../chat/AgentChatFace.svelte';
  import ComposerVoice from './ComposerVoice.svelte';
  import { TEXT_DICTATION_COMMAND } from '../text-dictation.js';
  import { speakText } from '../voice-speech.js';
  import { normalizeSpeechText } from '../voice-cleanup.js';
  import { appSettingsStore } from '../app-settings.svelte.js';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
  import AgentAvatar from '../AgentAvatar.svelte';
  import AttachmentList from '../AttachmentList.svelte';
  import ComposerAttachButton from '../ComposerAttachButton.svelte';
  import { ComposerAttachments } from '../composer-attachments.svelte.js';
  import * as m from '$lib/paraglide/messages.js';

  let {
    workspaceId,
    targets,
    targetId,
    mentions,
    onTargetChange,
    onJump,
    onCommand,
  }: {
    workspaceId: string;
    targets: ComposerTarget[];
    targetId: string | null;
    mentions: ComposerMention[];
    onTargetChange: (id: string) => void;
    onJump: (id: string) => void;
    /** Board commands ("spawn 3 agents", "pause all"): true when the Canvas ran it. */
    onCommand?: (text: string) => Promise<boolean> | boolean;
  } = $props();

  let hintHidden = $state(readHintHidden());
  function readHintHidden(): boolean {
    try {
      return localStorage.getItem('orkestrai.composer.commandHint') === 'hidden';
    } catch {
      return false;
    }
  }
  function hideHint() {
    hintHidden = true;
    try {
      localStorage.setItem('orkestrai.composer.commandHint', 'hidden');
    } catch {
      // The tip simply shows again next time.
    }
  }

  // Voice: talk instead of typing; replies can be read back aloud.
  let voiceOpen = $state(false);
  let speakReplies = $state(readSpeakReplies());
  // A message sent by voice gets its reply spoken even with read-back off.
  let speakNextReplyFrom: string | null = null;
  function readSpeakReplies(): boolean {
    try {
      return localStorage.getItem('orkestrai.composer.speakReplies') === 'on';
    } catch {
      return false;
    }
  }
  function toggleSpeakReplies() {
    speakReplies = !speakReplies;
    try {
      localStorage.setItem('orkestrai.composer.speakReplies', speakReplies ? 'on' : 'off');
    } catch {
      // The choice lasts for this visit only.
    }
  }

  async function onVoiceTranscript(text: string, mode: 'send' | 'edit') {
    draft = draft.trim() ? `${draft.trimEnd()} ${text}` : text;
    if (mode === 'edit') {
      requestAnimationFrame(() => {
        onInput();
        input?.focus();
      });
      return;
    }
    if (target) speakNextReplyFrom = target.id;
    await send();
  }

  // Voice models not installed yet: the app's dictation flow offers the download.
  function onVoiceSetup() {
    voiceOpen = false;
    requestAnimationFrame(() => {
      input?.focus();
      window.dispatchEvent(new Event(TEXT_DICTATION_COMMAND));
    });
  }

  // The last message sent stays visible until the agent has it: queued while
  // the agent finishes its turn, then delivered, then answered.
  type SentState = 'queued' | 'delivered' | 'replied';
  let lastSent = $state<{ id: string; nodeId: string; name: string; text: string; at: string; state: SentState } | null>(null);
  let sentTimer: ReturnType<typeof setTimeout> | null = null;
  // Deliveries that arrive before the send request returns.
  const deliveredEarly = new Set<string>();

  function trackSent(id: string, nodeId: string, name: string, text: string, at: string) {
    if (sentTimer) clearTimeout(sentTimer);
    lastSent = { id, nodeId, name, text, at, state: deliveredEarly.has(id) ? 'delivered' : 'queued' };
    deliveredEarly.clear();
    if (lastSent.state === 'delivered') settleDelivered();
  }

  function settleDelivered() {
    if (sentTimer) clearTimeout(sentTimer);
    const id = lastSent?.id;
    sentTimer = setTimeout(() => {
      if (lastSent?.id === id && lastSent?.state === 'delivered') lastSent = null;
    }, 8000);
  }

  function openReply() {
    lastSent = null;
    threadOpen = true;
  }

  onMount(() => {
    const onDelivery = (event: Event) => {
      const { channel, message } = (event as CustomEvent<{ channel?: string; message?: { id: string; authorKind: string; authorNodeId: string | null; createdAt: string; meta?: Record<string, unknown> } }>).detail ?? {};
      if (!message) return;
      const sent = lastSent;
      if (message.authorKind === 'owner' && message.meta?.deliveredAt) {
        if (sent?.id === message.id) {
          if (sent.state === 'queued') {
            lastSent = { ...sent, state: 'delivered' };
            settleDelivered();
          }
        } else if (sending) deliveredEarly.add(message.id);
        return;
      }
      if (sent && message.authorKind === 'agent' && message.authorNodeId === sent.nodeId && channel === `dm:${sent.nodeId}` && message.createdAt >= sent.at) {
        if (sentTimer) clearTimeout(sentTimer);
        lastSent = { ...sent, state: 'replied' };
      }
    };
    window.addEventListener('orkestrai:channel-message', onDelivery);
    return () => {
      window.removeEventListener('orkestrai:channel-message', onDelivery);
      if (sentTimer) clearTimeout(sentTimer);
    };
  });

  onMount(() => {
    const onMessage = (event: Event) => {
      const { channel, message } = (event as CustomEvent<{ channel: string; message: { authorKind: string; authorNodeId: string | null; body: string } }>).detail ?? {};
      if (!message || message.authorKind !== 'agent' || !message.authorNodeId) return;
      if (channel !== `dm:${message.authorNodeId}`) return;
      const wanted = speakNextReplyFrom === message.authorNodeId || (speakReplies && target?.id === message.authorNodeId);
      if (!wanted) return;
      if (speakNextReplyFrom === message.authorNodeId) speakNextReplyFrom = null;
      const spoken = normalizeSpeechText(message.body);
      if (!spoken) return;
      speakText(spoken, appSettingsStore.values.audioOutputDeviceId).catch((error) => {
        toast.error(error instanceof Error ? error.message : m['composer.voice_speak_failed']());
      });
    };
    window.addEventListener('orkestrai:channel-message', onMessage);
    return () => window.removeEventListener('orkestrai:channel-message', onMessage);
  });

  let draft = $state('');
  let sending = $state(false);
  let feedback = $state<{ ok: boolean; text: string } | null>(null);
  let mentionOpen = $state(false);
  let mentionFilter = $state('');
  let input = $state<HTMLTextAreaElement | null>(null);
  let feedbackTimer: ReturnType<typeof setTimeout> | null = null;
  // The conversation with the target opens above the bar, like a chat thread.
  let threadOpen = $state(false);
  const staged = new ComposerAttachments(() => workspaceId);
  // Staged files belong to this workspace's draft: switching workspace or closing the bar discards them.
  $effect(() => {
    void workspaceId;
    return staged.reset;
  });

  const target = $derived(targets.find((candidate) => candidate.id === targetId) ?? targets[0] ?? null);
  const filteredMentions = $derived(mentions
    .filter((mention) => mention.title.toLowerCase().includes(mentionFilter.toLowerCase()))
    .slice(0, 8));

  // Reads the field itself, so a typed @ opens mentions whatever order the binding updates in.
  function onInput() {
    const match = (input?.value ?? draft).match(/@([\p{L}\p{N} ._-]*)$/u);
    mentionOpen = Boolean(match);
    mentionFilter = match?.[1] ?? '';
    if (input) {
      input.style.height = 'auto';
      input.style.height = `${Math.min(120, input.scrollHeight)}px`;
    }
  }

  function insertMention(mention: ComposerMention) {
    draft = /@([\p{L}\p{N} ._-]*)$/u.test(draft)
      ? draft.replace(/@([\p{L}\p{N} ._-]*)$/u, `@${mention.title} `)
      : `${draft}${draft && !draft.endsWith(' ') ? ' ' : ''}@${mention.title} `;
    mentionOpen = false;
    input?.focus();
  }

  function showFeedback(ok: boolean, text: string) {
    feedback = { ok, text };
    if (feedbackTimer) clearTimeout(feedbackTimer);
    feedbackTimer = setTimeout(() => (feedback = null), ok ? 2400 : 6000);
  }

  async function send() {
    const text = draft.trim();
    if ((!text && !staged.items.length) || sending || staged.busy) return;
    // Board commands are plain sentences; a message with files always goes to the agent.
    if (!staged.items.length && onCommand && await onCommand(text)) {
      if (draft.trim() === text) draft = '';
      onInput();
      showFeedback(true, m['composer.command_done']());
      return;
    }
    if (!target) return;
    const recipient = target;
    const at = new Date().toISOString();
    const submission = staged.reserve();
    sending = true;
    const messageId = await sendToAgent(workspaceId, recipient.id, text, submission.attachments);
    sending = false;
    if (messageId) {
      submission.commit();
      if (draft.trim() === text) draft = '';
      onInput();
      trackSent(messageId, recipient.id, recipient.title, text || submission.attachments.map((attachment) => attachment.name).join(', '), at);
    } else {
      submission.release();
      showFeedback(false, m['composer.failed']({ name: recipient.title }));
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
</script>

<div class="composer-wrap">
  {#if threadOpen && target}
    <section class="thread" aria-label={m['composer.thread_title']({ name: target.title })} data-testid="canvas-thread">
      <header>
        <span>{m['composer.thread_title']({ name: target.title })}</span>
        <button type="button" class="thread-close" aria-label={m['composer.thread_close']()} onclick={() => (threadOpen = false)}><X size={13} /></button>
      </header>
      {#key target.id}<AgentChatFace {workspaceId} nodeId={target.id} title={target.title} />{/key}
    </section>
  {/if}
  {#if mentionOpen && filteredMentions.length}
    <div class="mentions" role="listbox" aria-label={m['composer.mention']()}>
      {#each filteredMentions as mention (mention.id)}
        <button type="button" role="option" aria-selected="false" class="mention" onclick={() => insertMention(mention)}>
          {#if mention.type === 'terminal'}<SquareTerminal size={14} />{:else if mention.type === 'portal'}<Globe size={14} />{:else}<FileText size={14} />{/if}
          <span>{mention.title}</span>
        </button>
      {/each}
    </div>
  {/if}
  {#if staged.error}
    <p class="feedback error" role="alert">{staged.error}</p>
  {:else if feedback}
    <p class="feedback" class:error={!feedback.ok} role="status">{feedback.text}</p>
  {:else if lastSent && !threadOpen}
    <div class="sent" class:delivered={lastSent.state !== 'queued'} role="status" data-testid="composer-sent" data-state={lastSent.state}>
      <span class="sent-mark" aria-hidden="true">
        {#if lastSent.state === 'queued'}<Clock3 size={13} />{:else if lastSent.state === 'delivered'}<Check size={13} />{:else}<MessageSquareText size={13} />{/if}
      </span>
      <span class="sent-copy">
        <strong>{lastSent.state === 'queued' ? m['composer.sent_queued']({ name: lastSent.name }) : lastSent.state === 'delivered' ? m['composer.sent_delivered']({ name: lastSent.name }) : m['composer.sent_replied']({ name: lastSent.name })}</strong>
        <span class="sent-text">“{lastSent.text}”</span>
      </span>
      {#if lastSent.state === 'replied'}
        <button type="button" class="sent-open" onclick={openReply}>{m['composer.sent_open_reply']()}</button>
      {/if}
      <button type="button" class="sent-close" aria-label={m['composer.sent_dismiss']()} title={m['composer.sent_dismiss']()} onclick={() => (lastSent = null)}><X size={11} /></button>
    </div>
  {:else if onCommand && !hintHidden && !threadOpen}
    <p class="command-hint">{m['composer.command_hint']()}<button type="button" aria-label={m['composer.command_hint_close']()} onclick={hideHint}><X size={11} /></button></p>
  {/if}
  <div class="composer" class:dropping={staged.dragging} data-testid="canvas-composer" role="group" aria-label={m['composer.drop_files']()} ondragover={(event) => { if (target) staged.dragover(event); }} ondragleave={staged.dragleave} ondrop={(event) => { if (target) staged.drop(event); }}>
    {#if staged.items.length}
      <div class="staged"><AttachmentList {workspaceId} attachments={staged.items} compact onRemove={staged.sending ? undefined : staged.remove} /></div>
    {/if}
    {#if target}
      <DropdownMenu.Root>
        <DropdownMenu.Trigger class="target" aria-label={m['composer.choose_target']()}>
          <AgentAvatar nodeId={target.id} title={target.title} size={22} />
          <span class="target-name">{target.title}</span>
          <ChevronDown size={12} />
        </DropdownMenu.Trigger>
        <DropdownMenu.Content side="top" align="start" sideOffset={10} class="w-60 p-1">
          <DropdownMenu.Label>{m['composer.choose_target']()}</DropdownMenu.Label>
          {#each targets as candidate (candidate.id)}
            <DropdownMenu.Item onclick={() => onTargetChange(candidate.id)}>
              <AgentAvatar nodeId={candidate.id} title={candidate.title} size={18} />
              <span class="min-w-0 flex-1 truncate">{candidate.title}</span>
            </DropdownMenu.Item>
          {/each}
          <DropdownMenu.Separator />
          <DropdownMenu.Item onclick={() => onJump(target.id)}>{m['composer.show_target']()}</DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    {/if}
    {#if voiceOpen}
      <ComposerVoice onTranscript={onVoiceTranscript} onClose={() => (voiceOpen = false)} onSetupNeeded={onVoiceSetup} />
    {:else}
    <label class="sr-only" for="canvas-composer-input">{target ? m['composer.target']({ name: target.title }) : m['composer.no_agents']()}</label>
    <textarea
      id="canvas-composer-input"
      bind:this={input}
      bind:value={draft}
      rows="1"
      disabled={!target && !onCommand}
      placeholder={target ? m['composer.placeholder']() : onCommand ? m['composer.placeholder_board']() : m['composer.no_agents']()}
      oninput={onInput}
      oncompositionend={onInput}
      onkeydown={onKeydown}
      onpaste={(event) => { if (target) staged.paste(event); }}
    ></textarea>
    <ComposerAttachButton attachments={staged} class="icon attach" disabled={!target} />
    <button type="button" class="icon" disabled={!target} onclick={() => (threadOpen = !threadOpen)} aria-pressed={threadOpen} aria-label={threadOpen ? m['composer.thread_close']() : m['composer.thread_open']({ name: target?.title ?? '' })} title={threadOpen ? m['composer.thread_close']() : m['composer.thread_open']({ name: target?.title ?? '' })}><ChevronUp size={16} class={threadOpen ? 'rotate-180 transition-transform' : 'transition-transform'} /></button>
    <button type="button" class="icon" disabled={!target} onclick={() => { draft = `${draft}@`; onInput(); input?.focus(); }} aria-label={m['composer.mention']()}><AtSign size={16} /></button>
    <button type="button" class="icon" class:on={speakReplies} disabled={!target} onclick={toggleSpeakReplies} aria-pressed={speakReplies} aria-label={speakReplies ? m['composer.voice_replies_off']() : m['composer.voice_replies_on']()} title={speakReplies ? m['composer.voice_replies_off']() : m['composer.voice_replies_on']()}>
      {#if speakReplies}<Volume2 size={16} />{:else}<VolumeX size={16} />{/if}
    </button>
    {#if draft.trim() || staged.items.length || sending}
      <button type="button" class="send" disabled={(!target && !onCommand) || (!draft.trim() && !staged.items.length) || sending || staged.busy} onclick={() => void send()} aria-label={m['composer.send']()}>
        {#if sending}<LoaderCircle size={15} class="animate-spin" />{:else}<ArrowUp size={15} strokeWidth={2.4} />{/if}
      </button>
    {:else}
      <button type="button" class="send mic" disabled={!target && !onCommand} onclick={() => (voiceOpen = true)} aria-label={m['composer.voice_start']()} title={m['composer.voice_start']()} data-testid="composer-mic">
        <Mic size={16} strokeWidth={2.2} />
      </button>
    {/if}
    {/if}
  </div>
</div>

<style>
  .composer-wrap {
    position: relative;
    width: min(640px, calc(100vw - 720px));
    min-width: 360px;
    margin-bottom: 4px;
  }

  .thread {
    position: absolute;
    left: 0;
    right: 0;
    bottom: calc(100% + 10px);
    height: min(380px, 52vh);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border-radius: 20px;
    background: var(--app-glass-strong);
    -webkit-backdrop-filter: blur(24px) saturate(170%);
    backdrop-filter: blur(24px) saturate(170%);
    border: 1px solid var(--app-glass-line);
    box-shadow: var(--app-glass-shadow);
    animation: thread-in var(--duration-fast) var(--ease-smooth-out);
  }

  @keyframes thread-in {
    from { opacity: 0; transform: translateY(8px) scale(0.985); }
  }

  .thread header {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 38px;
    padding: 0 8px 0 14px;
    border-bottom: 1px solid var(--app-glass-line);
    color: var(--app-text-muted);
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .thread header span {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .thread-close {
    width: 24px;
    height: 24px;
    display: grid;
    place-items: center;
    border: 0;
    border-radius: 7px;
    background: transparent;
    color: var(--app-text-muted);
  }

  .thread-close:hover {
    background: var(--app-hover);
    color: var(--app-text);
  }

  .thread :global(.face) {
    flex: 1;
    min-height: 0;
    background: transparent;
  }

  .composer {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: 6px;
    padding: 7px;
    border-radius: 22px;
    background: var(--app-glass);
    -webkit-backdrop-filter: blur(24px) saturate(170%);
    backdrop-filter: blur(24px) saturate(170%);
    border: 1px solid var(--app-glass-line);
    box-shadow: var(--app-glass-shadow);
    transition: border-color var(--duration-quick) ease-out, box-shadow var(--duration-quick) ease-out;
  }

  .composer:focus-within {
    border-color: color-mix(in srgb, var(--app-accent) 50%, transparent);
    box-shadow: var(--app-glass-shadow), 0 0 0 4px color-mix(in srgb, var(--app-accent) 10%, transparent);
  }

  .composer :global(.target) {
    height: 34px;
    max-width: 180px;
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 0 8px 0 6px;
    border: 0;
    border-radius: 999px;
    background: var(--app-hover);
    color: var(--app-text);
    font: inherit;
    font-size: 13px;
    cursor: pointer;
    flex: none;
  }

  .composer :global(.target:hover) {
    background: var(--app-active);
  }

  .target-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  textarea {
    flex: 1;
    min-width: 0;
    min-height: 34px;
    max-height: 120px;
    resize: none;
    border: 0;
    outline: none;
    background: transparent;
    color: var(--app-text);
    font: inherit;
    font-size: 13.5px;
    line-height: 1.45;
    padding: 7px 6px;
  }

  textarea:focus-visible {
    outline: none;
  }

  textarea::placeholder {
    color: var(--app-text-muted);
  }

  .icon,
  .composer :global(.attach),
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

  .icon,
  .composer :global(.attach) {
    background: transparent;
    color: var(--app-text-muted);
  }

  .icon:hover:not(:disabled),
  .composer :global(.attach:hover:not(:disabled)) {
    background: var(--app-hover);
    color: var(--app-text);
  }

  .composer :global(.attach:disabled) {
    opacity: 0.45;
    cursor: default;
  }

  .composer.dropping {
    border-color: var(--app-accent);
    border-style: dashed;
  }

  .staged {
    flex: 1 0 100%;
    padding: 2px 4px;
  }

  .icon.on {
    color: var(--app-accent);
  }

  .send.mic:hover:not(:disabled) {
    transform: scale(1.06);
  }

  .send {
    background: var(--app-accent);
    color: var(--app-accent-contrast);
    box-shadow: 0 4px 14px color-mix(in srgb, var(--app-accent) 32%, transparent);
    transition: transform var(--duration-quick) var(--ease-smooth-out), opacity var(--duration-quick) ease-out;
  }

  .send:active:not(:disabled) {
    transform: scale(var(--scale-press));
  }

  .send:disabled {
    opacity: 0.45;
    cursor: default;
  }

  .icon:focus-visible,
  .composer :global(.attach:focus-visible),
  .send:focus-visible {
    outline: 2px solid var(--app-accent);
    outline-offset: 2px;
  }

  .mentions {
    position: absolute;
    z-index: 6;
    left: 6px;
    bottom: calc(100% + 8px);
    min-width: 260px;
    padding: 4px;
    border-radius: 14px;
    background: var(--app-glass-strong);
    -webkit-backdrop-filter: blur(22px) saturate(170%);
    backdrop-filter: blur(22px) saturate(170%);
    border: 1px solid var(--app-glass-line);
    box-shadow: var(--app-glass-shadow);
  }

  .mention {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 8px;
    height: 32px;
    padding: 0 10px;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: var(--app-text);
    font: inherit;
    font-size: 13px;
    text-align: left;
    cursor: pointer;
  }

  .mention:hover,
  .mention:focus-visible {
    background: var(--app-hover);
    outline: none;
  }

  .feedback {
    position: absolute;
    left: 50%;
    bottom: calc(100% + 8px);
    transform: translateX(-50%);
    margin: 0;
    padding: 6px 12px;
    border-radius: 9px;
    background: var(--app-surface-raised);
    box-shadow: var(--app-shadow-overlay);
    color: var(--app-text-soft);
    font-size: 12.5px;
    white-space: nowrap;
  }

  .command-hint {
    position: absolute;
    left: 50%;
    bottom: calc(100% + 52px);
    transform: translateX(-50%);
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin: 0;
    padding: 3px 4px 3px 10px;
    border-radius: 999px;
    border: 1px solid var(--app-glass-line);
    background: var(--app-glass);
    -webkit-backdrop-filter: blur(18px);
    backdrop-filter: blur(18px);
    color: var(--app-text-muted);
    font-size: 11.5px;
    white-space: nowrap;
  }

  .command-hint button {
    width: 18px;
    height: 18px;
    display: grid;
    place-items: center;
    border: 0;
    border-radius: 50%;
    background: transparent;
    color: var(--app-text-muted);
  }

  .command-hint button:hover {
    background: var(--app-hover);
    color: var(--app-text);
  }

  .feedback.error {
    color: var(--app-danger);
  }

  /* Above the quick-action pills, where the command tip sits, so it never covers them. */
  .sent {
    position: absolute;
    left: 0;
    right: 0;
    bottom: calc(100% + 52px);
    width: fit-content;
    margin-inline: auto;
    display: flex;
    align-items: center;
    gap: 8px;
    max-width: 100%;
    padding: 5px 5px 5px 8px;
    border-radius: 12px;
    border: 1px solid var(--app-glass-line);
    background: var(--app-surface-raised);
    box-shadow: var(--app-shadow-overlay);
    color: var(--app-text);
  }

  .sent-mark {
    width: 22px;
    height: 22px;
    flex: none;
    display: grid;
    place-items: center;
    border-radius: 7px;
    background: color-mix(in srgb, var(--app-warning) 18%, transparent);
    color: var(--app-warning);
  }

  .sent.delivered .sent-mark {
    background: color-mix(in srgb, var(--app-success) 18%, transparent);
    color: var(--app-success);
  }

  .sent-copy {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .sent-copy strong {
    font-size: 12px;
    font-weight: 600;
    line-height: 1.35;
  }

  .sent-text {
    overflow: hidden;
    color: var(--app-text-soft);
    font-size: 11.5px;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .sent-open {
    flex: none;
    height: 24px;
    padding: 0 9px;
    border: 0;
    border-radius: 7px;
    background: var(--app-text);
    color: var(--app-surface);
    font: inherit;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
  }

  .sent-close {
    width: 20px;
    height: 20px;
    flex: none;
    display: grid;
    place-items: center;
    border: 0;
    border-radius: 50%;
    background: transparent;
    color: var(--app-text-muted);
    cursor: pointer;
  }

  .sent-close:hover {
    background: var(--app-hover);
    color: var(--app-text);
  }

  .sent-open:focus-visible,
  .sent-close:focus-visible {
    outline: 2px solid var(--app-accent);
    outline-offset: 1px;
  }

  @media (max-width: 1100px) {
    .composer-wrap {
      width: min(560px, calc(100vw - 80px));
      min-width: 0;
    }
  }
</style>
