<script lang="ts" module>
  import { getCsrfToken } from '@beeblock/svelar/http';

  export type ComposerTarget = { id: string; title: string };
  export type ComposerMention = { id: string; title: string; type: string };

  /**
   * Sends `text` to the agent's direct conversation: it is recorded in Chat
   * and reaches the agent through its inbox, which wakes an on-demand agent
   * and waits for a busy one to finish its turn.
   */
  export async function sendToAgent(workspaceId: string, nodeId: string, text: string): Promise<boolean> {
    const csrf = getCsrfToken();
    const response = await fetch(`/api/agent-room/workspaces/${encodeURIComponent(workspaceId)}/channels/${encodeURIComponent(`dm:${nodeId}`)}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(csrf ? { 'X-CSRF-Token': csrf } : {}) },
      body: JSON.stringify({ body: text }),
    }).catch(() => null);
    const result = response?.ok ? await response.json().catch(() => null) as { data?: { delivered?: Array<{ ok: boolean }> } } | null : null;
    return Boolean(result?.data?.delivered?.length) && !result!.data!.delivered!.some((entry) => !entry.ok);
  }
</script>

<script lang="ts">
  import { onMount } from 'svelte';
  import { ArrowUp, AtSign, ChevronDown, ChevronUp, FileText, Globe, LoaderCircle, Mic, SquareTerminal, Volume2, VolumeX, X } from '@lucide/svelte';
  import { toast } from '@beeblock/svelar/ui';
  import AgentChatFace from '../chat/AgentChatFace.svelte';
  import ComposerVoice from './ComposerVoice.svelte';
  import { TEXT_DICTATION_COMMAND } from '../text-dictation.js';
  import { speakText } from '../voice-speech.js';
  import { normalizeSpeechText } from '../voice-cleanup.js';
  import { appSettingsStore } from '../app-settings.svelte.js';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
  import AgentAvatar from '../AgentAvatar.svelte';
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

  const target = $derived(targets.find((candidate) => candidate.id === targetId) ?? targets[0] ?? null);
  const filteredMentions = $derived(mentions
    .filter((mention) => mention.title.toLowerCase().includes(mentionFilter.toLowerCase()))
    .slice(0, 8));

  function onInput() {
    const match = draft.match(/@([\p{L}\p{N} ._-]*)$/u);
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
    if (!text || sending) return;
    if (onCommand && await onCommand(text)) {
      if (draft.trim() === text) draft = '';
      onInput();
      showFeedback(true, m['composer.command_done']());
      return;
    }
    if (!target) return;
    sending = true;
    const delivered = await sendToAgent(workspaceId, target.id, text);
    sending = false;
    if (delivered) {
      if (draft.trim() === text) draft = '';
      onInput();
      showFeedback(true, m['composer.sent']({ name: target.title }));
    } else {
      showFeedback(false, m['composer.failed']({ name: target.title }));
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
  {#if feedback}
    <p class="feedback" class:error={!feedback.ok} role="status">{feedback.text}</p>
  {:else if onCommand && !hintHidden && !threadOpen}
    <p class="command-hint">{m['composer.command_hint']()}<button type="button" aria-label={m['composer.command_hint_close']()} onclick={hideHint}><X size={11} /></button></p>
  {/if}
  <div class="composer" data-testid="canvas-composer">
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
      onkeydown={onKeydown}
    ></textarea>
    <button type="button" class="icon" disabled={!target} onclick={() => (threadOpen = !threadOpen)} aria-pressed={threadOpen} aria-label={threadOpen ? m['composer.thread_close']() : m['composer.thread_open']({ name: target?.title ?? '' })} title={threadOpen ? m['composer.thread_close']() : m['composer.thread_open']({ name: target?.title ?? '' })}><ChevronUp size={16} class={threadOpen ? 'rotate-180 transition-transform' : 'transition-transform'} /></button>
    <button type="button" class="icon" disabled={!target} onclick={() => { draft = `${draft}@`; onInput(); input?.focus(); }} aria-label={m['composer.mention']()}><AtSign size={16} /></button>
    <button type="button" class="icon" class:on={speakReplies} disabled={!target} onclick={toggleSpeakReplies} aria-pressed={speakReplies} aria-label={speakReplies ? m['composer.voice_replies_off']() : m['composer.voice_replies_on']()} title={speakReplies ? m['composer.voice_replies_off']() : m['composer.voice_replies_on']()}>
      {#if speakReplies}<Volume2 size={16} />{:else}<VolumeX size={16} />{/if}
    </button>
    {#if draft.trim() || sending}
      <button type="button" class="send" disabled={(!target && !onCommand) || !draft.trim() || sending} onclick={() => void send()} aria-label={m['composer.send']()}>
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
  .send:focus-visible {
    outline: 2px solid var(--app-accent);
    outline-offset: 2px;
  }

  .mentions {
    position: absolute;
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

  @media (max-width: 1100px) {
    .composer-wrap {
      width: min(560px, calc(100vw - 80px));
      min-width: 0;
    }
  }
</style>
