<script lang="ts">
  import { getCsrfToken } from '@beeblock/svelar/http';
  import { toast } from '@beeblock/svelar/ui';
  import { Activity, CirclePower, Link2, Plus, Trash2 } from '@lucide/svelte';
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

  let { workspaceId, nodeId, payload }: { workspaceId: string; nodeId: string; payload: TerminalNodePayload } = $props();

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

  const chatIntegrations = $derived(integrations.filter((integration) => (integration.type === 'telegram' || integration.type === 'slack') && integration.enabled));
  const chosen = $derived(chatIntegrations.find((integration) => integration.id === integrationId) ?? null);

  async function api<T>(url: string, init?: RequestInit): Promise<T> {
    const csrf = getCsrfToken();
    const response = await fetch(url, { ...init, headers: { 'content-type': 'application/json', ...(csrf ? { 'X-CSRF-Token': csrf } : {}) } });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error ?? m['always_on.error']());
    return body.data as T;
  }

  const base = $derived(`/api/agent-room/workspaces/${encodeURIComponent(workspaceId)}`);

  async function load() {
    const [list, available, snapshot] = await Promise.all([
      api<ChannelBinding[]>(`${base}/channel-bindings?nodeId=${encodeURIComponent(nodeId)}`).catch(() => []),
      api<{ integrations: AutomationIntegration[] }>(`${base}/integrations`).then((data) => data.integrations ?? []).catch(() => []),
      api<ControlCenterSnapshot>(`${base}/control-center`).catch(() => null),
    ]);
    bindings = list;
    integrations = available;
    activity = recentAgentActivity(snapshot?.activity ?? [], nodeId);
  }

  $effect(() => {
    void nodeId;
    runtimeMode = payload.agentRuntimeMode ?? 'interactive';
    void load();
  });

  async function connect() {
    if (!integrationId || !chatId.trim() || saving) return;
    saving = true;
    try {
      const created = await api<ChannelBinding>(`${base}/channel-bindings`, {
        method: 'POST',
        body: JSON.stringify({ nodeId, integrationId, externalChatId: chatId.trim(), allowedSenders: senders.split(',').map((value) => value.trim()).filter(Boolean) }),
      });
      bindings = [...bindings, created];
      adding = false;
      chatId = '';
      senders = '';
    } catch (error) {
      toast.error(error instanceof Error ? error.message : m['always_on.error']());
    } finally {
      saving = false;
    }
  }

  async function toggle(binding: ChannelBinding, enabled: boolean) {
    try {
      const updated = await api<ChannelBinding>(`${base}/channel-bindings/${binding.id}`, { method: 'PATCH', body: JSON.stringify({ enabled }) });
      bindings = bindings.map((candidate) => (candidate.id === binding.id ? updated : candidate));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : m['always_on.error']());
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
  {#each bindings as binding (binding.id)}
    <div class="binding" class:error={Boolean(binding.lastError)}>
      <div class="binding-main">
        <b>{binding.kind === 'telegram' ? 'Telegram' : 'Slack'}</b>
        <span class="mono">{binding.externalChatId}</span>
        {#if binding.lastError}<span class="err" title={binding.lastError}>{binding.lastError}</span>
        {:else if binding.lastInboundAt}<span class="meta">{m['always_on.last_message']({ time: time(binding.lastInboundAt) })}</span>
        {:else}<span class="meta">{binding.allowedSenders.length ? m['always_on.allowed']({ names: binding.allowedSenders.join(', ') }) : m['always_on.anyone']()}</span>{/if}
      </div>
      <Switch checked={binding.enabled} onCheckedChange={(value: boolean) => void toggle(binding, value)} aria-label={m['always_on.enabled']()} />
      <Button size="icon-sm" variant="ghost" aria-label={m['always_on.remove']()} title={m['always_on.remove']()} onclick={() => void remove(binding)}><Trash2 size={13} /></Button>
    </div>
  {/each}
  {#if adding}
    <form class="add" onsubmit={(event) => { event.preventDefault(); void connect(); }}>
      {#if chatIntegrations.length}
        <Select.Root type="single" value={integrationId} onValueChange={(value: string) => (integrationId = value)}>
          <Select.Trigger class="w-full" aria-label={m['always_on.integration']()}><span class="truncate">{chosen?.name ?? m['always_on.integration']()}</span></Select.Trigger>
          <Select.Content>{#each chatIntegrations as integration (integration.id)}<Select.Item value={integration.id}>{integration.name} · {integration.type === 'telegram' ? 'Telegram' : 'Slack'}</Select.Item>{/each}</Select.Content>
        </Select.Root>
        <Input bind:value={chatId} placeholder={chosen?.type === 'slack' ? m['always_on.chat_slack']() : m['always_on.chat_telegram']()} aria-label={m['always_on.chat']()} />
        <Input bind:value={senders} placeholder={m['always_on.senders']()} aria-label={m['always_on.senders']()} />
        <p class="hint">{m['always_on.reply_policy']()}</p>
        <div class="row">
          <Button size="sm" variant="ghost" type="button" onclick={() => (adding = false)}>{m['always_on.cancel']()}</Button>
          <Button size="sm" type="submit" disabled={!integrationId || !chatId.trim() || saving}>{m['always_on.connect']()}</Button>
        </div>
      {:else}
        <p class="hint">{m['always_on.no_integrations']()}</p>
      {/if}
    </form>
  {:else}
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
