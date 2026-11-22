<script lang="ts">
  import { Trash2, LoaderCircle } from '@lucide/svelte';
  import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
  import { buttonVariants } from '$lib/components/ui/button/index.js';
  import { botApi } from './bot-api.js';
  import * as m from '$lib/paraglide/messages.js';
  let { workspaceId, channel, messageId = null, throughMessageId = null, onChanged }:
    { workspaceId: string; channel: string; messageId?: string | null; throughMessageId?: string | null; onChanged: () => void | Promise<void> } = $props();
  let open = $state(false), busy = $state(false), failed = $state(false);
  const label = $derived(messageId ? m['bots.history_delete']() : m['bots.history_clear']());
  async function execute() {
    if (busy) return;
    const workspace = workspaceId, ownerChannel = channel;
    busy = true; failed = false;
    try {
      await botApi(`/api/agent-room/workspaces/${workspace}/bots`, messageId
        ? { command: 'history_delete', channel: ownerChannel, messageId }
        : { command: 'history_clear', channel: ownerChannel, throughMessageId });
      if (workspaceId === workspace && channel === ownerChannel) { await onChanged(); open = false; }
    } catch { if (workspaceId === workspace && channel === ownerChannel) failed = true; }
    finally { busy = false; }
  }
</script>
<AlertDialog.Root bind:open>
  <AlertDialog.Trigger class={`${buttonVariants({ variant: 'ghost', size: 'sm' })} gap-1.5 text-[var(--app-text-muted)]`} disabled={!messageId && !throughMessageId} aria-label={label} title={label} onclick={() => { failed = false; }}>
    <Trash2 size={14} aria-hidden="true" />{#if !messageId}{label}{/if}
  </AlertDialog.Trigger>
  <AlertDialog.Content class="max-h-[calc(100dvh-2rem)] overflow-y-auto">
    <AlertDialog.Header><AlertDialog.Title>{label}</AlertDialog.Title><AlertDialog.Description>{m['bots.history_description']()}</AlertDialog.Description></AlertDialog.Header>
    {#if failed}<p class="text-sm text-[var(--app-danger)]" role="alert">{m['bots.history_failed']()}</p>{/if}
    <AlertDialog.Footer><AlertDialog.Cancel disabled={busy}>{m['bots.cancel']()}</AlertDialog.Cancel><AlertDialog.Action variant="destructive" disabled={busy} onclick={(event) => { event.preventDefault(); void execute(); }}>{#if busy}<LoaderCircle size={14} class="animate-spin" aria-hidden="true" />{/if}{label}</AlertDialog.Action></AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>
