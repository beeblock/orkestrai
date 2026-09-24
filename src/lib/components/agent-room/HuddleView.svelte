<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { toast } from '@beeblock/svelar/ui';
  import { getCsrfToken } from '@beeblock/svelar/http';
  import {
    CircleAlert,
    CircleStop,
    Crown,
    History,
    Link2,
    ListPlus,
    LoaderCircle,
    MessageCircleMore,
    Mic,
    Plus,
    Radio,
    RefreshCw,
    Send,
    Users,
    Volume2,
    VolumeX,
    X,
  } from '@lucide/svelte';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Textarea } from '$lib/components/ui/textarea';
  import { Checkbox } from '$lib/components/ui/checkbox';
  import { Switch } from '$lib/components/ui/switch';
  import * as Tooltip from '$lib/components/ui/tooltip';
  import NodeEmptyState from './canvas/NodeEmptyState.svelte';
  import { TEXT_DICTATION_COMMAND } from './text-dictation.js';
  import { speakText } from './voice-speech.js';
  import { appSettingsStore } from './app-settings.svelte.js';
  import type { CanvasNode, WorkspaceHuddle, WorkspaceHuddleSnapshot } from '$lib/modules/agent-room/domain/types.js';
  import * as m from '$lib/paraglide/messages.js';

  let { workspaceId, onClose }: { workspaceId: string; onClose?: () => void } = $props();
  let snapshot = $state<WorkspaceHuddleSnapshot | null>(null);
  let agents = $state<CanvasNode[]>([]);
  let selectedId = $state<string | null>(null);
  let loading = $state(true);
  let busy = $state(false);
  let error = $state('');
  let title = $state('');
  let agenda = $state('');
  let selectedAgents = $state<string[]>([]);
  let facilitatorNodeId = $state<string | null>(null);
  let message = $state('');
  let targets = $state<string[]>([]);
  let speakReplies = $state(false);
  let composer = $state<HTMLTextAreaElement | null>(null);
  let knownCompleted = new Set<string>();
  let speechInitialized = false;
  let speechHuddleId: string | null = null;
  let refreshTimer: ReturnType<typeof setTimeout> | null = null;
  const selected = $derived(snapshot?.selected ?? null);
  const participants = $derived(selected?.participants.filter((item) => item.kind === 'agent' && !item.leftAt) ?? []);

  function errorMessage(code: unknown): string {
    if (code === 'HUDDLE_ALREADY_ACTIVE') return m['huddle.error_already_active']();
    if (code === 'HUDDLE_PARTICIPANT_LIMIT') return m['huddle.error_participant_limit']();
    if (code === 'HUDDLE_ENDED') return m['huddle.error_ended']();
    if (
      code === 'HUDDLE_AGENT_NOT_FOUND' ||
      code === 'HUDDLE_TARGET_NOT_PARTICIPANT' ||
      code === 'HUDDLE_AGENT_NOT_PARTICIPANT' ||
      code === 'HUDDLE_FACILITATOR_NOT_FOUND'
    )
      return m['huddle.error_participant_unavailable']();
    return m['huddle.generic_error']();
  }

  async function api<T>(path: string, init?: RequestInit): Promise<T> {
    const csrf = getCsrfToken();
    const response = await fetch(path, {
      cache: 'no-store',
      ...init,
      headers: {
        ...(init?.body ? { 'content-type': 'application/json' } : {}),
        ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
        ...init?.headers,
      },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(errorMessage(payload.error));
    return payload.data;
  }

  async function load(silent = false): Promise<void> {
    if (!silent) loading = true;
    try {
      const query = selectedId ? `?selected=${encodeURIComponent(selectedId)}` : '';
      const next = await api<WorkspaceHuddleSnapshot>(`/api/agent-room/workspaces/${workspaceId}/huddles${query}`);
      selectedId = next.selected?.id ?? null;
      snapshot = next;
      const completed = next.selected?.turns.filter((turn) => turn.state === 'completed' && turn.speakerKind === 'agent') ?? [];
      const sameSpeechSession = speechHuddleId === (next.selected?.id ?? null);
      if (speakReplies && speechInitialized && sameSpeechSession) {
        for (const turn of completed) if (!knownCompleted.has(turn.id)) void speakText(turn.text, appSettingsStore.values.audioOutputDeviceId);
      }
      knownCompleted = new Set(completed.map((turn) => turn.id));
      speechInitialized = true;
      speechHuddleId = next.selected?.id ?? null;
      error = '';
    } catch (cause) {
      error = cause instanceof Error ? cause.message : m['huddle.load_error']();
    } finally {
      if (!silent) loading = false;
    }
  }

  async function loadAgents(): Promise<void> {
    try {
      const nodes = await api<CanvasNode[]>(`/api/agent-room/workspaces/${workspaceId}/nodes`);
      agents = nodes.filter((node) => node.type === 'terminal' && Boolean((node.payload as { provider?: string }).provider));
      const leader = agents.find((node) => {
        const payload = node.payload as {
          maestro?: boolean;
          isMaestro?: boolean;
        };
        return Boolean(payload.maestro || payload.isMaestro);
      });
      if (leader && !facilitatorNodeId) facilitatorNodeId = leader.id;
    } catch {
      /* huddle remains usable from history */
    }
  }

  function toggleSelected(id: string, checked: boolean): void {
    selectedAgents = checked ? [...new Set([...selectedAgents, id])] : selectedAgents.filter((item) => item !== id);
    if (!selectedAgents.includes(facilitatorNodeId ?? '')) facilitatorNodeId = selectedAgents[0] ?? null;
  }

  function toggleTarget(id: string, checked: boolean): void {
    targets = checked ? [...new Set([...targets, id])].slice(0, 5) : targets.filter((item) => item !== id);
  }

  async function start(): Promise<void> {
    if (!title.trim() || !selectedAgents.length) return;
    busy = true;
    try {
      const huddle = await api<WorkspaceHuddle>(`/api/agent-room/workspaces/${workspaceId}/huddles`, {
        method: 'POST',
        body: JSON.stringify({
          title,
          agenda: agenda.trim() || null,
          agentNodeIds: selectedAgents,
          facilitatorNodeId,
        }),
      });
      selectedId = huddle.id;
      targets = huddle.participants
        .filter((item) => item.kind === 'agent')
        .map((item) => item.participantId)
        .slice(0, 5);
      title = '';
      agenda = '';
      selectedAgents = [];
      await load();
      toast.success(m['huddle.started']());
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : m['huddle.generic_error']());
    } finally {
      busy = false;
    }
  }

  async function send(): Promise<void> {
    if (!selected || !message.trim() || !targets.length || busy) return;
    busy = true;
    const body = message.trim();
    message = '';
    try {
      await api(`/api/agent-room/workspaces/${workspaceId}/huddles/${selected.id}/turns`, {
        method: 'POST',
        body: JSON.stringify({ text: body, targetNodeIds: targets }),
      });
      await load(true);
    } catch (cause) {
      message = body;
      toast.error(cause instanceof Error ? cause.message : m['huddle.generic_error']());
    } finally {
      busy = false;
    }
  }

  async function end(): Promise<void> {
    if (!selected || busy) return;
    busy = true;
    try {
      await api(`/api/agent-room/workspaces/${workspaceId}/huddles/${selected.id}`, { method: 'PATCH', body: JSON.stringify({ operation: 'end' }) });
      await load();
      toast.success(m['huddle.ended']());
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : m['huddle.generic_error']());
    } finally {
      busy = false;
    }
  }

  async function createTask(): Promise<void> {
    if (!selected || selected.linkedTaskId || busy) return;
    busy = true;
    try {
      await api(`/api/agent-room/workspaces/${workspaceId}/huddles/${selected.id}/task`, {
        method: 'POST',
        body: JSON.stringify({ title: selected.title }),
      });
      await load(true);
      toast.success(m['huddle.task_created']());
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : m['huddle.generic_error']());
    } finally {
      busy = false;
    }
  }

  async function dictate(): Promise<void> {
    composer?.focus();
    await tick();
    window.dispatchEvent(new Event(TEXT_DICTATION_COMMAND));
  }

  function scheduleRefresh(): void {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => void load(true), 150);
  }

  onMount(() => {
    void Promise.all([load(), loadAgents()]);
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
    const socket = new WebSocket(`${protocol}://${location.host}/ws/agent-room/pty`);
    socket.onmessage = (event) => {
      try {
        const frame = JSON.parse(String(event.data));
        if (frame.type === 'huddleChanged' && frame.workspaceId === workspaceId) scheduleRefresh();
      } catch {}
    };
    return () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      socket.close();
    };
  });
</script>

<section class="flex h-full min-h-0 flex-col bg-[var(--app-canvas)] text-[var(--app-text)]" data-testid="huddle-view">
  <header class="flex shrink-0 items-start gap-3 border-b border-[var(--app-border)] bg-[var(--app-surface)] px-5 py-4">
    <span class="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-[var(--app-accent-soft)] text-[var(--app-accent)]" aria-hidden="true"><Radio size={17} /></span>
    <div class="min-w-0 flex-1">
      <div class="flex min-w-0 items-center gap-2">
        <h1 class="truncate font-display text-[15px] font-semibold tracking-[-0.01em]">{m['huddle.title']()}</h1>
        {#if snapshot?.activeHuddleId}<span class="live-chip"><span class="live-dot" aria-hidden="true"></span>{m['huddle.live']()}</span>{/if}
      </div>
      <p class="mt-0.5 truncate text-ui-sm text-[var(--app-text-muted)]" title={m['huddle.description']()}>{m['huddle.description']()}</p>
    </div>
    <div class="flex shrink-0 items-center gap-1">
      <Tooltip.Root>
        <Tooltip.Trigger>
          {#snippet child({ props })}
            <Button {...props} variant="ghost" size="icon-sm" aria-label={m['huddle.refresh']()} onclick={() => void load()}><RefreshCw size={14} class={loading ? 'animate-spin' : ''} /></Button>
          {/snippet}
        </Tooltip.Trigger>
        <Tooltip.Content>{m['huddle.refresh']()}</Tooltip.Content>
      </Tooltip.Root>
      {#if onClose}
        <Button variant="ghost" size="icon-sm" aria-label={m['huddle.close']()} onclick={onClose}><X size={15} /></Button>
      {/if}
    </div>
  </header>
  {#if error}
    <div class="mx-5 mt-3 flex shrink-0 items-start gap-2 rounded-lg bg-[var(--app-danger-soft)] px-3 py-2 text-ui-sm text-[var(--app-text)]" role="alert">
      <CircleAlert size={14} class="mt-0.5 shrink-0 text-[var(--app-danger)]" aria-hidden="true" />
      <span class="min-w-0 flex-1 break-words">{error}</span>
    </div>
  {/if}
  <div class="grid min-h-0 flex-1 grid-cols-1 grid-rows-[auto_minmax(0,1fr)] md:grid-cols-[240px_minmax(0,1fr)] md:grid-rows-1 xl:grid-cols-[280px_minmax(0,1fr)]">
    <aside class="max-h-36 min-h-0 overflow-y-auto border-b border-[var(--app-border)] p-2 md:max-h-none md:border-b-0 md:border-r">
      <div class="mb-1 flex h-8 items-center justify-between gap-2 pl-2">
        <span class="section-label flex items-center gap-1.5"><History size={12} aria-hidden="true" />{m['huddle.history']()}</span>
        {#if !snapshot?.activeHuddleId}
          <Tooltip.Root>
            <Tooltip.Trigger>
              {#snippet child({ props })}
                <Button {...props} size="icon-sm" variant="ghost" aria-label={m['huddle.new']()} onclick={() => ((selectedId = null), (snapshot = snapshot ? { ...snapshot, selected: null } : snapshot))}><Plus size={14} /></Button>
              {/snippet}
            </Tooltip.Trigger>
            <Tooltip.Content>{m['huddle.new']()}</Tooltip.Content>
          </Tooltip.Root>
        {/if}
      </div>
      {#each snapshot?.huddles ?? [] as huddle (huddle.id)}
        <button
          type="button"
          class="hub-row"
          class:selected={selected?.id === huddle.id}
          aria-current={selected?.id === huddle.id ? 'true' : undefined}
          onclick={() => {
            selectedId = huddle.id;
            void load();
          }}
        >
          <span class="block truncate text-ui-md font-semibold text-[var(--app-text)]">{huddle.title}</span>
          <span class="mt-1 flex items-center justify-between gap-2 text-ui-sm text-[var(--app-text-muted)]">
            <span class="flex items-center gap-1 tabular-nums"><Users size={11} aria-hidden="true" />{huddle.participantCount} {m['huddle.people']()}</span>
            <span class="status-chip" class:live={huddle.status === 'active'}>{huddle.status === 'active' ? m['huddle.live']() : m['huddle.finished']()}</span>
          </span>
        </button>
      {:else}
        <p class="px-2 py-3 text-pretty text-ui-sm leading-5 text-[var(--app-text-muted)]">{m['huddle.history_empty']()}</p>
      {/each}
    </aside>
    {#if loading && !snapshot}
      <div class="grid place-items-center">
        <span class="inline-flex items-center gap-2 rounded-full bg-[var(--app-surface)] px-3 py-1.5 text-ui-sm text-[var(--app-text-muted)] shadow-border" role="status">
          <LoaderCircle size={13} class="animate-spin text-[var(--app-accent)]" aria-hidden="true" />{m['creative.loading']()}
        </span>
      </div>
    {:else if !selected}
      <div class="min-h-0 overflow-y-auto px-6 py-6">
        <div class="mx-auto max-w-2xl">
          <h2 class="text-balance font-display text-[15px] font-semibold">{m['huddle.start_title']()}</h2>
          <p class="mt-1 text-pretty text-ui-sm leading-5 text-[var(--app-text-muted)]">{m['huddle.start_hint']()}</p>
          <div class="mt-5 space-y-4">
            <label class="block"
              ><span class="mb-1.5 block text-ui-md font-medium">{m['huddle.topic']()}</span><Input
                bind:value={title}
                maxlength={160}
                placeholder={m['huddle.topic_placeholder']()}
              /></label
            ><label class="block"
              ><span class="mb-1.5 block text-ui-md font-medium">{m['huddle.agenda']()}</span><Textarea
                bind:value={agenda}
                maxlength={8000}
                class="min-h-24 resize-y"
                placeholder={m['huddle.agenda_placeholder']()}
              /></label
            >
          </div>
          <section class="mt-6">
            <div class="mb-2 flex items-center justify-between">
              <h3 class="text-ui-md font-medium">{m['huddle.choose_agents']()}</h3>
              <span class="rounded-md bg-[var(--app-hover)] px-1.5 font-mono text-[10.5px] leading-5 tabular-nums text-[var(--app-text-soft)]">{selectedAgents.length}/11</span>
            </div>
            {#if agents.length}
              <div class="overflow-hidden rounded-lg bg-[var(--app-surface)] shadow-border">
                {#each agents as agent (agent.id)}
                  {@const chosen = selectedAgents.includes(agent.id)}
                  <label class="agent-row" class:chosen
                    ><Checkbox
                      checked={chosen}
                      disabled={!chosen && selectedAgents.length >= 11}
                      onCheckedChange={(value: boolean | 'indeterminate') => toggleSelected(agent.id, value === true)}
                    /><span class="min-w-0 flex-1"
                      ><span class="block truncate text-ui-md font-medium text-[var(--app-text)]">{agent.title}</span><span
                        class="block truncate text-ui-sm text-[var(--app-text-muted)]"
                        ><span class="capitalize">{(agent.payload as { provider?: string; role?: string }).provider}</span>{(agent.payload as { role?: string }).role
                          ? ` · ${(agent.payload as { role?: string }).role}`
                          : ''}</span
                      ></span
                    >{#if chosen}<button
                        type="button"
                        class="facilitator-toggle"
                        class:active={facilitatorNodeId === agent.id}
                        aria-pressed={facilitatorNodeId === agent.id}
                        onclick={(event) => {
                          event.preventDefault();
                          facilitatorNodeId = agent.id;
                        }}
                        ><Crown size={12} aria-hidden="true" />{facilitatorNodeId === agent.id ? m['huddle.facilitator']() : m['huddle.make_facilitator']()}</button
                      >{/if}</label
                  >
                {/each}
              </div>
            {:else}
              <div class="rounded-lg bg-[var(--app-surface)] shadow-border">
                <NodeEmptyState compact icon={Users} title={m['control_center.no_agents']()} description={m['huddle.no_agents_hint']()} />
              </div>
            {/if}
          </section>
          <div class="mt-6 flex justify-end">
            <Button disabled={busy || !title.trim() || !selectedAgents.length} onclick={() => void start()}
              >{#if busy}<LoaderCircle class="animate-spin" />{:else}<Radio />{/if}{m['huddle.start']()}</Button
            >
          </div>
        </div>
      </div>
    {:else}
      <div class="flex min-h-0 flex-col">
        <div class="flex shrink-0 flex-wrap items-start justify-between gap-3 border-b border-[var(--app-border)] px-6 py-3.5">
          <div class="min-w-0">
            <div class="flex min-w-0 flex-wrap items-center gap-2">
              <h2 class="truncate font-display text-[15px] font-semibold">{selected.title}</h2>
              <span class="status-chip" class:live={selected.status === 'active'}>{selected.status === 'active' ? m['huddle.live']() : m['huddle.finished']()}</span>
              {#if selected.linkedTaskId}<span class="status-chip inline-flex items-center gap-1"><Link2 size={11} aria-hidden="true" />{m['huddle.task_linked']()}</span>{/if}
            </div>
            {#if selected.agenda}<p class="mt-1 max-w-3xl text-pretty text-ui-sm leading-5 text-[var(--app-text-muted)]">
                {selected.agenda}
              </p>{/if}
          </div>
          <div class="flex items-center gap-1.5">
            {#if !selected.linkedTaskId}<Button variant="outline" size="sm" onclick={() => void createTask()}
                ><ListPlus size={13} />{m['huddle.create_task']()}</Button
              >{/if}{#if selected.status === 'active'}<Button variant="ghost" size="sm" onclick={() => void end()}
                ><CircleStop size={13} class="text-[var(--app-danger)]" />{m['huddle.end']()}</Button
              >{/if}
          </div>
        </div>
        <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-5">
          <div class="mx-auto max-w-3xl space-y-4">
            {#each selected.turns as turn (turn.id)}<article class="turn" class:human={turn.speakerKind !== 'agent'}>
                <span class="turn-avatar" aria-hidden="true">{turn.speakerName.slice(0, 1).toUpperCase()}</span>
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-2">
                    <strong class="truncate text-ui-md font-semibold">{turn.speakerName}</strong><span class="font-mono text-[10.5px] tabular-nums text-[var(--app-text-muted)]">#{turn.sequence}</span
                    >{#if turn.state === 'pending'}<LoaderCircle size={12} class="animate-spin text-[var(--app-accent)]" />{:else if turn.state === 'failed'}<span
                        class="inline-flex items-center gap-1 text-ui-sm text-[var(--app-danger)]"><CircleAlert size={12} aria-hidden="true" />{m['huddle.reply_failed']()}</span
                      >{/if}
                  </div>
                  {#if turn.text}<p class="mt-1 whitespace-pre-wrap break-words text-ui-lg leading-6 text-[var(--app-text-soft)]">
                      {turn.text}
                    </p>{/if}
                </div>
              </article>{:else}<div class="grid min-h-48">
                <NodeEmptyState compact icon={MessageCircleMore} title={m['huddle.transcript_empty']()} />
              </div>{/each}
          </div>
        </div>
        {#if selected.status === 'active'}<footer class="shrink-0 border-t border-[var(--app-border)] bg-[var(--app-surface)] px-6 py-3">
            <div class="mx-auto max-w-3xl">
              <div class="mb-2.5 flex flex-wrap items-center gap-1.5">
                <span class="section-label mr-1 flex items-center gap-1"
                  ><Users size={11} aria-hidden="true" />{m['huddle.ask']()}</span
                >{#each participants as participant (participant.id)}<label
                    class="target-chip"
                    ><Checkbox
                      class="size-3.5"
                      checked={targets.includes(participant.participantId)}
                      disabled={!targets.includes(participant.participantId) && targets.length >= 5}
                      onCheckedChange={(value: boolean | 'indeterminate') => toggleTarget(participant.participantId, value === true)}
                    />{participant.displayName}</label
                  >{/each}<label class="ml-auto flex cursor-pointer items-center gap-2 text-ui-sm text-[var(--app-text-muted)]"
                  ><Switch checked={speakReplies} onCheckedChange={(value: boolean) => (speakReplies = value)} />{#if speakReplies}<Volume2
                      size={13}
                      aria-hidden="true"
                    />{:else}<VolumeX size={13} aria-hidden="true" />{/if}{m['huddle.speak_replies']()}</label
                >
              </div>
              <div class="flex items-end gap-2">
                <Textarea
                  bind:ref={composer}
                  bind:value={message}
                  class="min-h-16 max-h-36 resize-y text-ui-lg"
                  placeholder={m['huddle.message_placeholder']()}
                  onkeydown={(event: KeyboardEvent) => {
                    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                      event.preventDefault();
                      void send();
                    }
                  }}
                /><Tooltip.Root>
                  <Tooltip.Trigger>
                    {#snippet child({ props })}
                      <Button {...props} variant="outline" size="icon-lg" class="shrink-0" aria-label={m['huddle.dictate']()} onclick={() => void dictate()}><Mic size={15} /></Button>
                    {/snippet}
                  </Tooltip.Trigger>
                  <Tooltip.Content>{m['huddle.dictate']()}</Tooltip.Content>
                </Tooltip.Root><Tooltip.Root>
                  <Tooltip.Trigger>
                    {#snippet child({ props })}
                      <Button
                        {...props}
                        size="icon-lg"
                        class="shrink-0"
                        disabled={busy || !message.trim() || !targets.length}
                        aria-label={m['huddle.send']()}
                        onclick={() => void send()}
                        >{#if busy}<LoaderCircle size={15} class="animate-spin" />{:else}<Send size={15} />{/if}</Button
                      >
                    {/snippet}
                  </Tooltip.Trigger>
                  <Tooltip.Content>{m['huddle.send']()}</Tooltip.Content>
                </Tooltip.Root>
              </div>
            </div>
          </footer>{/if}
      </div>
    {/if}
  </div>
</section>

<style>
  /* Linha do historico: selecao neutra com indicador de acento, como no Workbench. */
  .hub-row {
    position: relative;
    display: block;
    width: 100%;
    margin-bottom: 2px;
    padding: 9px 10px 9px 12px;
    border: 0;
    border-radius: 8px;
    background: transparent;
    text-align: left;
    cursor: pointer;
    transition: background-color var(--duration-quick) ease-out;
  }

  .hub-row:hover {
    background: var(--app-hover);
  }

  .hub-row.selected {
    background: var(--app-active);
  }

  .hub-row.selected::before {
    content: '';
    position: absolute;
    left: 0;
    top: 10px;
    bottom: 10px;
    width: 2px;
    border-radius: 0 2px 2px 0;
    background: var(--app-accent);
  }

  .hub-row:focus-visible {
    outline: 2px solid var(--app-accent);
    outline-offset: -2px;
  }

  .status-chip {
    flex-shrink: 0;
    padding: 1px 6px;
    border-radius: 5px;
    background: var(--app-hover);
    color: var(--app-text-soft);
    font-size: 11px;
    font-weight: 500;
    line-height: 16px;
    white-space: nowrap;
  }

  .status-chip.live {
    background: var(--app-success-soft);
    color: var(--app-success);
  }

  .live-chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 1px 7px;
    border-radius: 999px;
    background: var(--app-success-soft);
    color: var(--app-success);
    font-size: 11px;
    font-weight: 600;
    line-height: 16px;
  }

  .live-dot {
    width: 6px;
    height: 6px;
    border-radius: 999px;
    background: currentColor;
  }

  @media (prefers-reduced-motion: no-preference) {
    .live-dot {
      animation: live-pulse 1.6s ease-in-out infinite;
    }
  }

  @keyframes live-pulse {
    50% {
      opacity: 0.35;
    }
  }

  /* Participante: a linha inteira alterna o checkbox; facilitador vira um chip. */
  .agent-row {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 52px;
    padding: 8px 12px;
    cursor: pointer;
    transition: background-color var(--duration-quick) ease-out;
  }

  .agent-row + .agent-row {
    box-shadow: inset 0 1px 0 var(--app-border);
  }

  .agent-row:hover {
    background: var(--app-hover);
  }

  .facilitator-toggle {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 26px;
    padding: 0 9px;
    border: 0;
    border-radius: 999px;
    background: transparent;
    color: var(--app-text-muted);
    font-size: 11.5px;
    font-weight: 500;
    cursor: pointer;
    transition: background-color var(--duration-quick) ease-out, color var(--duration-quick) ease-out, transform var(--duration-quick) var(--ease-smooth-out);
  }

  .facilitator-toggle:hover {
    background: var(--app-active);
    color: var(--app-text);
  }

  .facilitator-toggle:active {
    transform: scale(var(--scale-press));
  }

  .facilitator-toggle.active {
    background: var(--app-accent-soft);
    color: var(--app-accent);
  }

  .facilitator-toggle:focus-visible {
    outline: 2px solid var(--app-accent);
    outline-offset: 2px;
  }

  .turn {
    display: flex;
    gap: 12px;
  }

  .turn-avatar {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    flex-shrink: 0;
    border-radius: 999px;
    background: var(--app-hover);
    color: var(--app-text-soft);
    font-size: 12px;
    font-weight: 600;
  }

  .turn.human .turn-avatar {
    background: var(--app-accent-soft);
    color: var(--app-accent);
  }

  .target-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 28px;
    padding: 0 10px 0 8px;
    border-radius: 999px;
    box-shadow: var(--app-shadow-border);
    color: var(--app-text-soft);
    font-size: 12px;
    cursor: pointer;
    transition: background-color var(--duration-quick) ease-out, color var(--duration-quick) ease-out;
  }

  .target-chip:hover {
    background: var(--app-hover);
    color: var(--app-text);
  }

  .target-chip:has([data-state='checked']) {
    background: var(--app-active);
    color: var(--app-text);
  }
</style>
