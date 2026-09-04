<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { getCsrfToken } from '@beeblock/svelar/http';
  import { toast } from '@beeblock/svelar/ui';
  import {
    AlertTriangle,
    Bell,
    BellRing,
    Check,
    ChevronDown,
    CircleDot,
    Clock3,
    ExternalLink,
    MessageSquareMore,
    RefreshCw,
    ShieldAlert,
    Workflow,
  } from '@lucide/svelte';
  import { Button } from '$lib/components/ui/button';
  import * as Sheet from '$lib/components/ui/sheet';
  import * as Tooltip from '$lib/components/ui/tooltip';
  import type {
    AgentAttentionItem,
    AgentAttentionStatus,
    AgentActivityCategory,
  } from '$lib/modules/agent-room/domain/types.js';
  import * as m from '$lib/paraglide/messages.js';

  let { workspaceId = null }: { workspaceId?: string | null } = $props();
  let open = $state(false);
  let loading = $state(false);
  let items = $state<AgentAttentionItem[]>([]);
  let filter = $state<'action' | 'all' | 'snoozed'>('action');
  let expandedIds = $state<Set<string>>(new Set());
  let refreshTimer: ReturnType<typeof setTimeout> | null = null;
  let clock = $state(Date.now());

  const actionable = $derived(items.filter((item) => (
    item.status === 'open'
    || item.status === 'read'
    || (item.status === 'snoozed' && new Date(item.snoozedUntil ?? 0).getTime() <= clock)
  )));
  const filteredItems = $derived(
    filter === 'snoozed'
      ? items.filter((item) => item.status === 'snoozed' && new Date(item.snoozedUntil ?? 0).getTime() > clock)
      : filter === 'all'
        ? items
        : actionable,
  );
  const visibleItems = $derived([...filteredItems].sort((left, right) => {
    const leftCurrent = left.workspaceId === workspaceId ? 1 : 0;
    const rightCurrent = right.workspaceId === workspaceId ? 1 : 0;
    return rightCurrent - leftCurrent || right.updatedAt.localeCompare(left.updatedAt);
  }));

  function iconFor(category: AgentActivityCategory) {
    if (category === 'message') return MessageSquareMore;
    if (category === 'workflow') return Workflow;
    if (category === 'review') return ShieldAlert;
    if (category === 'task') return Check;
    return CircleDot;
  }

  function dateLabel(value: string): string {
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
  }

  async function loadItems(silent = false): Promise<void> {
    if (!silent) loading = true;
    try {
      const response = await fetch('/api/agent-room/attention?limit=300', { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? m['attention.load_error']());
      items = payload.data ?? [];
    } catch (error) {
      if (!silent) toast.error(error instanceof Error ? error.message : m['attention.load_error']());
    } finally {
      if (!silent) loading = false;
    }
  }

  async function setStatus(item: AgentAttentionItem, status: AgentAttentionStatus, snoozedUntil?: string): Promise<void> {
    const csrf = getCsrfToken();
    const response = await fetch(`/api/agent-room/attention/${item.id}`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
      },
      body: JSON.stringify({ workspaceId: item.workspaceId, status, snoozedUntil }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error ?? m['attention.update_error']());
    const updated = payload.data as AgentAttentionItem;
    items = status === 'resolved'
      ? items.filter((candidate) => candidate.id !== item.id)
      : items.map((candidate) => candidate.id === item.id ? {
          ...candidate,
          ...updated,
          workspaceName: candidate.workspaceName,
          nodeTitle: candidate.nodeTitle,
          sourceContent: candidate.sourceContent,
          actionAvailable: candidate.actionAvailable,
        } : candidate);
  }

  async function act(item: AgentAttentionItem, status: AgentAttentionStatus, snoozedUntil?: string): Promise<void> {
    try {
      await setStatus(item, status, snoozedUntil);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : m['attention.update_error']());
    }
  }

  async function openItem(item: AgentAttentionItem): Promise<void> {
    if (!item.actionAvailable) return;
    if (item.status === 'open') await act(item, 'read');
    open = false;
    const params = new URLSearchParams({ workspace: item.workspaceId });
    if (item.nodeId) params.set('node', item.nodeId);
    if (item.taskId) params.set('task', item.taskId);
    await goto(`/canvas?${params.toString()}`);
  }

  async function toggleItem(item: AgentAttentionItem): Promise<void> {
    if (item.status === 'open') await act(item, 'read');
    const next = new Set(expandedIds);
    if (next.has(item.id)) next.delete(item.id);
    else next.add(item.id);
    expandedIds = next;
  }

  function scheduleRefresh(): void {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => void loadItems(true), 180);
  }

  onMount(() => {
    void loadItems(true);
    const clockTimer = setInterval(() => (clock = Date.now()), 60_000);
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
    const socket = new WebSocket(`${protocol}://${location.host}/ws/agent-room/pty`);
    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(String(event.data));
        if (message.type === 'attentionChanged') scheduleRefresh();
      } catch {
        // Ignore terminal frames.
      }
    };
    const show = () => { open = true; void loadItems(); };
    window.addEventListener('orkestrai:open-attention', show);
    return () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      clearInterval(clockTimer);
      socket.close();
      window.removeEventListener('orkestrai:open-attention', show);
    };
  });
</script>

<Sheet.Root bind:open onOpenChange={(value) => value && void loadItems()}>
  <Tooltip.Root>
    <Tooltip.Trigger>
      {#snippet child({ props })}
        <Button
          {...props}
          variant="ghost"
          size="icon"
          class="relative size-8 shrink-0 text-[var(--app-text-muted)] hover:bg-[var(--app-surface-raised)] hover:text-[var(--app-text)]"
          aria-label={m['attention.open']()}
          onclick={() => (open = true)}
        >
          {#if actionable.length}<BellRing size={15} />{:else}<Bell size={15} />{/if}
          {#if actionable.length}
            <span class="absolute -right-1 -top-1 grid min-w-4 place-items-center rounded-full bg-[color-mix(in_srgb,var(--app-danger)_75%,black)] px-1 text-[9px] font-bold leading-4 text-white">
              {actionable.length > 99 ? '99+' : actionable.length}
            </span>
          {/if}
        </Button>
      {/snippet}
    </Tooltip.Trigger>
    <Tooltip.Content>{m['attention.open']()}</Tooltip.Content>
  </Tooltip.Root>

  <Sheet.Content side="right" class="flex w-full max-w-[480px] flex-col gap-0 border-[var(--app-border)] bg-[var(--app-surface)] p-0 text-[var(--app-text)] sm:max-w-[480px]">
    <Sheet.Header class="shrink-0 border-b border-[var(--app-border)] px-5 py-4 text-left">
      <div class="flex items-start justify-between gap-3 pr-8">
        <div class="min-w-0">
          <Sheet.Title class="flex items-center gap-2 text-[15px] font-semibold text-[var(--app-text)]">
            <BellRing size={17} class="text-[var(--app-accent)]" />
            {m['attention.title']()}
          </Sheet.Title>
          <Sheet.Description class="mt-1 text-[11px] leading-4 text-[var(--app-text-muted)]">
            {m['attention.description']()}
          </Sheet.Description>
        </div>
        <Button variant="ghost" size="icon" class="size-8 shrink-0" aria-label={m['attention.refresh']()} onclick={() => void loadItems()} disabled={loading}>
          <RefreshCw size={14} class={loading ? 'animate-spin' : ''} />
        </Button>
      </div>
      <div class="mt-4 inline-flex rounded-md border border-[var(--app-border)] bg-[var(--app-surface-subtle)] p-0.5">
        {#each [
          { id: 'action', label: m['attention.filter_action']() },
          { id: 'all', label: m['attention.filter_all']() },
          { id: 'snoozed', label: m['attention.filter_snoozed']() },
        ] as option}
          <button
            type="button"
            class="h-7 rounded-[5px] px-2.5 text-[10px] font-medium transition-colors"
            class:bg-[var(--app-surface-raised)]={filter === option.id}
            class:text-[var(--app-text)]={filter === option.id}
            class:text-[var(--app-text-muted)]={filter !== option.id}
            aria-pressed={filter === option.id}
            onclick={() => (filter = option.id as typeof filter)}
          >{option.label}</button>
        {/each}
      </div>
    </Sheet.Header>

    <div class="min-h-0 flex-1 overflow-y-auto p-3">
      {#if loading && !items.length}
        <div class="grid h-40 place-items-center text-[11px] text-[var(--app-text-muted)]">{m['attention.loading']()}</div>
      {:else if !visibleItems.length}
        <div class="grid h-52 place-items-center px-8 text-center">
          <div>
            <Check size={24} class="mx-auto text-[var(--app-success)]" />
            <p class="mt-3 text-[12px] font-medium text-[var(--app-text)]">{m['attention.empty_title']()}</p>
            <p class="mt-1 text-[11px] leading-4 text-[var(--app-text-muted)]">{m['attention.empty_body']()}</p>
          </div>
        </div>
      {:else}
        <div class="space-y-2">
          {#each visibleItems as item (item.id)}
            {@const Icon = iconFor(item.category)}
            {@const expanded = expandedIds.has(item.id)}
            <article class="group rounded-md border border-[var(--app-border)] bg-[var(--app-surface-subtle)] transition-colors hover:border-[var(--app-border-strong)] hover:bg-[var(--app-surface-raised)]">
              <button
                type="button"
                class="flex w-full items-start gap-3 p-3 text-left"
                aria-expanded={expanded}
                aria-label={expanded ? m['attention.hide_details']() : m['attention.show_details']()}
                onclick={() => void toggleItem(item)}
              >
                <span
                  class="mt-0.5 grid size-7 shrink-0 place-items-center rounded-md"
                  class:bg-[color-mix(in_srgb,var(--app-danger)_14%,transparent)]={item.severity === 'error'}
                  class:bg-[color-mix(in_srgb,var(--app-warning)_14%,transparent)]={item.severity === 'warning'}
                  class:bg-[var(--app-accent-soft)]={item.severity === 'info' || item.severity === 'success'}
                >
                  {#if item.severity === 'error'}<AlertTriangle size={14} class="text-[var(--app-danger)]" />{:else}<Icon size={14} class="text-[var(--app-accent)]" />{/if}
                </span>
                <span class="min-w-0 flex-1">
                  <span class="flex items-center gap-2">
                    <strong class:text-clip={expanded} class:line-clamp-2={!expanded} class="min-w-0 whitespace-pre-wrap break-words text-[11px] font-semibold leading-4 text-[var(--app-text)]">{item.title}</strong>
                    {#if item.status === 'open'}<span class="size-1.5 shrink-0 rounded-full bg-[var(--app-accent)]"></span>{/if}
                  </span>
                  {#if item.body}
                    <span class:line-clamp-2={!expanded} class="mt-1 block whitespace-pre-wrap break-words text-[10px] leading-4 text-[var(--app-text-soft)]">{item.body}</span>
                  {/if}
                  <span class="mt-2 flex min-w-0 items-center gap-1.5 text-[9px] text-[var(--app-text-muted)]">
                    <span class="truncate">{item.workspaceName ?? item.workspaceId}</span>
                    {#if item.nodeTitle}<span>·</span><span class="truncate">{item.nodeTitle}</span>{/if}
                    <span>·</span><time title={dateLabel(item.updatedAt)}>{dateLabel(item.updatedAt)}</time>
                  </span>
                </span>
                <ChevronDown size={14} class={`mt-1 shrink-0 text-[var(--app-text-muted)] transition-transform ${expanded ? 'rotate-180' : ''}`} />
              </button>
              {#if expanded && item.sourceContent && item.sourceContent.trim() !== item.title.trim()}
                <div class="mx-3 mb-3 rounded-md border border-[var(--app-border)] bg-[var(--app-surface)] px-3 py-2.5">
                  <span class="text-[9px] font-semibold uppercase text-[var(--app-text-muted)]">{m['attention.original_message']()}</span>
                  <p class="mt-1 whitespace-pre-wrap break-words text-[10px] leading-4 text-[var(--app-text-soft)]">{item.sourceContent}</p>
                </div>
              {/if}
              <div class="flex items-center justify-end gap-1 border-t border-[var(--app-border)] px-2 py-1.5">
                {#if item.actionAvailable}
                  <Button variant="ghost" size="sm" class="mr-auto h-7 gap-1.5 px-2 text-[10px]" onclick={() => void openItem(item)}>
                    <ExternalLink size={12} />
                    {m['attention.open_source']()}
                  </Button>
                {:else}
                  <span class="mr-auto px-1 text-[9px] text-[var(--app-text-muted)]">{m['attention.source_unavailable']()}</span>
                {/if}
                {#if item.status === 'open'}
                  <Button variant="ghost" size="sm" class="h-7 px-2 text-[10px]" onclick={() => void act(item, 'read')}>{m['attention.mark_read']()}</Button>
                {/if}
                <Button variant="ghost" size="icon" class="size-7" aria-label={m['attention.snooze']()} onclick={() => void act(item, 'snoozed', new Date(Date.now() + 60 * 60 * 1000).toISOString())}>
                  <Clock3 size={13} />
                </Button>
                <Button variant="ghost" size="icon" class="size-7 text-[var(--app-success)]" aria-label={m['attention.resolve']()} onclick={() => void act(item, 'resolved')}>
                  <Check size={13} />
                </Button>
              </div>
            </article>
          {/each}
        </div>
      {/if}
    </div>
  </Sheet.Content>
</Sheet.Root>
