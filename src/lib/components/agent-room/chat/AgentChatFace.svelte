<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { getCsrfToken } from '@beeblock/svelar/http';
  import { ArrowUp, LoaderCircle, Mic, UserRound } from '@lucide/svelte';
  import MarkdownView from '../MarkdownView.svelte';
  import QuestionCard from './QuestionCard.svelte';
  import ComposerVoice from '../canvas/ComposerVoice.svelte';
  import { TEXT_DICTATION_COMMAND } from '../text-dictation.js';
  import { answersByQuestion, buildTimeline, upsertMessage } from './chat-timeline.js';
  import { directChannel, type ChannelMessage } from '$lib/modules/agent-room/domain/channels.js';
  import * as m from '$lib/paraglide/messages.js';

  /**
   * The agent's direct conversation shown inside its Canvas node: the same
   * messages as in Chat, without reading the terminal screen. With `voice`,
   * an empty field offers the microphone instead of a disabled send button.
   */
  let { workspaceId, nodeId, title, voice = false }: { workspaceId: string; nodeId: string; title: string; voice?: boolean } = $props();

  let messages = $state<ChannelMessage[]>([]);
  let draft = $state('');
  let sending = $state(false);
  let failed = $state(false);
  let scroller = $state<HTMLElement | null>(null);
  let field = $state<HTMLInputElement | null>(null);
  let listening = $state(false);
  const channel = $derived(directChannel(nodeId));
  const url = $derived(`/api/agent-room/workspaces/${encodeURIComponent(workspaceId)}/channels/${encodeURIComponent(channel)}/messages`);
  const timeline = $derived(buildTimeline(messages));
  const answers = $derived(answersByQuestion(messages));

  async function scrollEnd() {
    await tick();
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  }

  async function load() {
    const response = await fetch(`${url}?limit=60`, { cache: 'no-store' }).catch(() => null);
    const body = response?.ok ? await response.json().catch(() => null) : null;
    if (Array.isArray(body?.data)) {
      messages = body.data;
      await scrollEnd();
    }
  }

  async function post(text: string, replyToId: string | null = null): Promise<boolean> {
    const csrf = getCsrfToken();
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(csrf ? { 'X-CSRF-Token': csrf } : {}) },
      body: JSON.stringify({ body: text, replyToId }),
    }).catch(() => null);
    const result = response?.ok ? await response.json().catch(() => null) : null;
    if (!result?.data?.message) return false;
    messages = upsertMessage(messages, result.data.message);
    await scrollEnd();
    return !(result.data.delivered ?? []).some((entry: { ok: boolean }) => !entry.ok);
  }

  async function send() {
    const text = draft.trim();
    if (!text || sending) return;
    sending = true;
    failed = !(await post(text));
    sending = false;
    if (!failed && draft.trim() === text) draft = '';
  }

  async function onVoice(text: string, mode: 'send' | 'edit') {
    draft = draft.trim() ? `${draft.trimEnd()} ${text}` : text;
    if (mode === 'send') await send();
    else requestAnimationFrame(() => field?.focus());
  }

  function onVoiceSetup() {
    listening = false;
    requestAnimationFrame(() => {
      field?.focus();
      window.dispatchEvent(new Event(TEXT_DICTATION_COMMAND));
    });
  }

  onMount(() => {
    void load();
    // The Canvas page relays live channel frames to the nodes that show them.
    const onMessage = (event: Event) => {
      const detail = (event as CustomEvent<{ channel?: string; message?: ChannelMessage }>).detail;
      if (detail?.channel !== channel || !detail.message) return;
      messages = upsertMessage(messages, detail.message);
      void scrollEnd();
    };
    window.addEventListener('orkestrai:channel-message', onMessage);
    return () => window.removeEventListener('orkestrai:channel-message', onMessage);
  });
</script>

<div class="face nodrag nowheel" data-testid="agent-chat-face">
  <div class="list" bind:this={scroller}>
    {#each timeline as row (row.key)}
      {#if row.type === 'group'}
        <div class="group" class:mine={row.authorKind === 'owner'}>
          <small>{#if row.authorKind === 'owner'}<UserRound size={11} />{m['chat.you']()}{:else if row.authorKind === 'external'}{String(row.messages[0].meta.sender ?? '')}{:else}{title}{/if}</small>
          {#each row.messages as message (message.id)}
            {#if message.kind === 'question'}
              <QuestionCard question={message} answer={answers.get(message.id) ?? null} authorTitle={title} onAnswer={(id, text) => post(text, id)} />
            {:else}
              <div class="bubble"><MarkdownView content={message.body} compact {workspaceId} /></div>
            {/if}
          {/each}
        </div>
      {/if}
    {:else}
      <p class="empty">{m['chat.empty_direct_hint']()}</p>
    {/each}
  </div>
  {#if failed}<p class="error" role="alert">{m['composer.failed']({ name: title })}</p>{/if}
  <form class="composer" onsubmit={(event) => { event.preventDefault(); void send(); }}>
    {#if listening}
      <ComposerVoice onTranscript={onVoice} onClose={() => (listening = false)} onSetupNeeded={onVoiceSetup} />
    {:else}
      <input bind:this={field} bind:value={draft} placeholder={m['chat.placeholder_direct']({ name: title })} aria-label={m['chat.placeholder_direct']({ name: title })} />
      {#if voice && !draft.trim() && !sending}
        <button type="button" onclick={() => (listening = true)} aria-label={m['composer.voice_label']()} title={m['composer.voice_label']()}><Mic size={14} /></button>
      {:else}
        <button type="submit" disabled={!draft.trim() || sending} aria-label={m['composer.send']()}>
          {#if sending}<LoaderCircle size={14} class="animate-spin" />{:else}<ArrowUp size={14} />{/if}
        </button>
      {/if}
    {/if}
  </form>
</div>

<style>
  .face {
    height: 100%;
    min-height: 0;
    display: flex;
    flex-direction: column;
    background: var(--app-surface);
  }

  .list {
    min-height: 0;
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px;
    overflow-y: auto;
  }

  .group {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
  }

  .group.mine {
    align-items: flex-end;
  }

  .group small {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: var(--app-text-muted);
    font-size: 11px;
  }

  .bubble {
    max-width: 92%;
    padding: 7px 11px;
    border-radius: 12px;
    background: var(--app-surface-raised);
    color: var(--app-text);
    font-size: 13px;
    line-height: 1.5;
  }

  .mine .bubble {
    background: var(--app-accent-soft);
  }

  .empty {
    margin: auto;
    max-width: 280px;
    color: var(--app-text-muted);
    font-size: 12.5px;
    text-align: center;
  }

  .error {
    margin: 0 12px 4px;
    color: var(--app-danger);
    font-size: 12px;
  }

  .composer {
    display: flex;
    gap: 6px;
    padding: 8px;
    border-top: 1px solid var(--app-border);
  }

  .composer input {
    flex: 1;
    min-width: 0;
    height: 32px;
    padding: 0 10px;
    border: 0;
    border-radius: 8px;
    background: var(--app-surface-raised);
    color: var(--app-text);
    font: inherit;
    font-size: 13px;
    outline: none;
  }

  .composer input:focus-visible {
    box-shadow: inset 0 0 0 1px var(--app-accent);
  }

  .composer button {
    width: 32px;
    height: 32px;
    display: grid;
    place-items: center;
    border: 0;
    border-radius: 8px;
    background: var(--app-accent);
    color: var(--app-accent-contrast);
    cursor: pointer;
  }

  .composer button:disabled {
    opacity: 0.45;
    cursor: default;
  }
</style>
