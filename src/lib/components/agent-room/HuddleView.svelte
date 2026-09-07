<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { toast } from '@beeblock/svelar/ui';
  import { getCsrfToken } from '@beeblock/svelar/http';
  import {
    Check,
    CircleStop,
    History,
    Link2,
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
  import { Badge } from '$lib/components/ui/badge';
  import { Switch } from '$lib/components/ui/switch';
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
  <header class="flex shrink-0 items-start justify-between gap-4 border-b border-[var(--app-border)] px-5 py-4">
    <div>
      <div class="flex items-center gap-2">
        <Radio size={17} class="text-[var(--app-accent)]" />
        <h1 class="text-[14px] font-semibold">{m['huddle.title']()}</h1>
        {#if snapshot?.activeHuddleId}<Badge variant="secondary">{m['huddle.live']()}</Badge>{/if}
      </div>
      <p class="mt-1 max-w-2xl text-ui-xs leading-4 text-[var(--app-text-muted)]">
        {m['huddle.description']()}
      </p>
    </div>
    <div class="flex shrink-0 items-center gap-1">
      <Button variant="ghost" size="icon" class="size-8" aria-label={m['huddle.refresh']()} onclick={() => void load()}
        ><RefreshCw size={14} class={loading ? 'animate-spin' : ''} /></Button
      >
      {#if onClose}
        <Button variant="ghost" size="icon" class="size-8" aria-label={m['huddle.close']()} onclick={onClose}>
          <X size={15} />
        </Button>
      {/if}
    </div>
  </header>
  {#if error}<div class="m-4 border-l-2 border-[var(--app-danger)] p-3 text-ui-xs text-[var(--app-danger)]">
      {error}
    </div>{/if}
  <div class="grid min-h-0 flex-1 grid-cols-1 grid-rows-[auto_minmax(0,1fr)] md:grid-cols-[240px_minmax(0,1fr)] md:grid-rows-1 xl:grid-cols-[280px_minmax(0,1fr)]">
    <aside class="max-h-36 min-h-0 overflow-y-auto border-b border-[var(--app-border)] p-2 md:max-h-none md:border-r md:border-b-0">
      <div class="mb-2 flex items-center justify-between px-2">
        <span class="flex items-center gap-1.5 text-ui-xs font-semibold uppercase text-[var(--app-text-muted)]"
          ><History size={11} />{m['huddle.history']()}</span
        >{#if !snapshot?.activeHuddleId}<Button
            size="icon"
            variant="ghost"
            class="size-7"
            aria-label={m['huddle.new']()}
            onclick={() => ((selectedId = null), (snapshot = snapshot ? { ...snapshot, selected: null } : snapshot))}><Plus size={13} /></Button
          >{/if}
      </div>
      {#each snapshot?.huddles ?? [] as huddle (huddle.id)}<button
          type="button"
          class="mb-1 w-full rounded-md px-2 py-2 text-left hover:bg-[var(--app-surface)]"
          class:bg-[var(--app-accent-soft)]={selected?.id === huddle.id}
          onclick={() => {
            selectedId = huddle.id;
            void load();
          }}
          ><span class="block truncate text-ui-xs font-medium">{huddle.title}</span><span
            class="mt-1 flex justify-between text-ui-xs text-[var(--app-text-muted)]"
            ><span>{huddle.participantCount} {m['huddle.people']()}</span><span>{huddle.status === 'active' ? m['huddle.live']() : m['huddle.finished']()}</span
            ></span
          ></button
        >{:else}<p class="px-2 py-4 text-ui-xs leading-4 text-[var(--app-text-muted)]">
          {m['huddle.history_empty']()}
        </p>{/each}
    </aside>
    {#if loading && !snapshot}<div class="grid place-items-center">
        <LoaderCircle size={18} class="animate-spin text-[var(--app-accent)]" />
      </div>
    {:else if !selected}
      <div class="min-h-0 overflow-y-auto p-5">
        <div class="mx-auto max-w-2xl space-y-5">
          <div>
            <h2 class="text-[14px] font-semibold">
              {m['huddle.start_title']()}
            </h2>
            <p class="mt-1 text-ui-xs text-[var(--app-text-muted)]">
              {m['huddle.start_hint']()}
            </p>
          </div>
          <label class="block"
            ><span class="mb-1.5 block text-ui-xs font-medium">{m['huddle.topic']()}</span><Input
              bind:value={title}
              maxlength={160}
              placeholder={m['huddle.topic_placeholder']()}
            /></label
          ><label class="block"
            ><span class="mb-1.5 block text-ui-xs font-medium">{m['huddle.agenda']()}</span><Textarea
              bind:value={agenda}
              maxlength={8000}
              class="min-h-24 resize-y"
              placeholder={m['huddle.agenda_placeholder']()}
            /></label
          >
          <section>
            <div class="mb-2 flex items-center justify-between">
              <h3 class="text-ui-xs font-medium">
                {m['huddle.choose_agents']()}
              </h3>
              <Badge variant="outline">{selectedAgents.length}/11</Badge>
            </div>
            <div class="divide-y divide-[var(--app-border)] border-y border-[var(--app-border)]">
              {#each agents as agent (agent.id)}<label class="flex items-center gap-3 py-2"
                  ><Checkbox
                    checked={selectedAgents.includes(agent.id)}
                    disabled={!selectedAgents.includes(agent.id) && selectedAgents.length >= 11}
                    onCheckedChange={(value: boolean | 'indeterminate') => toggleSelected(agent.id, value === true)}
                  /><span class="min-w-0 flex-1"
                    ><span class="block truncate text-ui-xs font-medium">{agent.title}</span><span
                      class="block truncate text-ui-xs text-[var(--app-text-muted)]"
                      >{(agent.payload as { provider?: string; role?: string }).provider}{(agent.payload as { role?: string }).role
                        ? ` · ${(agent.payload as { role?: string }).role}`
                        : ''}</span
                    ></span
                  >{#if selectedAgents.includes(agent.id)}<button
                      type="button"
                      class="rounded px-2 py-1 text-ui-xs"
                      class:bg-[var(--app-accent-soft)]={facilitatorNodeId === agent.id}
                      onclick={(event) => {
                        event.preventDefault();
                        facilitatorNodeId = agent.id;
                      }}>{facilitatorNodeId === agent.id ? m['huddle.facilitator']() : m['huddle.make_facilitator']()}</button
                    >{/if}</label
                >{/each}
            </div>
          </section>
          <Button disabled={busy || !title.trim() || !selectedAgents.length} onclick={() => void start()}
            >{#if busy}<LoaderCircle class="animate-spin" />{:else}<Radio />{/if}{m['huddle.start']()}</Button
          >
        </div>
      </div>
    {:else}
      <div class="flex min-h-0 flex-col">
        <div class="flex shrink-0 flex-wrap items-start justify-between gap-3 border-b border-[var(--app-border)] px-5 py-3">
          <div>
            <div class="flex items-center gap-2">
              <h2 class="text-ui-lg font-semibold">{selected.title}</h2>
              <Badge variant="outline">{selected.status === 'active' ? m['huddle.live']() : m['huddle.finished']()}</Badge>{#if selected.linkedTaskId}<Badge
                  variant="secondary"><Link2 size={10} />{m['huddle.task_linked']()}</Badge
                >{/if}
            </div>
            {#if selected.agenda}<p class="mt-1 max-w-3xl text-ui-xs text-[var(--app-text-muted)]">
                {selected.agenda}
              </p>{/if}
          </div>
          <div class="flex items-center gap-1.5">
            {#if !selected.linkedTaskId}<Button variant="outline" size="sm" class="h-8 text-ui-xs" onclick={() => void createTask()}
                ><Check size={12} />{m['huddle.create_task']()}</Button
              >{/if}{#if selected.status === 'active'}<Button variant="outline" size="sm" class="h-8 text-ui-xs" onclick={() => void end()}
                ><CircleStop size={12} />{m['huddle.end']()}</Button
              >{/if}
          </div>
        </div>
        <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
          <div class="mx-auto max-w-3xl space-y-3">
            {#each selected.turns as turn (turn.id)}<article
                class="border-l-2 py-1 pl-3"
                class:border-[var(--app-accent)]={turn.speakerKind !== 'agent'}
                class:border-[var(--app-border-strong)]={turn.speakerKind === 'agent'}
              >
                <div class="flex items-center gap-2">
                  <strong class="text-ui-xs">{turn.speakerName}</strong><span class="text-ui-xs text-[var(--app-text-muted)]">#{turn.sequence}</span
                  >{#if turn.state === 'pending'}<LoaderCircle size={10} class="animate-spin text-[var(--app-accent)]" />{:else if turn.state === 'failed'}<span
                      class="text-ui-xs text-[var(--app-danger)]">{m['huddle.reply_failed']()}</span
                    >{/if}
                </div>
                {#if turn.text}<p class="mt-1 whitespace-pre-wrap text-ui-sm leading-5">
                    {turn.text}
                  </p>{/if}
              </article>{:else}<div class="grid min-h-48 place-items-center text-center">
                <div>
                  <MessageCircleMore size={24} class="mx-auto text-[var(--app-text-muted)]" />
                  <p class="mt-2 text-ui-xs text-[var(--app-text-muted)]">
                    {m['huddle.transcript_empty']()}
                  </p>
                </div>
              </div>{/each}
          </div>
        </div>
        {#if selected.status === 'active'}<footer class="shrink-0 border-t border-[var(--app-border)] bg-[var(--app-surface)] px-5 py-3">
            <div class="mx-auto max-w-3xl">
              <div class="mb-2 flex flex-wrap items-center gap-2">
                <span class="flex items-center gap-1 text-ui-xs font-semibold uppercase text-[var(--app-text-muted)]"
                  ><Users size={10} />{m['huddle.ask']()}</span
                >{#each participants as participant (participant.id)}<label
                    class="flex items-center gap-1 rounded border border-[var(--app-border)] px-1.5 py-1 text-ui-xs"
                    ><Checkbox
                      class="size-3"
                      checked={targets.includes(participant.participantId)}
                      disabled={!targets.includes(participant.participantId) && targets.length >= 5}
                      onCheckedChange={(value: boolean | 'indeterminate') => toggleTarget(participant.participantId, value === true)}
                    />{participant.displayName}</label
                  >{/each}<label class="ml-auto flex items-center gap-1.5 text-ui-xs text-[var(--app-text-muted)]"
                  ><Switch checked={speakReplies} onCheckedChange={(value: boolean) => (speakReplies = value)} />{#if speakReplies}<Volume2
                      size={11}
                    />{:else}<VolumeX size={11} />{/if}{m['huddle.speak_replies']()}</label
                >
              </div>
              <div class="flex items-end gap-2">
                <Textarea
                  bind:ref={composer}
                  bind:value={message}
                  class="min-h-16 max-h-36 resize-y text-ui-sm"
                  placeholder={m['huddle.message_placeholder']()}
                  onkeydown={(event: KeyboardEvent) => {
                    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                      event.preventDefault();
                      void send();
                    }
                  }}
                /><Button variant="outline" size="icon" class="size-9 shrink-0" aria-label={m['huddle.dictate']()} onclick={() => void dictate()}
                  ><Mic size={14} /></Button
                ><Button
                  size="icon"
                  class="size-9 shrink-0"
                  disabled={busy || !message.trim() || !targets.length}
                  aria-label={m['huddle.send']()}
                  onclick={() => void send()}
                  >{#if busy}<LoaderCircle size={14} class="animate-spin" />{:else}<Send size={14} />{/if}</Button
                >
              </div>
            </div>
          </footer>{/if}
      </div>
    {/if}
  </div>
</section>
