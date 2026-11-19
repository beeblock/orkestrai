<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { replaceState } from '$app/navigation';
  import { Bot, UsersRound, Plus, Settings2, RadioTower, Wrench, PanelRight, LoaderCircle, X } from '@lucide/svelte';
  import { Button } from '$lib/components/ui/button';
  import * as Select from '$lib/components/ui/select';
  import BotEditor from '$lib/components/agent-room/bots/BotEditor.svelte';
  import BotGroupEditor from '$lib/components/agent-room/bots/BotGroupEditor.svelte';
  import { botApi, type BotProviderOption } from '$lib/components/agent-room/bots/bot-api.js';
  import AgentChatFace from '$lib/components/agent-room/chat/AgentChatFace.svelte';
  import AgentProfilePanel from '$lib/components/agent-room/chat/AgentProfilePanel.svelte';
  import WhatsAppConnections from '$lib/components/agent-room/bots/WhatsAppConnections.svelte';
  import BotGroupChat from '$lib/components/agent-room/bots/BotGroupChat.svelte';
  import AutomationWorkspace from '$lib/components/agent-room/AutomationWorkspace.svelte';
  import * as Dialog from '$lib/components/ui/dialog';
  import * as AlertDialog from '$lib/components/ui/alert-dialog';
  import AgentRuntimeDialog from '$lib/components/agent-room/canvas/AgentRuntimeDialog.svelte';
  import { retainAgentStatus, agentStatus } from '$lib/components/agent-room/agent-status.svelte.js';
  import { agentStateLabel } from '$lib/components/agent-room/agent-status-labels.js';
  import { clearWorkspaceContext, publishWorkspaceContext, registerWorkspaceSelector } from '$lib/components/agent-room/workspace-context.svelte.js';
  import type { PersonalBotSummary, PersonalBotGroup } from '$lib/modules/agent-room/contracts/schemas/personal-bot.schema.js';
  import type { TerminalNodePayload, Workspace } from '$lib/modules/agent-room/domain/types.js';
  import type { ChannelMessage } from '$lib/modules/agent-room/domain/channels.js';
  import * as m from '$lib/paraglide/messages.js';

  let workspaces = $state<Workspace[]>([]), workspaceId = $state('');
  let bots = $state<PersonalBotSummary[]>([]), groups = $state<PersonalBotGroup[]>([]), providers = $state<BotProviderOption[]>([]);
  let selectedId = $state(''), groupId = $state(''), loading = $state(true), failed = $state(false), connected = $state(false);
  let editorOpen = $state(false), editing = $state<PersonalBotSummary | null>(null), groupEditor = $state(false), runtimeOpen = $state(false);
  let profileOpen = $state(true);
  let generation = 0;
  let automationOpen = $state(false), groupEditing = $state<PersonalBotGroup | null>(null), confirmRemove = $state(false);
  const selected = $derived(bots.find(bot => bot.id === selectedId) ?? null);
  const group = $derived(groups.find(item => item.id === groupId) ?? null);
  const selectedPayload = $derived(selected ? ({ provider: selected.provider, model: selected.model, effort: selected.effort,
    profileId: selected.profileId, personalBot: true, agentTransport: selected.transport, agentRuntimeMode: selected.runtimeMode }) as TerminalNodePayload : null);

  async function refresh() {
    if (!workspaceId) return;
    const id = workspaceId, ticket = ++generation;
    try {
      const result = await botApi<{ bots: PersonalBotSummary[]; groups: PersonalBotGroup[]; providers: BotProviderOption[] }>(`/api/agent-room/workspaces/${id}/bots`);
      if (id !== workspaceId || ticket !== generation) return;
      const previous = new Map(bots.map(bot => [bot.id, bot]));
      bots = result.bots.map(bot => { const old = previous.get(bot.id); return old && Object.keys(bot).every(key => old[key as keyof PersonalBotSummary] === bot[key as keyof PersonalBotSummary]) ? old : bot; });
      groups = result.groups; providers = result.providers; failed = false;
      if (!selectedId && !groupId) selectedId = bots[0]?.id ?? '';
      if (selectedId && !bots.some(bot => bot.id === selectedId)) selectedId = bots[0]?.id ?? '';
      if (groupId && !groups.some(item => item.id === groupId)) groupId = '';
    } catch { if (id === workspaceId) failed = true; }
    finally { if (id === workspaceId) loading = false; }
  }
  $effect(() => { publishWorkspaceContext('bots', workspaceId || null, selectedId || null); });
  $effect(() => {
    if (!workspaceId) return;
    const url = new URL(location.href);
    url.searchParams.set('workspace', workspaceId);
    if (selectedId) url.searchParams.set('node', selectedId); else url.searchParams.delete('node');
    if (groupId) url.searchParams.set('group', groupId); else url.searchParams.delete('group');
    untrack(() => replaceState(url, {}));
  });
  $effect(() => {
    const id = workspaceId;
    if (!id) return;
    return untrack(() => { void refresh(); return retainAgentStatus(id); });
  });

  onMount(() => {
    const params = new URLSearchParams(location.search);
    void botApi<Workspace[]>('/api/agent-room/workspaces').then(list => {
      workspaces = list;
      const preferred = params.get('workspace') ?? localStorage.getItem('orkestrai.activeWorkspaceId');
      workspaceId = list.find(item => item.id === preferred)?.id ?? list[0]?.id ?? '';
      selectedId = params.get('node') ?? '';
      groupId = params.get('group') ?? '';
      if (!workspaceId) loading = false;
    }).catch(() => { failed = true; loading = false; });
    const unregister = registerWorkspaceSelector(id => { workspaceId = id; selectedId = ''; groupId = ''; loading = true; });
    let stopped = false, socket: WebSocket | null = null, retry: ReturnType<typeof setTimeout> | undefined;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined, lastFrame = Date.now();
    const schedule = () => {
      if (refreshTimer) return;
      refreshTimer = setTimeout(() => { refreshTimer = undefined; void refresh(); }, 300);
    };
    function connect() {
      if (stopped) return;
      const live = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/agent-room/pty`);
      socket = live;
      live.onopen = () => {
        connected = true; lastFrame = Date.now();
        live.send(JSON.stringify({ type: 'subscribe', events: ['channelMessage', 'workspaceChanged', 'messageDelivery'] }));
        schedule(); window.dispatchEvent(new CustomEvent('orkestrai:bots-changed'));
      };
      live.onmessage = event => {
        lastFrame = Date.now();
        let frame: { type?: string; workspaceId?: string; channel?: string; message?: ChannelMessage };
        try { frame = JSON.parse(String(event.data)); } catch { return; }
        if (frame.workspaceId && frame.workspaceId !== workspaceId) return;
        if (frame.type === 'channelMessage' && frame.message) {
          window.dispatchEvent(new CustomEvent('orkestrai:channel-message', { detail: frame }));
        } else if (frame.type === 'workspaceChanged') { window.dispatchEvent(new CustomEvent('orkestrai:bots-changed')); schedule(); }
      };
      live.onclose = () => { connected = false; if (!stopped) retry = setTimeout(connect, 2_000); };
      live.onerror = () => live.close();
    }
    connect();
    const heartbeat = setInterval(() => {
      if (socket?.readyState !== WebSocket.OPEN) return;
      if (Date.now() - lastFrame > 30_000) { socket.close(); return; }
      socket.send(JSON.stringify({ type: 'ping' }));
    }, 10_000);
    return () => { stopped = true; generation++; unregister(); clearWorkspaceContext('bots'); clearInterval(heartbeat); clearTimeout(retry); clearTimeout(refreshTimer); socket?.close(); };
  });

  async function removeSelected() {
    try {
      await botApi(`/api/agent-room/workspaces/${workspaceId}/bots`, selected ? { command: 'remove', nodeId: selected.id } : { command: 'group_archive', groupId: group!.id, revision: group!.revision });
      confirmRemove = false; await refresh();
    } catch { failed = true; }
  }
  function saved(bot: PersonalBotSummary) { selectedId = bot.id; groupId = ''; editorOpen = false; void refresh(); }
  function edit(bot: PersonalBotSummary | null) { editing = bot; editorOpen = true; }
  function botStatus(bot: PersonalBotSummary) {
    const status = agentStatus.agents[bot.id];
    return bot.runtimeMode === 'on_demand' && !status?.sessionAlive && (!status || status.state === 'disconnected' || status.state === 'idle')
      ? m['agent_runtime.sleeping']() : agentStateLabel(status?.state ?? 'idle');
  }
</script>

<div class="bots-mode" data-testid="bots-mode">
  <aside class="bot-sidebar">
    <div class="sidebar-heading"><div><h1>{m['bots.title']()}</h1><p>{m['bots.subtitle']()}</p></div><Button size="icon-sm" aria-label={m['bots.create']()} disabled={!workspaceId} onclick={() => edit(null)}><Plus size={16} /></Button></div>
    <Select.Root type="single" value={workspaceId} onValueChange={id => { workspaceId = id; selectedId = ''; groupId = ''; loading = true; }}>
      <Select.Trigger aria-label={m['bots.workspace']()} class="w-full"><span class="truncate">{workspaces.find(item => item.id === workspaceId)?.name ?? m['bots.choose_workspace']()}</span></Select.Trigger>
      <Select.Content>{#each workspaces as item}<Select.Item value={item.id}>{item.name}</Select.Item>{/each}</Select.Content>
    </Select.Root>
    <div class="bot-list">
      {#each bots as bot (bot.id)}
        <button class="bot-row" class:active={selectedId === bot.id && !groupId} onclick={() => { selectedId = bot.id; groupId = ''; }}>
          <span class="bot-avatar"><Bot size={20} strokeWidth={1.7} /></span><span class="bot-info"><strong>{bot.title}</strong><small>{botStatus(bot)}</small></span>
        </button>
      {/each}
      <div class="group-heading"><span>{m['bots.groups']()}</span><Button size="icon-sm" variant="ghost" aria-label={m['bots.create_group']()} disabled={!bots.length} onclick={() => { groupEditing = null; groupEditor = true; }}><Plus size={14} /></Button></div>
      {#each groups as item (item.id)}<button class="bot-row" class:active={groupId === item.id} onclick={() => { groupId = item.id; selectedId = ''; }}><span class="bot-avatar group"><UsersRound size={19} /></span><span class="bot-info"><strong>{item.title}</strong><small>{item.memberIds.length} · {m['bots.members']()}</small></span></button>{/each}
    </div>
    <div class="connection-state" class:online={connected}><RadioTower size={13} />{connected ? m['bots.connected']() : m['bots.reconnecting']()}</div>
  </aside>
  <main class="bot-main">
    {#if loading}<div class="bot-empty"><LoaderCircle class="animate-spin" size={24} /><p>{m['bots.loading']()}</p></div>
    {:else if selected || group}
      <header class="chat-heading"><div><h2>{selected?.title ?? group?.title}</h2><p>{selected ? providers.find(item => item.id === selected?.provider)?.displayName : m['bots.group_hint']()}</p></div><div class="heading-actions">{#if group}<Button variant="ghost" size="icon-sm" aria-label={m['bots.edit_group']()} onclick={() => { groupEditing = group; groupEditor = true; }}><Settings2 size={16} /></Button><Button variant="ghost" size="sm" onclick={() => (confirmRemove = true)}>{m['bots.archive_group']()}</Button>{/if}{#if selected}<Button variant="ghost" size="icon-sm" aria-label={m['bots.edit']()} onclick={() => edit(selected)}><Settings2 size={16} /></Button><Button variant="ghost" size="icon-sm" aria-label={m['bots.profile_tab']()} onclick={() => (profileOpen = !profileOpen)}><PanelRight size={16} /></Button>{/if}</div></header>
      {#if failed}<p class="bot-error" role="alert">{m['bots.error']()}</p>{/if}
      {#if selected}
        {#key `${workspaceId}:${selected.id}`}<div class="bot-conversation"><AgentChatFace {workspaceId} nodeId={selected.id} title={selected.title} voice personalBot /></div>{/key}
      {:else if group}
        {#key `${workspaceId}:${group.id}`}<BotGroupChat {workspaceId} {group} {bots} />{/key}
      {/if}
    {:else}<div class="bot-empty"><span class="empty-avatar"><Bot size={34} strokeWidth={1.4} /></span><h2>{m['bots.empty']()}</h2><p>{failed ? m['bots.error']() : m['bots.empty_hint']()}</p><Button disabled={!workspaceId} onclick={() => edit(null)}><Plus size={16} />{m['bots.create']()}</Button></div>{/if}
  </main>
  {#if selected && profileOpen && selectedPayload}
    <aside class="bot-profile"><div class="profile-heading"><h2>{m['bots.profile_tab']()}</h2><div class="flex items-center gap-1"><Button variant="ghost" size="icon-sm" aria-label={m['bots.settings']()} onclick={() => (runtimeOpen = true)}><Settings2 size={15} /></Button><Button variant="ghost" size="icon-sm" aria-label={m['chat.profile_close']()} onclick={() => (profileOpen = false)}><X size={15} /></Button></div></div><div class="tools-card"><Wrench size={17} /><div><strong>{m['bots.all_tools']()}</strong><p>{m['bots.all_tools_hint']()}</p></div></div><p class="bot-instructions">{selected.instructions}</p><AgentProfilePanel embedded {workspaceId} nodeId={selected.id} title={selected.title} payload={selectedPayload} onClose={() => (profileOpen = false)} onDirect={() => {}}><WhatsAppConnections {workspaceId} nodeId={selected.id} onChanged={() => window.dispatchEvent(new CustomEvent("orkestrai:bots-changed"))} /></AgentProfilePanel><Button variant="outline" size="sm" onclick={() => (automationOpen = true)}>{m['bots.automations']()}</Button><Button variant="ghost" size="sm" onclick={() => (confirmRemove = true)}>{m['bots.remove']()}</Button></aside>
  {/if}
</div>
{#if editorOpen}<BotEditor {workspaceId} {providers} bot={editing} onSaved={saved} onClose={() => (editorOpen = false)} />{/if}
{#if groupEditor}<BotGroupEditor {workspaceId} {bots} group={groupEditing} onSaved={item => { groupId = item.id; selectedId = ''; groupEditor = false; void refresh(); }} onClose={() => (groupEditor = false)} />{/if}
{#if selected}<AgentRuntimeDialog open={runtimeOpen} {workspaceId} nodeId={selected.id} onChanged={() => void refresh()} onClose={() => (runtimeOpen = false)} />{/if}

<style>
  .bots-mode { display: flex; height: 100%; min-height: 0; color: var(--app-text); background: var(--app-canvas); }
  .bot-sidebar { display: flex; width: 264px; min-width: 216px; flex-direction: column; gap: 18px; border-right: 1px solid var(--app-border); padding: 22px 14px 12px; background: var(--app-sidebar); }
  .sidebar-heading, .chat-heading, .profile-heading, .group-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  h1, h2, p { margin: 0; } h1 { font-size: 20px; letter-spacing: -.025em; font-weight: 650; }
  .sidebar-heading p { margin-top: 5px; color: var(--app-text-muted); font-size: 12px; line-height: 1.5; text-wrap: pretty; }
  .bot-list { flex: 1; min-height: 0; overflow-y: auto; } .bot-row { display: flex; width: 100%; gap: 11px; align-items: center; border: 0; border-radius: 10px; padding: 10px; margin-bottom: 3px; text-align: left; background: transparent; cursor: pointer; }
  .bot-row:hover { background: color-mix(in srgb,var(--app-text) 5%,transparent); } .bot-row.active { background: var(--app-accent-soft); }
  .bot-row:focus-visible { outline: 2px solid var(--app-accent); outline-offset: -2px; }
  .bot-avatar { display: grid; place-items: center; width: 38px; height: 38px; border-radius: 11px; background: color-mix(in srgb,var(--app-accent) 10%,var(--app-surface)); color: var(--app-accent); flex: 0 0 auto; }
  .bot-avatar.group { background: color-mix(in srgb,var(--app-text) 6%,var(--app-surface)); color: var(--app-text-soft); }
  .bot-info { min-width: 0; display: grid; gap: 4px; } .bot-info strong { font-size: 13px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .bot-info small { font-size: 11px; color: var(--app-text-muted); }
  .group-heading { margin: 22px 8px 6px; color: var(--app-text-muted); font-size: 11px; font-weight: 600; }
  .connection-state { display: flex; gap: 7px; align-items: center; color: var(--app-text-muted); font-size: 11px; } .connection-state.online { color: var(--app-success); }
  .bot-main { display: flex; flex: 1; flex-direction: column; min-width: 0; min-height: 0; background: var(--app-surface); }
  .chat-heading { min-height: 76px; padding: 18px 26px; border-bottom: 1px solid var(--app-border); } .chat-heading > div:first-child { min-width: 0; } .chat-heading h2 { overflow-wrap: anywhere; font-size: 16px; font-weight: 600; letter-spacing: -.015em; } .chat-heading p { margin-top: 5px; font-size: 12px; color: var(--app-text-muted); text-wrap: pretty; } .heading-actions { display: flex; gap: 5px; }
  .bot-conversation { flex: 1; min-height: 0; padding: 12px 18px; }
  .bot-empty { display: flex; flex: 1; gap: 16px; flex-direction: column; align-items: center; justify-content: center; padding: 32px; text-align: center; } .bot-empty h2 { font-size: 23px; letter-spacing: -.025em; font-weight: 600; } .bot-empty p { max-width: 390px; color: var(--app-text-muted); font-size: 14px; line-height: 1.65; text-wrap: pretty; } .empty-avatar { display: grid; place-items: center; width: 76px; height: 76px; border-radius: 22px; background: var(--app-accent-soft); color: var(--app-accent); }
  .bot-profile { display: flex; flex-direction: column; gap: 24px; width: 318px; flex: 0 0 auto; border-left: 1px solid var(--app-border); padding: 22px; overflow-y: auto; background: var(--app-sidebar); } .profile-heading h2 { font-size: 13px; font-weight: 600; }
  .tools-card { display: flex; align-items: flex-start; gap: 10px; padding: 13px; border: 1px solid var(--app-border); border-radius: 12px; } .tools-card svg { flex: 0 0 auto; color: var(--app-accent); } .tools-card strong { display: block; font-size: 12px; font-weight: 600; } .tools-card p { margin-top: 5px; font-size: 11px; line-height: 1.65; color: var(--app-text-muted); text-wrap: pretty; }
  .bot-instructions { max-height: 160px; overflow-y: auto; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 12px; line-height: 1.7; color: var(--app-text-soft); }
  .bot-instructions, .profile-heading, .tools-card { flex-shrink: 0; }
  .bot-error { padding: 12px 24px; color: var(--app-danger); font-size: 13px; }
  .group-conversation { flex: 1; min-height: 0; overflow-y: auto; padding: 24px; } .group-conversation article { max-width: 780px; margin: 0 auto 22px; } .group-conversation small { display: block; margin-bottom: 7px; color: var(--app-text-muted); font-size: 11px; } .group-conversation article.owner { padding: 13px 16px; background: var(--app-accent-soft); border-radius: 14px; }
  .group-composer { display: flex; align-items: flex-end; gap: 10px; margin: 12px 24px 22px; } .group-composer :global(textarea) { flex: 1; resize: vertical; }
  @media (max-width: 1150px) { .bot-profile { width: 274px; padding: 16px; } .bot-sidebar { width: 224px; } }
  @media (max-width: 960px) { .bot-profile { position: absolute; right: 0; top: 0; bottom: 0; z-index: 20; width: min(340px,80vw); box-shadow: var(--app-shadow-lg); } .bots-mode { position: relative; } }
  @media (max-width: 640px) { .bot-sidebar { width: 168px; min-width: 150px; padding: 16px 8px; } .sidebar-heading p { display: none; } .bot-row { padding: 8px 5px; gap: 7px; } .bot-avatar { width: 30px; height: 30px; border-radius: 9px; } .chat-heading { padding: 14px; } .bot-conversation { padding: 8px; } }
</style>

<Dialog.Root bind:open={automationOpen}><Dialog.Content class="h-[85dvh] w-[94vw] max-w-[1100px] overflow-auto"><Dialog.Header><Dialog.Title>{m['bots.automations']()}</Dialog.Title><Dialog.Description>{m['bots.automations_hint']()}</Dialog.Description></Dialog.Header><AutomationWorkspace {workspaceId} terminals={bots.map(bot => ({ id: bot.id, title: bot.title }))} compact /></Dialog.Content></Dialog.Root>
<AlertDialog.Root bind:open={confirmRemove}><AlertDialog.Content><AlertDialog.Header><AlertDialog.Title>{group ? m['bots.archive_group']() : m['bots.remove']()}</AlertDialog.Title><AlertDialog.Description>{m['bots.confirm_remove']()}</AlertDialog.Description></AlertDialog.Header><AlertDialog.Footer><AlertDialog.Cancel>{m['bots.cancel']()}</AlertDialog.Cancel><AlertDialog.Action onclick={() => void removeSelected()}>{m['bots.remove']()}</AlertDialog.Action></AlertDialog.Footer></AlertDialog.Content></AlertDialog.Root>
