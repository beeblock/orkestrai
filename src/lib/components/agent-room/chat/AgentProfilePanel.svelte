<script lang="ts">
  import { Brain, CalendarClock, Focus, MessageSquare, Network, X } from '@lucide/svelte';
  import AgentAvatar from '../AgentAvatar.svelte';
  import { getCsrfToken } from '@beeblock/svelar/http';
  import { toast } from '@beeblock/svelar/ui';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import AgentGlyph from '../AgentGlyph.svelte';
  import AgentAlwaysOnPanel from './AgentAlwaysOnPanel.svelte';
  import { agentStatus, statusClock } from '../agent-status.svelte.js';
  import { agentTone, elapsedParts, modelFromArgs } from '../agent-identity.js';
  import { agentActionLabel, agentStateLabel, elapsedLabel } from '../agent-status-labels.js';
  import { routineCadence, routineNextRun } from './routine-labels.js';
  import { providerIcons } from '$lib/modules/agent-room/domain/provider-icons.js';
  import type { Routine, TerminalNodePayload, WorkspaceMemoryEntry } from '$lib/modules/agent-room/domain/types.js';
  import * as m from '$lib/paraglide/messages.js';

  let {
    workspaceId,
    nodeId,
    title,
    payload,
    onClose,
    onDirect,
  }: {
    workspaceId: string;
    nodeId: string;
    title: string;
    payload: TerminalNodePayload;
    onClose: () => void;
    onDirect: (nodeId: string) => void;
  } = $props();

  let routineDraft = $state('');
  let routineSending = $state(false);

  // The agent turns the sentence into an automation with its own tools and confirms in Chat.
  async function askRoutine() {
    const sentence = routineDraft.trim();
    if (!sentence || routineSending) return;
    routineSending = true;
    const csrf = getCsrfToken();
    const response = await fetch(`/api/agent-room/workspaces/${encodeURIComponent(workspaceId)}/channels/${encodeURIComponent(`dm:${nodeId}`)}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(csrf ? { 'X-CSRF-Token': csrf } : {}) },
      body: JSON.stringify({ body: m['chat.routine_request']({ sentence }) }),
    }).catch(() => null);
    routineSending = false;
    if (response?.ok) {
      routineDraft = '';
      toast.success(m['chat.routine_sent']({ name: title }));
    } else {
      toast.error(m['chat.send_failed']());
    }
  }

  let memory = $state<WorkspaceMemoryEntry[]>([]);
  let routines = $state<Routine[]>([]);

  const status = $derived(agentStatus.agents[nodeId] ?? null);
  const activity = $derived(status ? (status.sessionAlive ? status.state : 'disconnected') : 'idle');
  const since = $derived.by(() => {
    const parts = status ? elapsedParts(status.stateSince, statusClock.now) : null;
    return parts ? elapsedLabel(parts) : null;
  });
  const model = $derived(modelFromArgs(payload.args ?? []));
  const query = $derived(`workspace=${encodeURIComponent(workspaceId)}&node=${encodeURIComponent(nodeId)}`);

  $effect(() => {
    const id = nodeId;
    const workspace = workspaceId;
    const controller = new AbortController();
    memory = [];
    routines = [];
    void fetch(`/api/agent-room/workspaces/${encodeURIComponent(workspace)}/memory?limit=200`, { signal: controller.signal })
      .then((response) => response.ok ? response.json() : null)
      .then((body: { data?: WorkspaceMemoryEntry[] } | null) => {
        memory = (body?.data ?? []).filter((entry) => entry.createdByNodeId === id && entry.status === 'active').slice(0, 8);
      })
      .catch(() => {});
    void fetch(`/api/agent-room/workspaces/${encodeURIComponent(workspace)}/routines`, { signal: controller.signal })
      .then((response) => response.ok ? response.json() : null)
      .then((body: { data?: Routine[] } | null) => {
        routines = (body?.data ?? []).filter((routine) => routine.targetNodeId === id);
      })
      .catch(() => {});
    return () => controller.abort();
  });
</script>

<aside class="profile" aria-label={m['chat.profile_label']({ name: title })}>
  <header>
    <button type="button" class="close" onclick={onClose} aria-label={m['chat.profile_close']()}><X size={14} /></button>
  </header>
  <div class="identity">
    <AgentAvatar {nodeId} {title} size={56} />
    <h2 class="headline">{title}</h2>
    {#if payload.role}<p class="role">{payload.role}</p>{/if}
    <p class="status"><AgentGlyph tone={agentTone(activity)} label={agentStateLabel(activity)} /> {agentStateLabel(activity)}{#if since}{` · ${since}`}{/if}</p>
  </div>
  <div class="actions">
    <button type="button" onclick={() => onDirect(nodeId)}><MessageSquare size={13} />{m['chat.profile_direct']()}</button>
    <a href={`/canvas?${query}`}><Network size={13} />{m['workspace_view.canvas']()}</a>
    <a href={`/terminal?${query}`}><Focus size={13} />{m['node_quickbar.focus']()}</a>
  </div>
  <dl class="facts">
    {#if payload.provider}
      <dt>{m['chat.profile_provider']()}</dt>
      <dd>
        {#if providerIcons[payload.provider]}<span class="app-logo-plate mark"><img src={providerIcons[payload.provider]} width="12" height="12" alt="" /></span>{/if}
        {payload.provider}{#if model}{` · ${model}`}{/if}
      </dd>
    {/if}
    {#if status?.currentTask}
      <dt>{m['chat.profile_task']()}</dt>
      <dd>{status.currentTask.title}</dd>
    {/if}
    {#if agentActionLabel(status?.lastAction, status?.lastActionData)}
      <dt>{m['chat.profile_doing']()}</dt>
      <dd>{agentActionLabel(status?.lastAction, status?.lastActionData)}</dd>
    {/if}
    {#if status?.floorName}
      <dt>{m['chat.profile_floor']()}</dt>
      <dd>{status.floorName}</dd>
    {/if}
  </dl>
  <section>
    <h3><CalendarClock size={13} />{m['chat.profile_routines']()}</h3>
    {#if routines.length}
      <ul>
        {#each routines as routine (routine.id)}
          <li class="routine" class:off={!routine.enabled}>
            <b>{routine.name}</b>
            <span>{[routineCadence(routine), routineNextRun(routine), routine.runCount ? m['chat.routine_runs']({ count: routine.runCount }) : null].filter(Boolean).join(' · ')}</span>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="empty">{m['chat.profile_routines_empty']()}</p>
    {/if}
    <form class="routine-form" onsubmit={(event) => { event.preventDefault(); void askRoutine(); }}>
      <Input bind:value={routineDraft} placeholder={m['chat.routine_placeholder']()} aria-label={m['chat.routine_label']()} />
      <Button size="sm" type="submit" disabled={!routineDraft.trim() || routineSending}>{m['chat.routine_create']()}</Button>
    </form>
  </section>
  <AgentAlwaysOnPanel {workspaceId} {nodeId} {payload} />
  <section>
    <h3><Brain size={13} />{m['chat.profile_memory']()}</h3>
    {#if memory.length}
      <ul>
        {#each memory as entry (entry.id)}<li title={entry.content}><b>{entry.title}</b><span>{entry.content}</span></li>{/each}
      </ul>
    {:else}
      <p class="empty">{m['chat.profile_memory_empty']()}</p>
    {/if}
  </section>
</aside>

<style>
  .profile {
    width: 320px;
    flex: none;
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding: 12px 16px 20px;
    overflow-y: auto;
    border-left: 1px solid var(--app-border);
    background: var(--app-sidebar);
  }

  header {
    display: flex;
    justify-content: flex-end;
  }

  .close {
    width: 26px;
    height: 26px;
    display: grid;
    place-items: center;
    border: 0;
    border-radius: 7px;
    background: transparent;
    color: var(--app-text-muted);
    cursor: pointer;
  }

  .close:hover {
    background: var(--app-hover);
    color: var(--app-text);
  }

  .identity {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    text-align: center;
  }

  .identity h2 {
    margin: 6px 0 0;
    font-size: 26px;
    color: var(--app-text);
  }

  .role {
    margin: 0;
    color: var(--app-text-soft);
    font-size: 13px;
  }

  .status {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin: 0;
    color: var(--app-text-muted);
    font-size: 12px;
  }

  .actions {
    display: flex;
    justify-content: center;
    gap: 6px;
  }

  .actions button,
  .actions a {
    height: 30px;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 0 10px;
    border: 0;
    border-radius: 8px;
    background: var(--app-hover);
    color: var(--app-text);
    font: inherit;
    font-size: 12.5px;
    text-decoration: none;
    cursor: pointer;
  }

  .actions button:hover,
  .actions a:hover {
    background: var(--app-active);
  }

  .actions button:focus-visible,
  .actions a:focus-visible,
  .close:focus-visible {
    outline: 2px solid var(--app-accent);
    outline-offset: 2px;
  }

  .facts {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 6px 12px;
    margin: 0;
    font-size: 12.5px;
  }

  dt {
    color: var(--app-text-muted);
  }

  dd {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    margin: 0;
    color: var(--app-text);
    overflow-wrap: anywhere;
  }

  .mark {
    width: 18px;
    height: 18px;
    display: inline-grid;
    place-items: center;
    border-radius: 5px;
  }

  section h3 {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0 0 8px;
    color: var(--app-text-muted);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  ul {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  li {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 8px 10px;
    border-radius: 9px;
    background: var(--app-surface);
    box-shadow: inset 0 0 0 1px var(--app-border);
    font-size: 12.5px;
  }

  li b {
    color: var(--app-text);
    font-weight: 600;
  }

  li span {
    overflow: hidden;
    color: var(--app-text-soft);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
  }

  .routine.off b {
    color: var(--app-text-muted);
  }

  .routine-form {
    display: flex;
    gap: 6px;
    margin-top: 8px;
  }

  .empty {
    margin: 0;
    color: var(--app-text-muted);
    font-size: 12.5px;
  }
</style>
