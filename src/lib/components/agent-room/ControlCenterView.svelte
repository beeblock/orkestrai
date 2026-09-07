<script lang="ts">
  import { onMount } from 'svelte';
  import {
    Activity,
    AlertCircle,
    Check,
    CircleDashed,
    Clock3,
    FileCode2,
    GitCommitHorizontal,
    Inbox,
    Layers,
    MessageSquareMore,
    RefreshCw,
    ShieldAlert,
    SquareKanban,
    Users,
    WifiOff,
  } from '@lucide/svelte';
  import { Button } from '$lib/components/ui/button';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import * as Tooltip from '$lib/components/ui/tooltip';
  import { retainUsageFeed, usageStore } from './usage-store.svelte.js';
  import type {
    AgentActivitySnapshot,
    AgentActivity,
    AgentActivityState,
    AgentMessageDeliveryState,
    AgentMessageThread,
    ControlCenterSnapshot,
  } from '$lib/modules/agent-room/domain/types.js';
  import * as m from '$lib/paraglide/messages.js';

  let {
    workspaceName,
    snapshot = null,
    loading = false,
    onRefresh,
  }: {
    workspaceName: string;
    snapshot?: ControlCenterSnapshot | null;
    loading?: boolean;
    onRefresh: () => void;
  } = $props();

  let now = $state(Date.now());
  let secondaryView = $state<'activity' | 'communications'>('activity');

  const attentionCount = $derived(
    (snapshot?.counts.waiting_input ?? 0)
      + (snapshot?.counts.waiting_permission ?? 0)
      + (snapshot?.counts.blocked ?? 0)
      + (snapshot?.counts.error ?? 0),
  );

  const summary = $derived([
    { id: 'working', label: m['control_center.summary_working'](), count: snapshot?.counts.working ?? 0, icon: Activity, color: 'var(--app-success)' },
    { id: 'attention', label: m['control_center.summary_attention'](), count: attentionCount, icon: ShieldAlert, color: 'var(--app-warning)' },
    { id: 'idle', label: m['control_center.summary_idle'](), count: snapshot?.counts.idle ?? 0, icon: Clock3, color: 'var(--app-text-muted)' },
    { id: 'offline', label: m['control_center.summary_offline'](), count: snapshot?.counts.disconnected ?? 0, icon: WifiOff, color: 'var(--app-danger)' },
  ]);

  function stateLabel(state: AgentActivityState): string {
    if (state === 'starting') return m['control_center.state_starting']();
    if (state === 'working') return m['control_center.state_working']();
    if (state === 'waiting_input') return m['control_center.state_waiting_input']();
    if (state === 'waiting_permission') return m['control_center.state_waiting_permission']();
    if (state === 'blocked') return m['control_center.state_blocked']();
    if (state === 'idle') return m['control_center.state_idle']();
    if (state === 'done') return m['control_center.state_done']();
    if (state === 'error') return m['control_center.state_error']();
    return m['control_center.state_disconnected']();
  }

  function stateColor(state: AgentActivityState): string {
    if (state === 'working') return 'var(--app-success)';
    if (state === 'waiting_input' || state === 'waiting_permission') return 'var(--app-warning)';
    if (state === 'blocked' || state === 'error' || state === 'disconnected') return 'var(--app-danger)';
    if (state === 'done') return 'var(--app-accent)';
    return 'var(--app-text-muted)';
  }

  function deliveryLabel(state: AgentMessageDeliveryState): string {
    if (state === 'queued') return m['control_center.delivery_queued']();
    if (state === 'sent') return m['control_center.delivery_sent']();
    if (state === 'delivered') return m['control_center.delivery_delivered']();
    if (state === 'acknowledged') return m['control_center.delivery_acknowledged']();
    if (state === 'replied') return m['control_center.delivery_replied']();
    return m['control_center.delivery_failed']();
  }

  function elapsed(since: string): string {
    const seconds = Math.max(0, Math.floor((now - Date.parse(since)) / 1_000));
    if (seconds < 60) return m['control_center.elapsed_seconds']({ count: seconds });
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return m['control_center.elapsed_minutes']({ count: minutes });
    const hours = Math.floor(minutes / 60);
    return m['control_center.elapsed_hours']({ count: hours });
  }

  function usageFor(agent: AgentActivitySnapshot): string | null {
    const usage = usageStore.values.find((candidate) => candidate.provider === agent.provider);
    if (!usage || usage.error || usage.windows.length === 0) return null;
    const highest = [...usage.windows].sort((a, b) => b.usedPercent - a.usedPercent)[0];
    return `${highest.usedPercent}%`;
  }

  function actionLabel(agent: AgentActivitySnapshot): string {
    if (!agent.lastAction) return m['control_center.no_current_task']();
    const name = (key: string) => String(agent.lastActionData[key] ?? m['control_center.workspace_user']());
    if (agent.lastAction === 'system:message_received') return m['control_center.action_message_received']({ name: name('fromTitle') });
    if (agent.lastAction === 'system:message_replied') return m['control_center.action_message_replied']({ name: name('toTitle') });
    if (agent.lastAction === 'system:task_completed') return m['control_center.action_task_completed']({ title: name('taskTitle') });
    if (agent.lastAction === 'system:task_review') return m['control_center.action_task_review']({ title: name('taskTitle') });
    if (agent.lastAction === 'system:task_working') return m['control_center.action_task_working']({ title: name('taskTitle') });
    return agent.lastAction;
  }

  function sender(thread: AgentMessageThread): string {
    return thread.fromTitle ?? m['control_center.workspace_user']();
  }

  function activityTitle(event: AgentActivity): string {
    if (event.objectTitle) return event.objectTitle;
    const name = (key: string) => String(event.metadata[key] ?? m['control_center.workspace_user']());
    if (event.action === 'system:message_received') return m['control_center.action_message_received']({ name: name('fromTitle') });
    if (event.action === 'system:message_replied') return m['control_center.action_message_replied']({ name: name('toTitle') });
    if (event.action === 'system:task_completed') return m['control_center.action_task_completed']({ title: name('taskTitle') });
    if (event.action === 'system:task_review') return m['control_center.action_task_review']({ title: name('taskTitle') });
    if (event.action === 'system:task_working') return m['control_center.action_task_working']({ title: name('taskTitle') });
    return event.action ?? event.verb;
  }

  function activityIcon(category: AgentActivity['category']) {
    if (category === 'message') return MessageSquareMore;
    if (category === 'task' || category === 'review') return SquareKanban;
    if (category === 'git') return GitCommitHorizontal;
    if (category === 'terminal') return FileCode2;
    return Activity;
  }

  function activityColor(event: AgentActivity): string {
    if (event.severity === 'error') return 'var(--app-danger)';
    if (event.severity === 'warning') return 'var(--app-warning)';
    if (event.severity === 'success') return 'var(--app-success)';
    return 'var(--app-accent)';
  }

  onMount(() => {
    onRefresh();
    const releaseUsage = retainUsageFeed();
    const timer = setInterval(() => (now = Date.now()), 30_000);
    return () => {
      releaseUsage();
      clearInterval(timer);
    };
  });
</script>

<section class="control-center grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] bg-[var(--app-canvas)]" data-testid="control-center-view">
  <header class="border-b border-[var(--app-border)] bg-[var(--app-surface)] px-5 py-4">
    <div class="flex min-w-0 items-start gap-3">
      <span class="mt-0.5 grid size-8 shrink-0 place-items-center rounded-[6px] border border-[var(--app-border)] bg-[var(--app-surface-raised)] text-[var(--app-accent)]">
        <Activity size={17} aria-hidden="true" />
      </span>
      <div class="min-w-0 flex-1">
        <h2 class="truncate text-sm font-semibold text-[var(--app-text)]">{m['control_center.title']()}</h2>
        <p class="mt-0.5 truncate text-ui-sm text-[var(--app-text-muted)]">{workspaceName} · {m['control_center.subtitle']()}</p>
      </div>
      <Tooltip.Root>
        <Tooltip.Trigger>
          {#snippet child({ props })}
            <Button {...props} variant="ghost" size="icon-sm" aria-label={m['control_center.refresh']()} onclick={onRefresh} disabled={loading}>
              <RefreshCw size={14} class={loading ? 'animate-spin' : ''} />
            </Button>
          {/snippet}
        </Tooltip.Trigger>
        <Tooltip.Content>{m['control_center.refresh']()}</Tooltip.Content>
      </Tooltip.Root>
    </div>

    <div class="control-summary mt-4 grid gap-px overflow-hidden rounded-[6px] border border-[var(--app-border)] bg-[var(--app-border)]" aria-label={m['control_center.summary_aria']()}>
      {#each summary as metric (metric.id)}
        <div class="flex min-w-0 items-center gap-2 bg-[var(--app-surface)] px-3 py-2.5">
          <span style:color={metric.color}><metric.icon size={14} aria-hidden="true" /></span>
          <div class="min-w-0">
            <div class="text-sm font-semibold tabular-nums text-[var(--app-text)]">{metric.count}</div>
            <div class="truncate text-ui-xs font-medium uppercase text-[var(--app-text-muted)]">{metric.label}</div>
          </div>
        </div>
      {/each}
    </div>
  </header>

  {#if loading && !snapshot}
    <div class="control-body grid min-h-0">
      <div class="control-agents space-y-3 p-4">
        {#each [0, 1, 2, 3] as row (row)}<Skeleton class="h-20 w-full bg-[var(--app-surface-raised)]" />{/each}
      </div>
      <div class="space-y-3 p-4">
        {#each [0, 1, 2] as row (row)}<Skeleton class="h-24 w-full bg-[var(--app-surface-raised)]" />{/each}
      </div>
    </div>
  {:else}
    <div class="control-body grid min-h-0 overflow-hidden">
      <section class="control-agents min-h-0 overflow-y-auto" aria-labelledby="control-center-agents">
        <div class="sticky top-0 z-10 flex h-9 items-center gap-2 border-b border-[var(--app-border)] bg-[var(--app-surface-subtle)] px-4">
          <Users size={13} class="text-[var(--app-text-muted)]" aria-hidden="true" />
          <h3 id="control-center-agents" class="text-ui-xs font-semibold uppercase text-[var(--app-text-muted)]">{m['control_center.agents']()}</h3>
          <span class="ml-auto text-ui-xs tabular-nums text-[var(--app-text-muted)]">{snapshot?.agents.length ?? 0}</span>
        </div>
        {#if snapshot?.agents.length}
          <div class="divide-y divide-[var(--app-border)]">
            {#each snapshot.agents as agent (agent.nodeId)}
              <article class="grid min-h-20 grid-cols-[auto_minmax(0,1fr)_auto] gap-3 px-4 py-3 transition-colors hover:bg-[var(--app-surface-subtle)]">
                <span class="relative mt-1 size-2.5 shrink-0 rounded-full border-2 border-[var(--app-surface)]" style:background={stateColor(agent.state)}>
                  {#if agent.state === 'working'}<span class="absolute inset-[-4px] animate-ping rounded-full opacity-20" style:background={stateColor(agent.state)}></span>{/if}
                </span>
                <div class="min-w-0">
                  <div class="flex min-w-0 items-center gap-2">
                    <h4 class="truncate text-xs font-semibold text-[var(--app-text)]">{agent.title}</h4>
                    <span class="shrink-0 rounded-[3px] bg-[var(--app-surface-raised)] px-1.5 py-0.5 text-ui-xs text-[var(--app-text-muted)]">{agent.provider ?? m['control_center.shell']()}</span>
                    {#if agent.floorName}<span class="inline-flex min-w-0 items-center gap-1 rounded-[3px] bg-[var(--app-surface-raised)] px-1.5 py-0.5 text-ui-xs text-[var(--app-text-muted)]"><Layers size={9} class="shrink-0" /><span class="truncate">{agent.floorName}</span></span>{/if}
                    {#if agent.role}<span class="min-w-0 truncate text-ui-xs text-[var(--app-text-muted)]">{agent.role}</span>{/if}
                  </div>
                  <p class="mt-1 truncate text-ui-sm text-[var(--app-text-soft)]">{agent.currentTask?.title ?? actionLabel(agent)}</p>
                  <div class="mt-1.5 flex min-w-0 items-center gap-2 text-ui-xs text-[var(--app-text-muted)]">
                    <span class="font-medium" style:color={stateColor(agent.state)}>{stateLabel(agent.state)}</span>
                    <span>·</span>
                    <span>{elapsed(agent.stateSince)}</span>
                    {#if agent.currentTask}<span class="truncate">· #{agent.currentTask.id.slice(0, 8)} · {agent.currentTask.status}</span>{/if}
                  </div>
                </div>
                <div class="flex flex-col items-end gap-1 text-ui-xs text-[var(--app-text-muted)]">
                  {#if usageFor(agent)}<span class="font-semibold tabular-nums text-[var(--app-text-soft)]">{usageFor(agent)}</span>{/if}
                  <span>{m['control_center.provider_usage']()}</span>
                </div>
              </article>
            {/each}
          </div>
        {:else}
          <div class="grid min-h-56 place-items-center p-8 text-center">
            <div><CircleDashed size={24} class="mx-auto text-[var(--app-text-muted)]" /><p class="mt-2 text-xs text-[var(--app-text-muted)]">{m['control_center.no_agents']()}</p></div>
          </div>
        {/if}
      </section>

      <section class="min-h-0 overflow-y-auto" aria-labelledby="control-center-secondary">
        <div class="sticky top-0 z-10 flex h-9 items-center gap-1 border-b border-[var(--app-border)] bg-[var(--app-surface-subtle)] px-2">
          <h3 id="control-center-secondary" class="sr-only">{m['control_center.activity']()}</h3>
          <button
            type="button"
            class="flex h-7 items-center gap-1.5 rounded-[5px] px-2 text-ui-xs font-semibold uppercase transition-colors"
            class:bg-[var(--app-surface-raised)]={secondaryView === 'activity'}
            class:text-[var(--app-text)]={secondaryView === 'activity'}
            class:text-[var(--app-text-muted)]={secondaryView !== 'activity'}
            aria-pressed={secondaryView === 'activity'}
            onclick={() => (secondaryView = 'activity')}
          >
            <Activity size={12} />{m['control_center.activity']()}
            <span class="tabular-nums">{snapshot?.activity.length ?? 0}</span>
          </button>
          <button
            type="button"
            class="flex h-7 items-center gap-1.5 rounded-[5px] px-2 text-ui-xs font-semibold uppercase transition-colors"
            class:bg-[var(--app-surface-raised)]={secondaryView === 'communications'}
            class:text-[var(--app-text)]={secondaryView === 'communications'}
            class:text-[var(--app-text-muted)]={secondaryView !== 'communications'}
            aria-pressed={secondaryView === 'communications'}
            onclick={() => (secondaryView = 'communications')}
          >
            <Inbox size={12} />{m['control_center.inbox']()}
            <span class="tabular-nums">{snapshot?.communications.length ?? 0}</span>
          </button>
        </div>

        {#if secondaryView === 'activity'}
          {#if snapshot?.activity.length}
            <div class="divide-y divide-[var(--app-border)]">
              {#each snapshot.activity as event (event.id)}
                {@const Icon = activityIcon(event.category)}
                <article class="grid grid-cols-[28px_minmax(0,1fr)] gap-2.5 px-4 py-3 transition-colors hover:bg-[var(--app-surface-subtle)]">
                  <span class="grid size-7 place-items-center rounded-md bg-[var(--app-surface-raised)]" style:color={activityColor(event)}>
                    <Icon size={13} />
                  </span>
                  <div class="min-w-0">
                    <div class="flex min-w-0 items-start gap-2">
                      <strong class="min-w-0 flex-1 text-ui-xs font-semibold leading-4 text-[var(--app-text)]">{activityTitle(event)}</strong>
                      <span class="shrink-0 text-ui-xs text-[var(--app-text-muted)]">{elapsed(event.createdAt)}</span>
                    </div>
                    {#if event.outcome}<p class="mt-1 text-ui-xs leading-4 text-[var(--app-text-soft)]">{event.outcome}</p>{/if}
                    <div class="mt-1.5 flex min-w-0 items-center gap-1.5 text-ui-xs text-[var(--app-text-muted)]">
                      <span class="rounded-[3px] bg-[var(--app-surface-raised)] px-1.5 py-0.5">{event.category}</span>
                      <span>{stateLabel(event.state)}</span>
                      {#if event.objectType}<span>·</span><span class="truncate">{event.objectType}</span>{/if}
                    </div>
                    {#if Object.keys(event.metadata).length}
                      <details class="mt-2 text-ui-xs text-[var(--app-text-muted)]">
                        <summary class="cursor-pointer select-none hover:text-[var(--app-text-soft)]">{m['control_center.raw_details']()}</summary>
                        <pre class="mt-1 max-h-32 overflow-auto rounded-md bg-[var(--app-canvas)] p-2 font-mono text-ui-xs leading-4 text-[var(--app-text-soft)]">{JSON.stringify(event.metadata, null, 2)}</pre>
                      </details>
                    {/if}
                  </div>
                </article>
              {/each}
            </div>
          {:else}
            <div class="grid min-h-56 place-items-center p-8 text-center">
              <div><Activity size={24} class="mx-auto text-[var(--app-text-muted)]" /><p class="mt-2 text-xs text-[var(--app-text-muted)]">{m['control_center.no_activity']()}</p></div>
            </div>
          {/if}
        {:else if snapshot?.communications.length}
          <div class="divide-y divide-[var(--app-border)]">
            {#each snapshot.communications as thread (thread.messageId)}
              <article class="px-4 py-3 transition-colors hover:bg-[var(--app-surface-subtle)]">
                <div class="flex min-w-0 items-center gap-2">
                  {#if thread.state === 'replied'}<Check size={13} class="shrink-0 text-[var(--app-success)]" />
                  {:else if thread.state === 'failed'}<AlertCircle size={13} class="shrink-0 text-[var(--app-danger)]" />
                  {:else}<MessageSquareMore size={13} class="shrink-0 text-[var(--app-accent)]" />{/if}
                  <span class="truncate text-ui-xs font-semibold text-[var(--app-text)]">{sender(thread)} → {thread.toTitle}</span>
                  <span class={`ml-auto shrink-0 rounded-[3px] px-1.5 py-0.5 text-ui-xs font-semibold uppercase ${thread.state === 'failed' ? 'bg-[color-mix(in_srgb,var(--app-danger)_14%,transparent)] text-[var(--app-danger)]' : 'bg-[var(--app-surface-raised)] text-[var(--app-text-muted)]'}`}>{deliveryLabel(thread.state)}</span>
                </div>
                <p class="mt-2 line-clamp-2 text-ui-xs leading-4 text-[var(--app-text-soft)]">{thread.content}</p>
                {#if thread.reply}<p class="mt-2 border-l-2 border-[var(--app-success)] pl-2 text-ui-xs leading-4 text-[var(--app-text-muted)]">{thread.reply}</p>{/if}
                {#if thread.error}<p class="mt-2 text-ui-xs text-[var(--app-danger)]">{thread.error}</p>{/if}
                <div class="mt-2 flex items-center gap-1" aria-label={m['control_center.delivery_history']()}>
                  {#each thread.events as deliveryEvent, index (deliveryEvent.id)}
                    <Tooltip.Root>
                      <Tooltip.Trigger>
                        {#snippet child({ props })}<span {...props} class={`size-1.5 rounded-full ${deliveryEvent.state === 'failed' ? 'bg-[var(--app-danger)]' : deliveryEvent.state === 'replied' ? 'bg-[var(--app-success)]' : 'bg-[var(--app-accent)]'}`}></span>{/snippet}
                      </Tooltip.Trigger>
                      <Tooltip.Content>{deliveryLabel(deliveryEvent.state)}</Tooltip.Content>
                    </Tooltip.Root>
                    {#if index < thread.events.length - 1}<span class="h-px w-3 bg-[var(--app-border-strong)]"></span>{/if}
                  {/each}
                  <span class="ml-auto text-ui-xs tabular-nums text-[var(--app-text-muted)]">#{thread.messageId.slice(0, 8)}</span>
                </div>
              </article>
            {/each}
          </div>
        {:else}
          <div class="grid min-h-56 place-items-center p-8 text-center">
            <div><Inbox size={24} class="mx-auto text-[var(--app-text-muted)]" /><p class="mt-2 text-xs text-[var(--app-text-muted)]">{m['control_center.no_messages']()}</p></div>
          </div>
        {/if}
      </section>
    </div>
  {/if}
</section>

<style>
  .control-center {
    container-type: inline-size;
  }

  .control-summary {
    grid-template-columns: repeat(auto-fit, minmax(112px, 1fr));
  }

  .control-body {
    grid-template-columns: minmax(0, 1fr);
  }

  .control-agents {
    border-bottom: 1px solid var(--app-border);
  }

  @container (min-width: 820px) {
    .control-body {
      grid-template-columns: minmax(0, 1.25fr) minmax(320px, 0.75fr);
    }

    .control-agents {
      border-right: 1px solid var(--app-border);
      border-bottom: 0;
    }
  }
</style>
