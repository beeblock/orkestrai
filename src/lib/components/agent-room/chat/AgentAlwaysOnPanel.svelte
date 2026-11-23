<script lang="ts">
  import { untrack } from 'svelte';
  import { getCsrfToken } from '@beeblock/svelar/http';
  import { toast } from '@beeblock/svelar/ui';
  import { Activity, CirclePower, Link2, Pencil, Plus, Trash2 } from '@lucide/svelte';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import * as Select from '$lib/components/ui/select';
  import { Switch } from '$lib/components/ui/switch';
  import AgentRuntimeDialog from '../canvas/AgentRuntimeDialog.svelte';
  import { agentStateLabel } from '../agent-status-labels.js';
  import { recentAgentActivity } from './agent-recent-activity.js';
  import type { ChannelBinding } from '$lib/modules/agent-room/domain/channels.js';
  import type { AgentActivity, AutomationIntegration, ControlCenterSnapshot, TerminalNodePayload } from '$lib/modules/agent-room/domain/types.js';
  import * as m from '$lib/paraglide/messages.js';
  import { getLocale } from '$lib/paraglide/runtime.js';
  import { botApi } from '../bots/bot-api.js';
  import ModelCombobox from '../canvas/ModelCombobox.svelte';
  import { SegmentedControl } from '$lib/components/ui/segmented';

  let { workspaceId, nodeId, payload, botEvents = false, botTitle = 'Bot', onSetupChannel }: { workspaceId: string; nodeId: string; payload: TerminalNodePayload; botEvents?: boolean; botTitle?: string; onSetupChannel?: (provider: 'telegram' | 'slack') => void } = $props();

  let bindings = $state<ChannelBinding[]>([]);
  let integrations = $state<AutomationIntegration[]>([]);
  let activity = $state<AgentActivity[]>([]);
  let runtimeOpen = $state(false);
  let runtimeMode = $state<string>('interactive');
  let adding = $state(false);
  let integrationId = $state('');
  let chatId = $state('');
  let senders = $state('');
  let saving = $state(false);
  let targets = $state<Array<{ id: string; name: string }>>([]), finding = $state(false), targetError = $state(false);
  let replyMode = $state<'all' | 'prefix'>('prefix'), prefixes = $state('');
  let editingBindingId = $state(''), editSenders = $state(''), editPrefixes = $state('');
  let editReplyMode = $state<'all' | 'prefix'>('prefix');
  const prefixRules = $derived(prefixes.split(',').map(value => value.trim()).filter(Boolean));
  const senderRules = $derived(senders.split(',').map(value => value.trim()).filter(Boolean));
  const editPrefixRules = $derived(editPrefixes.split(',').map(value => value.trim()).filter(Boolean));
  const editSenderRules = $derived(editSenders.split(',').map(value => value.trim()).filter(Boolean));

  function connectionError(error: unknown): string {
    const code = error instanceof Error ? error.message : '';
    return code === 'BOT_ROUTE_CONFLICT' ? m['bots.route_conflict']() : code === 'BOT_CHAT_ALREADY_CONNECTED' ? m['bots.route_exists']()
      : code === 'BOT_SENDER_INVALID' ? m['bots.route_sender_invalid']() : code || m['always_on.error']();
  }

  function editBinding(binding: ChannelBinding) {
    editingBindingId = binding.id;
    editSenders = binding.allowedSenders.join(', ');
    editPrefixes = (binding.replyPrefixes ?? []).join(', ');
    editReplyMode = binding.replyPrefixes?.length ? 'prefix' : 'all';
  }

  async function saveBinding(binding: ChannelBinding) {
    if (saving || editReplyMode === 'prefix' && !editPrefixRules.length || editSenders.trim() && !editSenderRules.length) return;
    saving = true;
    try {
      const updated = await api<ChannelBinding>(`${base}/channel-bindings/${binding.id}`, {
        method: 'PATCH', body: JSON.stringify({ allowedSenders: editSenderRules,
          replyPrefixes: editReplyMode === 'prefix' ? editPrefixRules : [] }),
      });
      bindings = bindings.map(item => item.id === updated.id ? updated : item);
      editingBindingId = '';
    } catch (error) { toast.error(connectionError(error)); }
    finally { saving = false; }
  }

  async function discover() {
    if (!integrationId || finding) return;
    const id = integrationId, node = nodeId, workspace = workspaceId;
    finding = true; targetError = false;
    try {
      const result = await botApi<Array<{ id: string; name: string }>>(`/api/agent-room/workspaces/${workspace}/bots`, { command: 'channel_targets', nodeId: node, integrationId: id });
      if (id === integrationId && node === nodeId && workspace === workspaceId) targets = result;
    } catch { if (node === nodeId && workspace === workspaceId) targetError = true; }
    finally { finding = false; }
  }
  function chooseChannel(provider: 'telegram' | 'slack') {
    const account = chatIntegrations.find(item => item.type === provider);
    if (!account) { onSetupChannel?.(provider); return; }
    integrationId = account.id; adding = true; targets = []; void discover();
  }

  const chatIntegrations = $derived(integrations.filter((integration) => (integration.type === 'telegram' || integration.type === 'slack') && integration.enabled && (!botEvents || integration.status === 'connected' && integration.permissions.includes(`${integration.type}.send_message`) && integration.permissions.includes(integration.type === 'telegram' ? 'telegram.read_updates' : 'slack.read_messages'))));
  const chosen = $derived(chatIntegrations.find((integration) => integration.id === integrationId) ?? null);

  async function api<T>(url: string, init?: RequestInit): Promise<T> {
    const csrf = getCsrfToken();
    const response = await fetch(url, { ...init, headers: { 'content-type': 'application/json', ...(csrf ? { 'X-CSRF-Token': csrf } : {}) } });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error ?? m['always_on.error']());
    return body.data as T;
  }

  const base = $derived(`/api/agent-room/workspaces/${encodeURIComponent(workspaceId)}`);
  const nodeScope = $derived(`${workspaceId}:${nodeId}`);

  let loadGeneration = 0;
  async function load() {
    const ticket = ++loadGeneration, workspace = workspaceId, node = nodeId;
    const [list, available, snapshot] = await Promise.all([
      api<ChannelBinding[]>(`${base}/channel-bindings?nodeId=${encodeURIComponent(nodeId)}`).catch(() => []),
      api<{ integrations: AutomationIntegration[] }>(`${base}/integrations`).then((data) => data.integrations ?? []).catch(() => []),
      api<ControlCenterSnapshot>(`${base}/control-center?communications=0`).catch(() => null),
    ]);
    if (ticket !== loadGeneration || workspace !== workspaceId || node !== nodeId) return;
    bindings = list;
    integrations = available;
    activity = recentAgentActivity(snapshot?.activity ?? [], nodeId);
  }

  $effect(() => {
    runtimeMode = payload.agentRuntimeMode ?? 'interactive';
  });
  $effect(() => {
    void nodeScope;
    return untrack(() => { void load(); return () => { loadGeneration++; }; });
  });

  $effect(() => {
    if (!botEvents) return;
    void nodeScope;
    return untrack(() => {
    integrationId = ''; chatId = ''; senders = ''; targets = []; adding = false; replyMode = 'prefix'; editingBindingId = '';
    const changed = () => void load();
    const ready = (event: Event) => {
      const data = (event as CustomEvent<{ nodeId: string; integrationId: string }>).detail;
      if (data?.nodeId !== nodeId) return;
      integrationId = data.integrationId; adding = true; void load(); void discover();
    };
    window.addEventListener('orkestrai:bots-changed', changed);
    window.addEventListener('orkestrai:bot-integration-ready', ready);
    prefixes = `@${botTitle.replace(/\s+/g, '')}`;
    return () => { window.removeEventListener('orkestrai:bots-changed', changed); window.removeEventListener('orkestrai:bot-integration-ready', ready); };
    });
  });

  async function connect() {
    if (!integrationId || !chatId.trim() || saving || botEvents && replyMode === 'prefix' && !prefixRules.length || senders.trim() && !senderRules.length) return;
    saving = true;
    try {
      const created = await api<ChannelBinding>(`${base}/channel-bindings`, {
        method: 'POST',
        body: JSON.stringify({ nodeId, integrationId, externalChatId: chatId.trim(), allowedSenders: senderRules, replyPrefixes: botEvents && replyMode === 'prefix' ? prefixRules : [] }),
      });
      bindings = [...bindings, created];
      adding = false;
      chatId = '';
      senders = '';
    } catch (error) {
      toast.error(connectionError(error));
    } finally {
      saving = false;
    }
  }

  async function toggle(binding: ChannelBinding, enabled: boolean) {
    try {
      const updated = await api<ChannelBinding>(`${base}/channel-bindings/${binding.id}`, { method: 'PATCH', body: JSON.stringify({ enabled }) });
      bindings = bindings.map((candidate) => (candidate.id === binding.id ? updated : candidate));
    } catch (error) {
      toast.error(connectionError(error));
    }
  }

  async function remove(binding: ChannelBinding) {
    try {
      await api(`${base}/channel-bindings/${binding.id}`, { method: 'DELETE' });
      bindings = bindings.filter((candidate) => candidate.id !== binding.id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : m['always_on.error']());
    }
  }

  function modeLabel(mode: string): string {
    if (mode === 'persistent') return m['always_on.mode_persistent']();
    if (mode === 'on_demand') return m['always_on.mode_on_demand']();
    return m['always_on.mode_interactive']();
  }

  function time(iso: string): string {
    return new Date(iso).toLocaleString(getLocale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }
</script>

<section class="block">
  <h3><CirclePower size={13} />{m['always_on.title']()}</h3>
  <div class="mode">
    <span class="chip" class:on={runtimeMode !== 'interactive'}>{modeLabel(runtimeMode)}</span>
    <Button size="sm" variant="outline" class="h-7 text-ui-sm" onclick={() => (runtimeOpen = true)}>{m['always_on.configure']()}</Button>
  </div>
  <p class="hint">{runtimeMode === 'interactive' ? m['always_on.hint_interactive']() : m['always_on.hint_on']()}</p>
</section>

<section class="block">
  <h3><Link2 size={13} />{m['always_on.channels']()}</h3>
  {#if botEvents && onSetupChannel}<div class="grid gap-2"><Button size="sm" variant="outline" onclick={() => chooseChannel('telegram')}>{m['bots.setup_title']({ provider: 'Telegram' })}</Button><Button size="sm" variant="outline" onclick={() => chooseChannel('slack')}>{m['bots.setup_title']({ provider: 'Slack' })}</Button></div>{/if}
  {#each bindings as binding (binding.id)}
    <div class="binding" class:error={Boolean(binding.lastError)}>
      <div class="binding-main">
        <b>{binding.kind === 'telegram' ? 'Telegram' : binding.kind === 'whatsapp' ? 'WhatsApp' : 'Slack'}</b>
        <span class="mono">{binding.externalChatId}</span>
        {#if botEvents}<span class="meta">{binding.replyPrefixes?.length ? binding.replyPrefixes.join(', ') : m['bots.reply_all']()}</span><span class="meta">{binding.allowedSenders.length ? m['always_on.allowed']({ names: binding.allowedSenders.join(', ') }) : m['always_on.anyone']()}</span>{/if}
        {#if binding.lastError}<span class="err" title={binding.lastError}>{binding.lastError === 'BOT_DELIVERY_PENDING' ? m['bots.delivery_pending']() : binding.lastError === 'BOT_DELIVERY_UNCERTAIN' ? m['bots.delivery_uncertain']() : binding.lastError}</span>
        {:else if binding.lastInboundAt}<span class="meta">{m['always_on.last_message']({ time: time(binding.lastInboundAt) })}</span>
        {:else}<span class="meta">{binding.allowedSenders.length ? m['always_on.allowed']({ names: binding.allowedSenders.join(', ') }) : m['always_on.anyone']()}</span>{/if}
      </div>
      <Switch checked={binding.enabled} disabled={saving} onCheckedChange={(value: boolean) => void toggle(binding, value)} aria-label={m['always_on.enabled']()} />
      {#if botEvents}<Button size="icon-sm" variant="ghost" disabled={saving} aria-label={m['bots.edit_route']()} title={m['bots.edit_route']()} onclick={() => editBinding(binding)}><Pencil size={13} /></Button>{/if}
      <Button size="icon-sm" variant="ghost" disabled={saving} aria-label={m['always_on.remove']()} title={m['always_on.remove']()} onclick={() => void remove(binding)}><Trash2 size={13} /></Button>
    </div>
    {#if editingBindingId === binding.id}
      <form class="grid gap-2 rounded-lg border border-[var(--app-border)] p-3" aria-label={m['bots.edit_route']()} onsubmit={event => { event.preventDefault(); void saveBinding(binding); }}>
        <label class="grid gap-1 text-xs">{m['bots.allowed_senders']()}<Input bind:value={editSenders} maxlength={6000} disabled={saving} /></label>
        <p class="hint">{binding.kind === 'whatsapp' ? m['bots.allowed_senders_hint']() : m['bots.route_senders_hint']()}</p>
        <SegmentedControl fill label={m['bots.reply_when']()} value={editReplyMode} onValueChange={value => (editReplyMode = value)} options={[{ value: 'prefix', label: m['bots.reply_prefix']() }, { value: 'all', label: m['bots.reply_all']() }]} />
        {#if editReplyMode === 'prefix'}<label class="grid gap-1 text-xs">{m['bots.prefixes']()}<Input bind:value={editPrefixes} maxlength={809} required disabled={saving} /></label>{/if}
        <p class="hint">{m['bots.prefixes_hint']()}</p>
        <div class="row"><Button size="sm" variant="ghost" type="button" disabled={saving} onclick={() => (editingBindingId = '')}>{m['always_on.cancel']()}</Button><Button size="sm" type="submit" disabled={saving || editReplyMode === 'prefix' && !editPrefixRules.length || Boolean(editSenders.trim()) && !editSenderRules.length}>{m['bots.save']()}</Button></div>
      </form>
    {/if}
  {/each}
  {#if adding}
    <form class="add" onsubmit={(event) => { event.preventDefault(); void connect(); }}>
      {#if chatIntegrations.length}
        <Select.Root type="single" value={integrationId} onValueChange={(value: string) => (integrationId = value)}>
          <Select.Trigger class="w-full" aria-label={m['always_on.integration']()}><span class="truncate">{chosen?.name ?? m['always_on.integration']()}</span></Select.Trigger>
          <Select.Content>{#each chatIntegrations as integration (integration.id)}<Select.Item value={integration.id}>{integration.name} · {integration.type === 'telegram' ? 'Telegram' : 'Slack'}</Select.Item>{/each}</Select.Content>
        </Select.Root>
        {#if botEvents}
          <p class="hint">{chosen?.type === 'telegram' ? m['bots.telegram_find_chat']() : m['bots.slack_find_chat']()}</p>
          <Button type="button" size="sm" variant="outline" disabled={finding || !integrationId} onclick={() => void discover()}>{finding ? m['bots.loading']() : m['bots.find_chats']()}</Button>
          {#if targets.length}<ModelCombobox value={chatId} options={targets.map(item => ({ value: item.id, label: item.name }))} defaultLabel={m['always_on.chat']()} searchPlaceholder={m['bots.whatsapp_search']()} emptyLabel={m['bots.no_chats']()} ariaLabel={m['always_on.chat']()} onValueChange={value => (chatId = value)} />{:else if targetError}<p class="hint" role="alert">{m['bots.find_chats_error']()}</p>{:else if !finding}<p class="hint">{m['bots.no_chats']()}</p>{/if}
        {/if}
        <Input bind:value={chatId} placeholder={chosen?.type === 'slack' ? m['always_on.chat_slack']() : m['always_on.chat_telegram']()} aria-label={m['always_on.chat']()} />
        <Input bind:value={senders} placeholder={m['always_on.senders']()} aria-label={m['always_on.senders']()} />
        {#if botEvents}<SegmentedControl fill label={m['bots.reply_when']()} value={replyMode} onValueChange={value => (replyMode = value)} options={[{ value: 'prefix', label: m['bots.reply_prefix']() }, { value: 'all', label: m['bots.reply_all']() }]} />{#if replyMode === 'prefix'}<Input bind:value={prefixes} maxlength={809} required aria-label={m['bots.prefixes']()} /><p class="hint">{m['bots.prefixes_hint']()}</p>{/if}{/if}
        <p class="hint">{m['always_on.reply_policy']()}</p>
        <div class="row">
          <Button size="sm" variant="ghost" type="button" onclick={() => (adding = false)}>{m['always_on.cancel']()}</Button>
          <Button size="sm" type="submit" disabled={!integrationId || !chatId.trim() || saving || botEvents && replyMode === 'prefix' && !prefixRules.length || Boolean(senders.trim()) && !senderRules.length}>{m['always_on.connect']()}</Button>
        </div>
      {:else}
        <p class="hint">{botEvents ? m['bots.setup_description']() : m['always_on.no_integrations']()}</p>
      {/if}
    </form>
  {:else if !botEvents}
    <Button size="sm" variant="ghost" class="h-7 justify-start gap-1.5 text-ui-sm" onclick={() => (adding = true)}><Plus size={13} />{m['always_on.add_channel']()}</Button>
  {/if}
</section>

<section class="block">
  <h3><Activity size={13} />{m['always_on.recent']()}</h3>
  {#if activity.length}
    <ul>
      {#each activity as event (event.id)}
        <li><span>{event.objectTitle ?? agentStateLabel(event.state)}</span><time>{time(event.createdAt)}</time></li>
      {/each}
    </ul>
  {:else}
    <p class="hint">{m['always_on.recent_empty']()}</p>
  {/if}
</section>

<AgentRuntimeDialog
  open={runtimeOpen}
  {workspaceId}
  {nodeId}
  onChanged={(runtime) => { runtimeMode = runtime.mode; }}
  onClose={() => (runtimeOpen = false)}
/>

<style>
  .block {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  h3 {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0;
    color: var(--app-text-muted);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  .mode {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .chip {
    padding: 3px 9px;
    border-radius: 999px;
    background: var(--app-hover);
    color: var(--app-text-soft);
    font-size: 12px;
    font-weight: 600;
  }

  .chip.on {
    background: var(--app-success-soft);
    color: var(--app-success);
  }

  .hint {
    margin: 0;
    color: var(--app-text-muted);
    font-size: 12px;
    line-height: 1.45;
  }

  .binding {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 6px 8px 10px;
    border-radius: 9px;
    background: var(--app-surface);
    box-shadow: inset 0 0 0 1px var(--app-border);
  }

  .binding.error {
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--app-danger) 40%, transparent);
  }

  .binding-main {
    min-width: 0;
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 1px;
    font-size: 12.5px;
  }

  .mono {
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 12px;
    color: var(--app-text-soft);
  }

  .meta,
  .err {
    overflow: hidden;
    font-size: 11.5px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .meta {
    color: var(--app-text-muted);
  }

  .err {
    color: var(--app-danger);
  }

  .add {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .row {
    display: flex;
    justify-content: flex-end;
    gap: 6px;
  }

  ul {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  li {
    display: flex;
    justify-content: space-between;
    gap: 10px;
    font-size: 12px;
  }

  li span {
    min-width: 0;
    overflow: hidden;
    color: var(--app-text-soft);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  li time {
    flex: none;
    color: var(--app-text-muted);
    font-size: 11.5px;
  }
</style>
