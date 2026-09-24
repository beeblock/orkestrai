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
  import { Skeleton } from '$lib/components/ui/skeleton';
  import { SegmentedControl } from '$lib/components/ui/segmented';
  import NodeEmptyState from './canvas/NodeEmptyState.svelte';
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
  const snoozedCount = $derived(items.filter((item) => item.status === 'snoozed' && new Date(item.snoozedUntil ?? 0).getTime() > clock).length);
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
          class="relative size-8 shrink-0 text-[var(--app-text-muted)] hover:bg-[var(--app-hover)] hover:text-[var(--app-text)]"
          aria-label={m['attention.open']()}
          onclick={() => (open = true)}
        >
          {#if actionable.length}<BellRing size={15} />{:else}<Bell size={15} />{/if}
          {#if actionable.length}
            <!-- Contador so com tokens (texto na cor da pagina contrasta nos dois temas); anel separa do icone. -->
            <span class="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-[var(--app-danger)] px-1 font-mono text-[10.5px] font-semibold leading-4 tabular-nums text-[var(--app-page)] ring-2 ring-[var(--app-sidebar)]">
              {actionable.length > 99 ? '99+' : actionable.length}
            </span>
          {/if}
        </Button>
      {/snippet}
    </Tooltip.Trigger>
    <Tooltip.Content>{m['attention.open']()}</Tooltip.Content>
  </Tooltip.Root>

  <Sheet.Content side="right" class="flex w-full max-w-[480px] flex-col gap-0 border-[var(--app-border)] bg-[var(--app-surface)] p-0 text-[var(--app-text)] sm:max-w-[480px]">
    <Sheet.Header class="shrink-0 gap-0 border-b border-[var(--app-border)] pb-3 pl-5 pr-12 pt-3 text-left">
      <div class="flex min-w-0 items-start gap-3">
        <span class="mt-1 grid size-8 shrink-0 place-items-center rounded-lg bg-[var(--app-accent-soft)] text-[var(--app-accent)]" aria-hidden="true"><BellRing size={16} /></span>
        <div class="min-w-0 flex-1 pt-1">
          <Sheet.Title class="truncate font-display text-[15px] font-semibold tracking-[-0.01em] text-[var(--app-text)]">{m['attention.title']()}</Sheet.Title>
          <Sheet.Description class="mt-0.5 text-pretty text-ui-sm leading-[1.45] text-[var(--app-text-muted)]">
            {m['attention.description']()}
          </Sheet.Description>
        </div>
        <!-- Sem tooltip: o painel foca este botao ao abrir e a dica apareceria sozinha. -->
        <Button variant="ghost" size="icon-sm" class="shrink-0" title={m['attention.refresh']()} aria-label={m['attention.refresh']()} onclick={() => void loadItems()} disabled={loading}>
          <RefreshCw size={14} class={loading ? 'animate-spin' : ''} />
        </Button>
      </div>
      <SegmentedControl
        class="mt-3"
        size="sm"
        label={m['attention.title']()}
        bind:value={filter}
        options={[
          { value: 'action', label: m['attention.filter_action'](), count: actionable.length },
          { value: 'all', label: m['attention.filter_all'](), count: items.length },
          { value: 'snoozed', label: m['attention.filter_snoozed'](), count: snoozedCount },
        ]}
      />
    </Sheet.Header>

    <div class="min-h-0 flex-1 overflow-y-auto p-3">
      {#if loading && !items.length}
        <div class="space-y-2" role="status" aria-label={m['attention.loading']()}>
          {#each [0, 1, 2] as row (row)}<Skeleton class="h-[108px] w-full rounded-[10px] bg-[var(--app-hover)]" />{/each}
        </div>
      {:else if !visibleItems.length}
        <div class="grid h-64">
          <NodeEmptyState icon={Check} title={m['attention.empty_title']()} description={m['attention.empty_body']()} />
        </div>
      {:else}
        <div class="space-y-2">
          {#each visibleItems as item (item.id)}
            {@const Icon = iconFor(item.category)}
            {@const expanded = expandedIds.has(item.id)}
            <article class="attention-card group">
              <button
                type="button"
                class="attention-toggle flex w-full items-start gap-3 p-3 text-left"
                aria-expanded={expanded}
                aria-label={expanded ? m['attention.hide_details']() : m['attention.show_details']()}
                onclick={() => void toggleItem(item)}
              >
                <span
                  class="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg"
                  style:background={item.severity === 'error' ? 'var(--app-danger-soft)' : item.severity === 'warning' ? 'var(--app-warning-soft)' : 'var(--app-hover)'}
                >
                  {#if item.severity === 'error'}<AlertTriangle size={14} class="text-[var(--app-danger)]" />{:else}<Icon size={14} class={item.severity === 'warning' ? 'text-[var(--app-warning)]' : 'text-[var(--app-text-soft)]'} />{/if}
                </span>
                <span class="min-w-0 flex-1">
                  <span class="flex items-start gap-2">
                    <strong class:text-clip={expanded} class:line-clamp-2={!expanded} class="min-w-0 flex-1 whitespace-pre-wrap break-words text-ui-lg font-semibold leading-[1.35] text-[var(--app-text)]">{item.title}</strong>
                    {#if item.status === 'open'}<span class="mt-1.5 size-2 shrink-0 rounded-full bg-[var(--app-accent)]" aria-hidden="true"></span>{/if}
                  </span>
                  {#if item.body}
                    <span class:line-clamp-2={!expanded} class="mt-1 block whitespace-pre-wrap break-words text-ui-sm leading-[1.45] text-[var(--app-text-soft)]">{item.body}</span>
                  {/if}
                  <span class="mt-2 flex min-w-0 items-center gap-1.5 text-ui-xs text-[var(--app-text-muted)]">
                    <span class="truncate">{item.workspaceName ?? item.workspaceId}</span>
                    {#if item.nodeTitle}<span aria-hidden="true">·</span><span class="truncate">{item.nodeTitle}</span>{/if}
                    <span aria-hidden="true">·</span><time class="shrink-0 tabular-nums" title={dateLabel(item.updatedAt)}>{dateLabel(item.updatedAt)}</time>
                  </span>
                </span>
                <ChevronDown size={14} class={`mt-1 shrink-0 text-[var(--app-text-muted)] transition-transform duration-250 ease-smooth-out ${expanded ? 'rotate-180' : ''}`} />
              </button>
              {#if expanded && item.sourceContent && item.sourceContent.trim() !== item.title.trim()}
                <div class="mx-3 mb-2 rounded-lg bg-[var(--app-surface-subtle)] px-3 py-2.5 shadow-border">
                  <span class="section-label">{m['attention.original_message']()}</span>
                  <p class="mt-1 whitespace-pre-wrap break-words text-ui-sm leading-[1.45] text-[var(--app-text-soft)]">{item.sourceContent}</p>
                </div>
              {/if}
              <div class="flex items-center justify-end gap-1 px-2 pb-2">
                {#if item.actionAvailable}
                  <Button variant="ghost" size="sm" class="mr-auto text-ui-sm" onclick={() => void openItem(item)}>
                    <ExternalLink size={12} />
                    {m['attention.open_source']()}
                  </Button>
                {:else}
                  <span class="mr-auto px-2 text-ui-sm text-[var(--app-text-muted)]">{m['attention.source_unavailable']()}</span>
                {/if}
                {#if item.status === 'open'}
                  <Button variant="ghost" size="sm" class="text-ui-sm text-[var(--app-text-muted)]" onclick={() => void act(item, 'read')}>{m['attention.mark_read']()}</Button>
                {/if}
                <Tooltip.Root>
                  <Tooltip.Trigger>
                    {#snippet child({ props })}
                      <Button {...props} variant="ghost" size="icon-sm" class="text-[var(--app-text-muted)]" aria-label={m['attention.snooze']()} onclick={() => void act(item, 'snoozed', new Date(Date.now() + 60 * 60 * 1000).toISOString())}>
                        <Clock3 size={14} />
                      </Button>
                    {/snippet}
                  </Tooltip.Trigger>
                  <Tooltip.Content>{m['attention.snooze']()}</Tooltip.Content>
                </Tooltip.Root>
                <Tooltip.Root>
                  <Tooltip.Trigger>
                    {#snippet child({ props })}
                      <Button {...props} variant="outline" size="icon-sm" class="text-[var(--app-success)]" aria-label={m['attention.resolve']()} onclick={() => void act(item, 'resolved')}>
                        <Check size={14} />
                      </Button>
                    {/snippet}
                  </Tooltip.Trigger>
                  <Tooltip.Content>{m['attention.resolve']()}</Tooltip.Content>
                </Tooltip.Root>
              </div>
            </article>
          {/each}
        </div>
      {/if}
    </div>
  </Sheet.Content>
</Sheet.Root>

<style>
  /* Cartao com contorno por sombra (sem borda dupla); nao lidos levam o ponto de acento. */
  .attention-card {
    position: relative;
    border-radius: 10px;
    background: var(--app-surface-subtle);
    box-shadow: var(--app-shadow-border);
    transition: box-shadow var(--duration-quick) ease-out, background-color var(--duration-quick) ease-out;
  }

  .attention-card:hover {
    background: var(--app-surface-raised);
    box-shadow: var(--app-shadow-border-hover);
  }

  .attention-toggle {
    border-radius: 10px;
  }

  .attention-toggle:focus-visible {
    outline: 2px solid var(--app-accent);
    outline-offset: -2px;
  }
</style>
