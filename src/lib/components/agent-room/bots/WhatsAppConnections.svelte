<script lang="ts">
  import { untrack } from 'svelte';
  import { MessageCircle, Plus, Link2, RefreshCw, Trash2, LoaderCircle } from '@lucide/svelte';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import * as Select from '$lib/components/ui/select';
  import * as AlertDialog from '$lib/components/ui/alert-dialog';
  import { botApi } from './bot-api.js';
  import * as m from '$lib/paraglide/messages.js';

  type Connection = { id: string; name: string; state: string; enabled: boolean; error: string | null; chats: Array<{ id: string; name: string }> };
  let { workspaceId, nodeId, onChanged }: { workspaceId: string; nodeId: string; onChanged: () => void } = $props();
  let connections = $state<Connection[]>([]), selectedId = $state(''), qr = $state<string | null>(null), connectionState = $state('offline');
  let busy = $state(false), failed = $state(false), chatId = $state(''), senders = $state(''), removing = $state(false);
  const selected = $derived(connections.find(item => item.id === selectedId));
  const base = $derived(`/api/agent-room/workspaces/${workspaceId}/bots`);
  let generation = 0;
  let statusRevision = $state(0);
  async function load() {
    const ticket = ++generation, workspace = workspaceId;
    try {
      const list = await botApi<Connection[]>(`${base}?connections=1`);
      if (ticket !== generation || workspace !== workspaceId) return;
      connections = list;
      if (!list.some(item => item.id === selectedId)) selectedId = list[0]?.id ?? '';
      failed = false; statusRevision++;
    } catch { if (workspace === workspaceId) failed = true; }
  }
  $effect(() => { void workspaceId; void nodeId; return untrack(() => {
    selectedId = ''; qr = null; chatId = ''; senders = ''; void load();
    const changed = () => void load();
    window.addEventListener('orkestrai:bots-changed', changed);
    return () => { generation++; window.removeEventListener('orkestrai:bots-changed', changed); };
  }); });
  $effect(() => {
    const workspace = workspaceId, id = selectedId;
    void statusRevision;
    if (!id) { qr = null; connectionState = 'offline'; return; }
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
    async function poll() {
      try {
        const result = await botApi<{ state: string; qr: string | null; error: string | null }>(`/api/agent-room/workspaces/${workspace}/bots?connectionId=${id}`, undefined, controller.signal);
        if (controller.signal.aborted) return;
        qr = result.qr; connectionState = result.state; failed = Boolean(result.error);
        if (result.state === 'qr' || result.state === 'connecting' || result.state === 'offline') timer = setTimeout(poll, 2500);
      } catch { if (!controller.signal.aborted) { failed = true; connectionState = 'error'; } }
    }
    untrack(() => { void poll(); });
    return () => { controller.abort(); clearTimeout(timer); };
  });
  async function start() {
    if (busy) return; busy = true; failed = false;
    try { const result = await botApi<{ id: string }>(base, { command: 'whatsapp_start', name: 'WhatsApp' }); selectedId = result.id; await load(); }
    catch { failed = true; } finally { busy = false; }
  }
  async function bind() {
    if (!selectedId || !chatId.trim() || busy) return;
    const raw = chatId.trim().replace(/^\+/, '');
    busy = true; failed = false;
    try {
      await botApi(base, { command: 'connect', binding: { nodeId, integrationId: selectedId, externalChatId: /^\d+$/.test(raw) ? `${raw}@s.whatsapp.net` : raw,
        allowedSenders: senders.split(',').map(value => value.trim()).filter(Boolean) } });
      chatId = ''; onChanged();
    } catch { failed = true; } finally { busy = false; }
  }
  async function disconnect() {
    if (!selectedId || busy) return; busy = true;
    try { await botApi(base, { command: 'whatsapp_disconnect', connectionId: selectedId }); selectedId = ''; removing = false; await load(); onChanged(); }
    catch { failed = true; } finally { busy = false; }
  }
</script>

<section class="grid gap-3" aria-label="WhatsApp" data-testid="bot-whatsapp">
  <div class="flex items-center justify-between gap-2"><h3 class="flex items-center gap-2 text-sm font-semibold"><MessageCircle size={16} />WhatsApp</h3>{#if connections.length}<Button size="icon-sm" variant="ghost" aria-label={m['bots.whatsapp_add']()} disabled={busy} onclick={() => void start()}>{#if busy}<LoaderCircle size={15} class="animate-spin" />{:else}<Plus size={15} />{/if}</Button>{/if}</div>
  <p class="text-xs leading-relaxed text-[var(--app-text-muted)]">{m['bots.whatsapp_hint']()}</p>
  {#if connections.length}
    <Select.Root type="single" bind:value={selectedId}><Select.Trigger aria-label={m['bots.whatsapp_account']()}>{selected?.name ?? 'WhatsApp'}</Select.Trigger><Select.Content>{#each connections as connection}<Select.Item value={connection.id}>{connection.name} · {connection.state === 'connected' ? m['bots.connected']() : m['bots.whatsapp_waiting']()}</Select.Item>{/each}</Select.Content></Select.Root>
    {#if qr}<div class="grid justify-items-center gap-2 rounded-xl border border-[var(--app-border)] p-3"><img src={qr} width="224" height="224" alt={m['bots.whatsapp_scan']()} class="max-w-full rounded-lg bg-white" /><p class="text-xs leading-relaxed text-[var(--app-text-muted)]">{m['bots.whatsapp_scan']()}</p></div>
    {:else if connectionState === 'connecting'}<p class="flex items-center gap-2 text-xs" role="status"><LoaderCircle size={14} class="animate-spin" />{m['bots.whatsapp_waiting']()}</p>
    {:else if connectionState === 'connected'}<p class="text-xs text-[var(--app-success)]" role="status">{m['bots.connected']()}</p>{/if}
    {#if connectionState === 'connected'}
      <form class="grid gap-2 rounded-xl border border-[var(--app-border)] p-3" onsubmit={(event: SubmitEvent) => { event.preventDefault(); void bind(); }}>
        {#if selected?.chats.length}<Select.Root type="single" value={chatId} onValueChange={value => (chatId = value)}><Select.Trigger aria-label={m['bots.whatsapp_chat']()}><span class="truncate">{selected.chats.find(item => item.id === chatId)?.name ?? m['bots.whatsapp_chat']()}</span></Select.Trigger><Select.Content>{#each selected.chats as chat}<Select.Item value={chat.id}>{chat.name} · {chat.id}</Select.Item>{/each}</Select.Content></Select.Root>{/if}
        <label class="grid gap-1 text-xs">{m['bots.whatsapp_chat_id']()}<Input bind:value={chatId} maxlength={120} required placeholder="5511999999999" /></label>
        <label class="grid gap-1 text-xs">{m['bots.allowed_senders']()}<Input bind:value={senders} maxlength={6000} /></label>
        <p class="text-xs leading-relaxed text-[var(--app-text-muted)]">{m['bots.allowed_senders_hint']()}</p>
        <Button size="sm" type="submit" disabled={busy || !chatId.trim()}><Link2 size={14} />{m['bots.connect']()}</Button>
      </form>
    {/if}
    <Button size="sm" variant="ghost" disabled={busy} onclick={() => (removing = true)}><Trash2 size={13} />{m['bots.disconnect']()}</Button>
  {:else}<Button size="sm" variant="outline" disabled={busy} onclick={() => void start()}><Plus size={14} />{m['bots.whatsapp_add']()}</Button>{/if}
  {#if failed}<p class="text-xs leading-relaxed text-[var(--app-danger)]" role="alert">{m['bots.whatsapp_error']()}</p><Button size="sm" variant="outline" onclick={() => void load()}><RefreshCw size={13} />{m['chat.profile_memory_retry']()}</Button>{/if}
</section>
<AlertDialog.Root bind:open={removing}><AlertDialog.Content><AlertDialog.Header><AlertDialog.Title>{m['bots.disconnect']()}</AlertDialog.Title><AlertDialog.Description>{m['bots.whatsapp_disconnect_hint']()}</AlertDialog.Description></AlertDialog.Header><AlertDialog.Footer><AlertDialog.Cancel>{m['bots.cancel']()}</AlertDialog.Cancel><AlertDialog.Action onclick={() => void disconnect()}>{m['bots.disconnect']()}</AlertDialog.Action></AlertDialog.Footer></AlertDialog.Content></AlertDialog.Root>
