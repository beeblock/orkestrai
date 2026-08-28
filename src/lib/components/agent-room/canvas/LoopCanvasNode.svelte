<script lang="ts">
  import type { NodeProps } from '@xyflow/svelte';
  import { Users, X as XIcon, Plus, Trash2, Play, Square, Repeat } from '@lucide/svelte';
  import NodeShell from './NodeShell.svelte';
  import IconAction from './IconAction.svelte';
  import HeaderIconButton from './HeaderIconButton.svelte';
  import type { TeamMember, TeamMemberRole, AgentProviderInfo } from '$lib/modules/agent-room/domain/types.js';
  import * as m from '$lib/paraglide/messages.js';

  export type LoopNodeData = {
    title: string;
    workspaceId: string;
    payload: { conversationId?: string; objective?: string };
    onDelete: (id: string) => void;
    onResize?: (id: string, params: { x: number; y: number; width: number; height: number }) => void;
    onPayloadChange?: (id: string, partial: Record<string, unknown>) => void;
  };

  type LogEntry = { kind: string; text: string };
  type LoopTask = { id: string; title: string; status: 'backlog' | 'in_progress' | 'testing' | 'done'; assigneeId?: string | null };

  let { id, data, selected } = $props<NodeProps & { data: LoopNodeData }>();

  let objective = $state(data.payload.objective ?? '');
  let maxRounds = $state(4);
  let allowWrites = $state(false);
  let running = $state(false);
  let teamOpen = $state(false);
  let teamMembers = $state<TeamMember[]>([]);
  let providers = $state<AgentProviderInfo[]>([]);
  let newMember = $state({ title: '', provider: 'claude', role: 'engineer' as TeamMemberRole, canWrite: true, systemPrompt: '' });
  let teamError = $state('');
  let log = $state<LogEntry[]>([]);
  let abortController: AbortController | null = null;
  let logEl: HTMLDivElement;
  let tasks = $state<LoopTask[]>([]);

  const KANBAN_COLUMNS: Array<{ status: LoopTask['status']; label: string }> = [
    { status: 'backlog', label: m['loop.col_backlog']() },
    { status: 'in_progress', label: m['loop.col_doing']() },
    { status: 'testing', label: m['loop.col_review']() },
    { status: 'done', label: m['loop.col_done']() },
  ];

  async function refreshTasks() {
    if (!data.payload.conversationId) return;
    try {
      tasks = await teamApi<LoopTask[]>(`/api/agent-room/conversations/${data.payload.conversationId}/tasks`);
    } catch {
      // conversa ainda nao existe
    }
  }

  function pushLog(kind: string, text: string) {
    log = [...log.slice(-300), { kind, text }];
    queueMicrotask(() => {
      if (logEl) logEl.scrollTop = logEl.scrollHeight;
    });
  }

  async function ensureConversation(): Promise<string> {
    if (data.payload.conversationId) return data.payload.conversationId;
    const response = await fetch('/api/agent-room/conversations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: m['loop.conversation_title']({ objective: (objective || 'time').slice(0, 40) }), mode: 'implement' }),
    });
    const payload = await response.json();
    if (!response.ok || payload.error) throw new Error(payload.error || m['loop.err_create_conversation']());
    data.onPayloadChange?.(id, { conversationId: payload.data.id });
    return payload.data.id;
  }

  async function runLoop() {
    if (!objective.trim() || running) return;
    running = true;
    log = [];
    abortController = new AbortController();
    pushLog('system', m['loop.log_starting']({ rounds: maxRounds, writes: allowWrites ? 'on' : 'off' }));

    try {
      const conversationId = await ensureConversation();
      await refreshTasks();
      const response = await fetch(`/api/agent-room/conversations/${conversationId}/loop/stream`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: objective, mode: 'implement', allowWrites, maxRounds }),
        signal: abortController.signal,
      });

      if (!response.ok || !response.body) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || m['loop.err_loop_http']({ status: response.status }));
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            handleEvent(JSON.parse(line));
          } catch {
            // linha parcial
          }
        }
      }
      pushLog('system', m['loop.log_finished']());
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        pushLog('system', m['loop.log_aborted']());
      } else {
        pushLog('error', error instanceof Error ? error.message : m['loop.err_loop']());
      }
    } finally {
      running = false;
      abortController = null;
    }
  }

  function handleEvent(event: Record<string, unknown>) {
    const type = String(event.type ?? '');
    switch (type) {
      case 'run_started':
        pushLog('agent', m['loop.log_agent_started']({ name: String(event.memberTitle ?? event.agent) }));
        break;
      case 'agent_output':
        pushLog('output', String(event.text ?? '').slice(0, 400));
        break;
      case 'run_finished':
        pushLog('agent', m['loop.log_agent_finished']({ name: String(event.memberTitle ?? event.agent), code: String(event.exitCode ?? '?') }));
        break;
      case 'round_started':
        pushLog('round', m['loop.log_round']({ round: String(event.round) }));
        break;
      case 'tasks_updated': {
        const updated = (event.tasks as LoopTask[] | undefined) ?? [];
        tasks = updated;
        pushLog('tasks', updated.map((task) => `[${task.status}] ${task.title}`).join(' | '));
        break;
      }
      case 'loop_finished':
        pushLog('system', m['loop.log_status']({ status: String(event.status ?? 'done') }));
        break;
      case 'error':
        pushLog('error', String(event.message ?? event.text ?? m['loop.log_error_fallback']()));
        break;
      case 'done':
        pushLog('system', m['loop.log_done']());
        break;
      default:
        if (event.text) pushLog('output', String(event.text).slice(0, 300));
    }
  }

  function stopLoop() {
    abortController?.abort();
  }

  async function teamApi<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(path, {
      ...init,
      headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    });
    const payload = await response.json();
    if (!response.ok || payload.error) throw new Error(payload.error || m['loop.err_api']());
    return payload.data as T;
  }

  async function openTeam() {
    teamError = '';
    teamOpen = !teamOpen;
    if (!teamOpen) return;
    try {
      if (providers.length === 0) {
        const status = await teamApi<{ providers: AgentProviderInfo[] }>('/api/agent-room/status');
        providers = status.providers ?? [];
      }
      const conversationId = await ensureConversation();
      teamMembers = await teamApi<TeamMember[]>(`/api/agent-room/conversations/${conversationId}/team`);
    } catch (error) {
      teamError = error instanceof Error ? error.message : m['loop.err_load_team']();
    }
  }

  async function addMember() {
    teamError = '';
    try {
      const conversationId = await ensureConversation();
      const member = await teamApi<TeamMember>(`/api/agent-room/conversations/${conversationId}/team`, {
        method: 'POST',
        body: JSON.stringify({
          title: newMember.title,
          provider: newMember.provider,
          role: newMember.role,
          canWrite: newMember.canWrite,
          participatesInLoop: true,
          systemPrompt: newMember.systemPrompt,
        }),
      });
      teamMembers = [...teamMembers, member];
      newMember = { title: '', provider: newMember.provider, role: 'engineer', canWrite: true, systemPrompt: '' };
    } catch (error) {
      teamError = error instanceof Error ? error.message : m['loop.err_add_member']();
    }
  }

  async function removeMember(member: TeamMember) {
    teamError = '';
    try {
      const conversationId = await ensureConversation();
      await teamApi(`/api/agent-room/conversations/${conversationId}/team/${member.id}`, { method: 'DELETE' });
      teamMembers = teamMembers.filter((item) => item.id !== member.id);
    } catch (error) {
      teamError = error instanceof Error ? error.message : m['loop.err_remove_member']();
    }
  }
</script>

<NodeShell
  {id}
  {selected}
  class="canvas-loop"
  accent="var(--app-success)"
  minWidth={380}
  minHeight={280}
  onResize={data.onResize}
  connections={data.connections ?? []}
  titleText={data.title}
  onRename={data.onRename}
  onJumpToNode={data.onJumpToNode}
  onRemoveConnection={data.onRemoveConnection}
>
  {#snippet icon()}<Repeat size={13} />{/snippet}
  {#snippet title()}{data.title || m['loop.title_default']()}{/snippet}
  {#snippet actions()}
    <HeaderIconButton label={m['loop.team_action']()} class="node-action-btn" side="top" active={teamOpen} onclick={openTeam}>
      <Users size={13} />
    </HeaderIconButton>
    {#if running}
      <IconAction label={m['loop.stop']()} danger onclick={stopLoop}><Square size={13} /></IconAction>
    {:else}
      <HeaderIconButton label={m['loop.run']()} class="node-action-btn" side="top" onclick={runLoop} disabled={!objective.trim()}>
        <span style="color:var(--app-success);display:inline-flex"><Play size={13} /></span>
      </HeaderIconButton>
    {/if}
    <IconAction label={m['loop.remove']()} danger onclick={() => data.onDelete(id)}><XIcon size={13} /></IconAction>
  {/snippet}

  <div class="loop-config nodrag">
    <textarea
      bind:value={objective}
      onchange={() => data.onPayloadChange?.(id, { objective })}
      placeholder={m['ph.loop_objective']()}
      rows="2"
      disabled={running}
    ></textarea>
    <div class="loop-options">
      <label>{m['loop.rounds']()} <input type="number" bind:value={maxRounds} min="1" max="12" disabled={running} /></label>
      <label class="checkbox"><input type="checkbox" bind:checked={allowWrites} disabled={running} /> full access</label>
    </div>
  </div>

  {#if teamOpen}
    <div class="team-panel nodrag nowheel">
      <p class="team-hint">{m['loop.team_hint']()}</p>
      {#each teamMembers as member (member.id)}
        <div class="member-row">
          <span class="member-title">{member.title}</span>
          <span class="member-meta">{member.provider} · {member.role}{member.canWrite ? ` · ${m['loop.member_writes']()}` : ''}</span>
          <IconAction label={m['loop.remove']()} danger onclick={() => removeMember(member)}>
            <Trash2 size={12} /></IconAction>
        </div>
      {/each}
      <form class="member-form" onsubmit={(event) => { event.preventDefault(); addMember(); }}>
        <input bind:value={newMember.title} placeholder={m['ph.loop_member_title']()} required />
        <div class="member-form-row">
          <select bind:value={newMember.provider}>
            {#each providers as provider}
              <option value={provider.id} disabled={!provider.installed}>{provider.displayName}</option>
            {/each}
          </select>
          <select bind:value={newMember.role}>
            <option value="leader">{m['loop.role_leader']()}</option>
            <option value="engineer">{m['loop.role_engineer']()}</option>
            <option value="tester">{m['loop.role_tester']()}</option>
            <option value="designer">{m['loop.role_designer']()}</option>
            <option value="documenter">{m['loop.role_documenter']()}</option>
            <option value="custom">{m['loop.role_custom']()}</option>
          </select>
        </div>
        <textarea bind:value={newMember.systemPrompt} placeholder={m['ph.loop_member_prompt']()} rows="2"></textarea>
        <label class="checkbox">
          <input type="checkbox" bind:checked={newMember.canWrite} />
          {m['loop.can_write']()}
        </label>
        <button type="submit" class="add-member"><Plus size={12} /> {m['loop.add_member']()}</button>
      </form>
      {#if teamError}
        <p class="team-error">{teamError}</p>
      {/if}
    </div>
  {/if}

  {#if tasks.length}
    <div class="kanban nodrag">
      {#each KANBAN_COLUMNS as column}
        <div class="kanban-column">
          <span class="kanban-label">{column.label}</span>
          {#each tasks.filter((task) => task.status === column.status) as task (task.id)}
            <span class="kanban-card">{task.title}</span>
          {/each}
        </div>
      {/each}
    </div>
  {/if}

  <div class="loop-log nodrag nowheel" bind:this={logEl}>
    {#each log as entry, index (index)}
      <p class={`log-${entry.kind}`}>{entry.text}</p>
    {/each}
    {#if log.length === 0}
      <p class="log-empty">{m['loop.log_empty']()}</p>
    {/if}
  </div>
</NodeShell>

<style>
  .canvas-loop {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    border: 1px solid var(--app-border);
    border-radius: 10px;
    background: var(--app-canvas);
    overflow: hidden;
  }

  .canvas-loop.selected {
    border-color: var(--app-accent);
  }

  .loop-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 5px 10px;
    background: var(--app-surface);
    font-size: 12px;
    color: var(--app-text);
    cursor: grab;
  }

  .header-actions {
    display: flex;
    gap: 2px;
  }

  .icon-btn {
    border: none;
    background: transparent;
    color: var(--app-text-muted);
    cursor: pointer;
    font-size: 13px;
    padding: 1px 4px;
  }

  .icon-btn.run {
    color: var(--app-success);
  }

  .icon-btn.stop {
    color: var(--app-danger);
  }

  .icon-btn.danger:hover {
    color: var(--app-danger);
  }

  .icon-btn:disabled {
    opacity: 0.3;
    cursor: default;
  }

  .loop-config {
    padding: 6px 8px;
    border-bottom: 1px solid var(--app-surface-raised);
    display: flex;
    flex-direction: column;
    gap: 5px;
  }

  .loop-config textarea {
    resize: none;
    border: 1px solid var(--app-border);
    border-radius: 6px;
    background: var(--app-canvas);
    color: var(--app-text);
    font-size: 12px;
    padding: 6px;
    font-family: inherit;
  }

  .loop-options {
    display: flex;
    gap: 12px;
    font-size: 11px;
    color: var(--app-text-muted);
  }

  .loop-options input[type='number'] {
    width: 48px;
    background: var(--app-canvas);
    border: 1px solid var(--app-border);
    border-radius: 5px;
    color: var(--app-text);
    padding: 2px 5px;
  }

  .checkbox {
    display: flex;
    align-items: center;
    gap: 5px;
  }

  .loop-log {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 6px 8px;
    font-family: ui-monospace, monospace;
    font-size: 11px;
    line-height: 1.5;
  }

  .loop-log p {
    margin: 0 0 2px;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .log-agent {
    color: var(--app-secondary);
  }

  .log-round {
    color: var(--app-warning);
    font-weight: 600;
  }

  .log-tasks {
    color: var(--app-text-muted);
  }

  .log-output {
    color: var(--app-text-soft);
  }

  .log-error {
    color: var(--app-danger);
  }

  .log-system {
    color: var(--app-success);
  }

  .log-empty {
    color: var(--app-text-muted);
  }

  .kanban {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 4px;
    padding: 6px 8px;
    border-bottom: 1px solid var(--app-surface-raised);
  }

  .kanban-column {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }

  .kanban-label {
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--app-text-muted);
  }

  .kanban-card {
    font-size: 10px;
    padding: 4px 6px;
    border-radius: 6px;
    background: var(--app-border);
    color: var(--app-text-soft);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .team-panel {
    max-height: 240px;
    overflow-y: auto;
    padding: 8px;
    border-bottom: 1px solid var(--app-surface-raised);
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .team-hint {
    margin: 0;
    font-size: 10px;
    color: var(--app-text-muted);
    line-height: 1.4;
  }

  .member-row {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    padding: 4px 6px;
    border-radius: 6px;
    background: color-mix(in srgb, var(--app-surface-raised) 55%, transparent);
  }

  .member-title {
    font-weight: 600;
    color: var(--app-text);
  }

  .member-meta {
    flex: 1;
    color: var(--app-text-muted);
    font-size: 10px;
  }

  .member-form {
    display: flex;
    flex-direction: column;
    gap: 5px;
    border-top: 1px solid var(--app-surface-raised);
    padding-top: 6px;
  }

  .member-form input,
  .member-form select,
  .member-form textarea {
    padding: 5px 7px;
    border-radius: 6px;
    border: 1px solid var(--app-border);
    background: var(--app-canvas);
    color: var(--app-text);
    font-size: 11px;
    font-family: inherit;
  }

  .member-form-row {
    display: flex;
    gap: 5px;
  }

  .member-form-row select {
    flex: 1;
  }

  .add-member {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    padding: 6px;
    border: none;
    border-radius: 6px;
    background: var(--app-accent);
    color: var(--app-accent-contrast);
    font-size: 11px;
    cursor: pointer;
  }

  .team-error {
    margin: 0;
    font-size: 10px;
    color: var(--app-danger);
  }
</style>
