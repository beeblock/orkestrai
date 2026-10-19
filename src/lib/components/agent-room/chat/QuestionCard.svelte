<script lang="ts">
  import { CircleHelp, CheckCircle2, LoaderCircle, SendHorizontal } from '@lucide/svelte';
  import { Input } from '$lib/components/ui/input';
  import type { ChannelMessage } from '$lib/modules/agent-room/domain/channels.js';
  import * as m from '$lib/paraglide/messages.js';

  let {
    question,
    answer,
    authorTitle,
    onAnswer,
  }: {
    question: ChannelMessage;
    answer: ChannelMessage | null;
    authorTitle: string;
    onAnswer: (questionId: string, text: string) => Promise<boolean>;
  } = $props();

  const options = $derived(Array.isArray(question.meta.options) ? (question.meta.options as unknown[]).filter((option): option is string => typeof option === 'string') : []);
  const answered = $derived(Boolean(question.answeredAt || answer));
  // The leader may answer for the owner, or the agent that asked may withdraw it.
  const answeredBy = $derived.by(() => {
    if (!answer || answer.authorKind === 'owner') return m['chat.you']();
    const name = typeof answer.meta.authorTitle === 'string' ? answer.meta.authorTitle : authorTitle;
    return answer.meta.closedBy === 'asker' ? m['chat.withdrawn_by']({ name }) : m['chat.answered_by']({ name });
  });
  let draft = $state('');
  let sending = $state(false);
  let failed = $state(false);

  async function send(text: string) {
    const value = text.trim();
    if (!value || sending || answered) return;
    sending = true;
    failed = false;
    const ok = await onAnswer(question.id, value);
    sending = false;
    if (ok) draft = '';
    else failed = true;
  }
</script>

<div class="question" class:answered data-testid="chat-question">
  <header>
    {#if answered}<CheckCircle2 size={14} />{:else}<CircleHelp size={14} />{/if}
    <span>{answered ? m['chat.question_answered']() : m['chat.question_from']({ name: authorTitle })}</span>
  </header>
  <p class="body">{question.body}</p>
  {#if answered}
    {#if answer}<p class="answer"><b>{answeredBy}</b> {answer.body}</p>{/if}
  {:else}
    {#if options.length}
      <div class="options">
        {#each options as option (option)}
          <button type="button" disabled={sending} onclick={() => void send(option)}>{option}</button>
        {/each}
      </div>
    {/if}
    <form class="reply" onsubmit={(event) => { event.preventDefault(); void send(draft); }}>
      <Input class="h-8 min-w-0 flex-1" bind:value={draft} placeholder={m['chat.answer_placeholder']()} aria-label={m['chat.answer_placeholder']()} disabled={sending} />
      <button type="submit" class="send" disabled={sending || !draft.trim()} aria-label={m['chat.answer_send']()}>
        {#if sending}<LoaderCircle size={14} class="animate-spin" />{:else}<SendHorizontal size={14} />{/if}
      </button>
    </form>
    {#if failed}<p class="error" role="alert">{m['chat.answer_failed']()}</p>{/if}
  {/if}
</div>

<style>
  .question {
    display: flex;
    flex-direction: column;
    gap: 8px;
    max-width: 560px;
    margin-top: 4px;
    padding: 12px;
    border-radius: 12px;
    background: color-mix(in srgb, var(--app-warning) 9%, var(--app-surface));
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--app-warning) 30%, transparent);
  }

  .question.answered {
    background: var(--app-surface);
    box-shadow: inset 0 0 0 1px var(--app-border);
  }

  header {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--app-warning);
    font-size: 12px;
    font-weight: 600;
  }

  .answered header {
    color: var(--app-success);
  }

  .body {
    margin: 0;
    color: var(--app-text);
    font-size: 13.5px;
    line-height: 1.5;
    white-space: pre-wrap;
  }

  .answer {
    margin: 0;
    color: var(--app-text-soft);
    font-size: 13px;
  }

  .options {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .options button {
    height: 30px;
    padding: 0 12px;
    border: 0;
    border-radius: 8px;
    background: var(--app-text);
    color: var(--app-surface);
    font: inherit;
    font-size: 12.5px;
    font-weight: 600;
    cursor: pointer;
  }

  .options button:hover:not(:disabled) {
    background: color-mix(in srgb, var(--app-text) 86%, transparent);
  }

  .reply {
    display: flex;
    gap: 6px;
  }

  .send {
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

  .send:disabled,
  .options button:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .options button:focus-visible,
  .send:focus-visible {
    outline: 2px solid var(--app-accent);
    outline-offset: 2px;
  }

  .error {
    margin: 0;
    color: var(--app-danger);
    font-size: 12px;
  }
</style>
