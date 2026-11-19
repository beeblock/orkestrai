<script lang="ts">
  import { untrack, tick } from 'svelte';
  import { Send, Mic, LoaderCircle } from '@lucide/svelte';
  import { Button } from '$lib/components/ui/button';
  import { Textarea } from '$lib/components/ui/textarea';
  import MarkdownView from '../MarkdownView.svelte';
  import ComposerVoice from '../canvas/ComposerVoice.svelte';
  import ComposerAttachButton from '../ComposerAttachButton.svelte';
  import AttachmentList from '../AttachmentList.svelte';
  import MessageAttachments, { messageAttachments } from '../MessageAttachments.svelte';
  import { ComposerAttachments } from '../composer-attachments.svelte.js';
  import { botApi } from './bot-api.js';
  import { botMessageContent } from './bot-message-content.js';
  import type { PersonalBotGroup, PersonalBotSummary } from '$lib/modules/agent-room/contracts/schemas/personal-bot.schema.js';
  import type { ChannelMessage } from '$lib/modules/agent-room/domain/channels.js';
  import * as m from '$lib/paraglide/messages.js';
  let { workspaceId, group, bots }: { workspaceId: string; group: PersonalBotGroup; bots: PersonalBotSummary[] } = $props();
  let messages = $state<ChannelMessage[]>([]), draft = $state(''), sending = $state(false), failed = $state(false), listening = $state(false);
  let scroller = $state<HTMLDivElement | null>(null);
  const staged = new ComposerAttachments(() => workspaceId);
  const conversationIdentity = $derived(`${workspaceId}:${group.id}`);
  let generation = 0;
  async function load() {
    const workspace = workspaceId, id = group.id, ticket = ++generation;
    try {
      const result = await botApi<ChannelMessage[]>(`/api/agent-room/workspaces/${workspace}/bots?groupId=${id}`);
      if (workspace !== workspaceId || id !== group.id || ticket !== generation) return;
      const nearEnd = !scroller || scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 120;
      messages = result.slice().reverse();
      if (nearEnd) { await tick(); if (scroller) scroller.scrollTop = scroller.scrollHeight; }
    } catch { if (workspace === workspaceId && id === group.id) failed = true; }
  }
  $effect(() => { void conversationIdentity; return untrack(() => {
    draft = ''; messages = []; void load();
    const update = (event: Event) => { const frame = (event as CustomEvent).detail; if (frame?.workspaceId === workspaceId && frame?.message?.channel === `botgroup:${group.id}`) void load(); };
    const reconnect = () => void load();
    window.addEventListener('orkestrai:channel-message', update); window.addEventListener('orkestrai:bots-changed', reconnect);
    return () => { generation++; staged.reset(); window.removeEventListener('orkestrai:channel-message', update); window.removeEventListener('orkestrai:bots-changed', reconnect); };
  }); });
  async function send() {
    if ((!draft.trim() && !staged.items.length) || staged.busy || sending) return;
    const text = draft.trim(), workspace = workspaceId, id = group.id, files = staged.reserve();
    sending = true; failed = false;
    try {
      await botApi(`/api/agent-room/workspaces/${workspace}/bots`, { command: 'group_send', groupId: id, body: text || files.attachments.map(item => item.name).join(', '), attachments: files.attachments });
      files.commit();
      if (workspace === workspaceId && id === group.id) { if (draft.trim() === text) draft = ''; await load(); }
    } catch { files.release(); if (workspace === workspaceId && id === group.id) failed = true; }
    finally { sending = false; }
  }
  function dictated(text: string) { draft = [draft.trim(), text.trim()].filter(Boolean).join(' '); listening = false; }
</script>
<div class="flex min-h-0 flex-1 flex-col" data-testid="bot-group-chat">
  <div class="min-h-0 flex-1 overflow-y-auto p-6" bind:this={scroller} aria-live="polite">
    {#each messages as message (message.id)}<article class={`mx-auto mb-6 max-w-3xl rounded-xl ${message.authorKind === 'owner' ? 'bg-[var(--app-accent-soft)] p-4' : ''}`}><small class="mb-2 block text-xs text-[var(--app-text-muted)]">{message.authorKind === 'owner' ? m['chat.you']() : bots.find(bot => bot.id === message.authorNodeId)?.title ?? m['bots.title']()}</small><MarkdownView {workspaceId} content={botMessageContent(message.body, message.meta, workspaceId)} /><MessageAttachments {workspaceId} attachments={messageAttachments(message.meta)} /></article>{/each}
  </div>
  {#if failed || staged.error}<p class="px-6 text-sm text-[var(--app-danger)]" role="alert">{staged.error || m['bots.error']()}</p>{/if}
  <div class="px-6">{#if staged.items.length}<AttachmentList {workspaceId} attachments={staged.items} compact onRemove={staged.sending ? undefined : staged.remove} />{/if}</div>
  <form class="m-4 flex items-end gap-2 rounded-xl border border-[var(--app-border)] bg-[var(--app-surface)] p-2" aria-label={m['composer.drop_files']()} ondragover={staged.dragover} ondragleave={staged.dragleave} ondrop={staged.drop} onsubmit={(event: SubmitEvent) => { event.preventDefault(); void send(); }}>
    {#if listening}<ComposerVoice onTranscript={text => dictated(text)} onClose={() => (listening = false)} onSetupNeeded={() => { listening = false; failed = true; }} />
    {:else}<Textarea bind:value={draft} rows={2} class="min-h-14 flex-1 resize-none border-0 bg-transparent shadow-none" placeholder={m['bots.message']()} aria-label={m['bots.message']()} onpaste={staged.paste} onkeydown={(event: KeyboardEvent) => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); void send(); } }} /><ComposerAttachButton attachments={staged} /><Button type="button" variant="ghost" size="icon-sm" aria-label={m['composer.voice_label']()} onclick={() => (listening = true)}><Mic size={16} /></Button><Button type="submit" size="icon-sm" disabled={sending || staged.busy || (!draft.trim() && !staged.items.length)} aria-label={m['bots.send']()}>{#if sending}<LoaderCircle class="animate-spin" size={17} />{:else}<Send size={17} />{/if}</Button>{/if}
  </form>
</div>
