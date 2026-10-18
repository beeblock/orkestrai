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
  import { ArrowUp, AtSign, ChevronDown, FileText, Globe, LoaderCircle, SquareTerminal } from '@lucide/svelte';
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
  }: {
    workspaceId: string;
    targets: ComposerTarget[];
    targetId: string | null;
    mentions: ComposerMention[];
    onTargetChange: (id: string) => void;
    onJump: (id: string) => void;
  } = $props();

  let draft = $state('');
  let sending = $state(false);
  let feedback = $state<{ ok: boolean; text: string } | null>(null);
  let mentionOpen = $state(false);
  let mentionFilter = $state('');
  let input = $state<HTMLTextAreaElement | null>(null);
  let feedbackTimer: ReturnType<typeof setTimeout> | null = null;

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
    if (!text || sending || !target) return;
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
    <label class="sr-only" for="canvas-composer-input">{target ? m['composer.target']({ name: target.title }) : m['composer.no_agents']()}</label>
    <textarea
      id="canvas-composer-input"
      bind:this={input}
      bind:value={draft}
      rows="1"
      disabled={!target}
      placeholder={target ? m['composer.placeholder']() : m['composer.no_agents']()}
      oninput={onInput}
      onkeydown={onKeydown}
    ></textarea>
    <button type="button" class="icon" disabled={!target} onclick={() => { draft = `${draft}@`; onInput(); input?.focus(); }} aria-label={m['composer.mention']()}><AtSign size={16} /></button>
    <button type="button" class="send" disabled={!target || !draft.trim() || sending} onclick={() => void send()} aria-label={m['composer.send']()}>
      {#if sending}<LoaderCircle size={15} class="animate-spin" />{:else}<ArrowUp size={15} strokeWidth={2.4} />{/if}
    </button>
  </div>
</div>

<style>
  .composer-wrap {
    position: relative;
    width: min(640px, calc(100vw - 720px));
    min-width: 360px;
    margin-bottom: 4px;
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
