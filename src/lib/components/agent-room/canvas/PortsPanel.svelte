<script lang="ts">
  import SidePanel from './SidePanel.svelte';
  import { onMount } from 'svelte';
  import { CircleStop, RefreshCw, RadioTower, ShieldCheck, TriangleAlert } from '@lucide/svelte';
  import { getCsrfToken } from '@beeblock/svelar/http';
  import { toast } from '@beeblock/svelar/ui';
  import * as AlertDialog from '$lib/components/ui/alert-dialog';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import * as m from '$lib/paraglide/messages.js';
  import type { ManagedPort } from '$lib/modules/agent-room/application/services/ManagedPortService.js';
  import type { Workspace } from '$lib/modules/agent-room/domain/types.js';
  import HeaderIconButton from './HeaderIconButton.svelte';

  type Props = {
    workspace: Workspace;
    onClose: () => void;
  };

  let { workspace, onClose }: Props = $props();

  const REFRESH_MS = 10_000;
  let ports = $state<ManagedPort[]>([]);
  let loading = $state(true);
  let refreshing = $state(false);
  let error = $state('');
  let pendingKill = $state<ManagedPort | null>(null);
  let killingPort = $state<number | null>(null);

  function localizedError(code: unknown, fallback: string): string {
    if (code === 'port_not_managed') return m['ports.error_not_managed']();
    if (code === 'protected_process') return m['ports.error_protected']();
    if (code === 'port_offline') return m['ports.error_offline']();
    if (code === 'stale_process') return m['ports.error_stale']();
    return fallback;
  }

  async function refresh(showSpinner = false) {
    if (showSpinner) refreshing = true;
    error = '';
    try {
      const response = await fetch(`/api/agent-room/workspaces/${workspace.id}/ports`);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.error) throw new Error(localizedError(payload.code, m['ports.list_error']()));
      ports = payload.data ?? [];
    } catch (cause) {
      error = cause instanceof Error ? cause.message : m['ports.list_error']();
    } finally {
      loading = false;
      refreshing = false;
    }
  }

  async function confirmKill() {
    const target = pendingKill;
    if (!target) return;
    killingPort = target.port;
    try {
      const csrf = getCsrfToken();
      const response = await fetch(`/api/agent-room/workspaces/${workspace.id}/ports`, {
        method: 'DELETE',
        headers: {
          'content-type': 'application/json',
          ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
        },
        body: JSON.stringify({ port: target.port, pids: target.pids }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.error) throw new Error(localizedError(payload.code, m['ports.kill_error']()));
      toast.success(m['ports.killed']({ port: target.port }));
      await refresh();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : m['ports.kill_error']());
    } finally {
      pendingKill = null;
      killingPort = null;
    }
  }

  onMount(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), REFRESH_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  });
</script>

<SidePanel class="ports-panel" labelledBy="ports-panel-title" title={m['ports.title']()} icon={RadioTower} description={m['ports.description']()} closeLabel={m['ports.close']()} {onClose}>
  {#snippet actions()}
    <HeaderIconButton
      label={m['ports.refresh']()}
      class="node-action-btn"
      side="left"
      disabled={refreshing}
      onclick={() => void refresh(true)}
    >
      <RefreshCw size={13} class={refreshing ? 'spinning' : undefined} />
    </HeaderIconButton>
  {/snippet}

  {#if loading && !ports.length}
    {#each [0, 1, 2] as index (index)}
      <section class="port-card port-skeleton" aria-hidden="true">
        <Skeleton class="h-4 w-20 bg-[var(--app-surface-raised)]" />
        <Skeleton class="h-3 w-full bg-[var(--app-surface-raised)]" />
        <Skeleton class="h-3 w-2/3 bg-[var(--app-surface-raised)]" />
      </section>
    {/each}
  {:else if error && !ports.length}
    <div class="panel-state error" role="status">
      <TriangleAlert size={18} aria-hidden="true" />
      <p>{error}</p>
      <button type="button" onclick={() => void refresh(true)}>{m['ports.try_again']()}</button>
    </div>
  {:else if !ports.length}
    <div class="panel-state" role="status">
      <RadioTower size={20} aria-hidden="true" />
      <p>{m['ports.empty']()}</p>
    </div>
  {:else}
    <div class="port-list" aria-live="polite">
      {#each ports as port (port.port)}
        <section class="port-card">
          <div class="port-topline">
            <div class="port-number">
              <span class:listening={port.status === 'listening'} class="status-dot" aria-hidden="true"></span>
              <strong>:{port.port}</strong>
              <span class:listening={port.status === 'listening'} class="status-label">
                {port.status === 'listening' ? m['ports.listening']() : m['ports.offline']()}
              </span>
            </div>
            {#if port.protected}
              <span class="protected-badge" title={m['ports.protected_help']()}>
                <ShieldCheck size={12} aria-hidden="true" /> {m['ports.protected']()}
              </span>
            {/if}
          </div>

          <div class="portal-list">
            {#each port.portals as portal (portal.nodeId)}
              <div class="portal-row" title={portal.url}>
                <span>{portal.title}</span>
                <code>{portal.url}</code>
              </div>
            {/each}
          </div>

          {#if port.pids.length}
            <div class="process-row">
              <span>{m['ports.process']()}</span>
              <code>{port.commands.join(', ') || m['ports.unknown_process']()} · PID {port.pids.join(', ')}</code>
            </div>
          {/if}

          {#if port.status === 'listening'}
            <HeaderIconButton
              label={port.protected ? m['ports.protected_help']() : m['ports.kill']({ port: port.port })}
              class="kill-button"
              side="left"
              danger
              disabled={port.protected || killingPort !== null}
              onclick={() => (pendingKill = port)}
            >
              <CircleStop size={14} />
            </HeaderIconButton>
          {/if}
        </section>
      {/each}
    </div>
    {#if error}<p class="refresh-error" role="status">{error}</p>{/if}
  {/if}

  <footer>{m['ports.scope_note']()}</footer>
</SidePanel>

<AlertDialog.Root open={pendingKill !== null} onOpenChange={(open) => !open && (pendingKill = null)}>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>{m['ports.confirm_title']({ port: pendingKill?.port ?? 0 })}</AlertDialog.Title>
      <AlertDialog.Description>
        {m['ports.confirm_description']({ process: pendingKill?.commands.join(', ') || m['ports.unknown_process']() })}
      </AlertDialog.Description>
    </AlertDialog.Header>
    <AlertDialog.Footer>
      <AlertDialog.Cancel>{m['ports.cancel']()}</AlertDialog.Cancel>
      <AlertDialog.Action variant="destructive" disabled={killingPort !== null} onclick={confirmKill}>
        {killingPort !== null ? m['ports.killing']() : m['ports.confirm']()}
      </AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>

<style>
  .port-topline,
  .port-number,
  .protected-badge {
    display: flex;
    align-items: center;
  }

  .port-topline {
    justify-content: space-between;
  }

  .refresh-error,
  footer {
    margin: 0;
    font-size: 11px;
    line-height: 1.45;
    color: var(--app-text-muted);
  }

  .port-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .port-card {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 9px;
    padding: 10px;
    border: 1px solid var(--app-border);
    border-radius: 8px;
    background: var(--app-surface-subtle);
  }

  .port-card:has(:global(.kill-button)) {
    padding-right: 42px;
  }

  .port-skeleton {
    gap: 8px;
  }

  .port-number {
    min-width: 0;
    gap: 6px;
  }

  .port-number strong {
    color: var(--app-text);
    font: 600 14px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
    font-variant-numeric: tabular-nums;
  }

  .status-dot {
    width: 7px;
    height: 7px;
    flex: 0 0 auto;
    border-radius: 50%;
    background: var(--app-text-muted);
  }

  .status-dot.listening {
    background: var(--app-success);
    box-shadow: 0 0 8px rgba(61, 214, 140, 0.55);
  }

  .status-label {
    font-size: 10px;
    color: var(--app-text-muted);
  }

  .status-label.listening {
    color: var(--app-success);
  }

  .protected-badge {
    gap: 4px;
    padding: 2px 6px;
    border: 1px solid color-mix(in srgb, var(--app-secondary) 32%, var(--app-border));
    border-radius: 999px;
    color: var(--app-secondary);
    font-size: 9px;
    font-weight: 600;
    text-transform: uppercase;
  }

  .portal-list {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }

  .portal-row,
  .process-row {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .portal-row span,
  .process-row span {
    overflow: hidden;
    color: var(--app-text-soft);
    font-size: 11px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  code {
    overflow: hidden;
    color: var(--app-text-muted);
    font: 10px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  :global(.kill-button) {
    position: absolute;
    right: 8px;
    bottom: 8px;
    width: 27px;
    height: 27px;
    display: grid;
    place-items: center;
    border: 1px solid rgba(229, 72, 77, 0.3);
    border-radius: 6px;
    background: rgba(229, 72, 77, 0.08);
    color: var(--app-danger);
  }

  :global(.kill-button:hover:not(:disabled)) {
    border-color: rgba(229, 72, 77, 0.58);
    background: rgba(229, 72, 77, 0.18);
  }

  :global(.kill-button:focus-visible),
  .panel-state button:focus-visible {
    outline: 2px solid var(--app-accent);
    outline-offset: 2px;
  }

  :global(.kill-button:disabled) {
    cursor: not-allowed;
    opacity: 0.4;
  }

  .panel-state {
    min-height: 150px;
    padding: 20px 12px;
    display: grid;
    place-items: center;
    align-content: center;
    gap: 8px;
    color: var(--app-text-muted);
    text-align: center;
  }

  .panel-state p {
    margin: 0;
    font-size: 11px;
    line-height: 1.45;
  }

  .panel-state.error {
    color: var(--app-warning);
  }

  .panel-state button {
    border: 1px solid var(--app-border);
    border-radius: 6px;
    padding: 5px 9px;
    background: var(--app-border);
    color: var(--app-text-soft);
    font: inherit;
    cursor: pointer;
  }

  .refresh-error {
    color: var(--app-warning);
  }

  footer {
    margin-top: auto;
    padding-top: 8px;
    text-align: center;
    color: var(--app-text-muted);
  }

  :global(.spinning) {
    animation: ports-spin 800ms linear infinite;
  }

  @keyframes ports-spin {
    to { transform: rotate(360deg); }
  }

  @media (prefers-reduced-motion: reduce) {
    :global(.spinning) { animation: none; }
  }
</style>
