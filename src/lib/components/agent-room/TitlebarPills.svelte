<script lang="ts">
  import { onMount } from 'svelte';
  import { getLocale } from '$lib/paraglide/runtime.js';
  import * as Tooltip from '$lib/components/ui/tooltip';
  import { agentStatus } from './agent-status.svelte.js';
  import { retainUsageFeed, usageStore } from './usage-store.svelte.js';
  import { usageSeverity } from '$lib/modules/agent-room/domain/usage.js';
  import { usageProviderDefinition } from '$lib/modules/agent-room/domain/usage-providers.js';
  import { workspaceContext } from './workspace-context.svelte.js';
  import { runCanvasAction } from './canvas-actions.js';
  import * as m from '$lib/paraglide/messages.js';

  /** "Live" teammates and the tightest usage window, as two quiet pills. */
  onMount(retainUsageFeed);

  const counts = $derived.by(() => {
    const agents = Object.values(agentStatus.agents);
    const working = agents.filter((agent) => agent.state === 'working' || agent.state === 'starting').length;
    const attention = agents.filter((agent) => agent.state === 'waiting_input' || agent.state === 'waiting_permission' || agent.state === 'blocked' || agent.state === 'error').length;
    const live = agents.filter((agent) => agent.state !== 'disconnected').length;
    return { working, attention, live, idle: Math.max(0, live - working - attention) };
  });

  const tightest = $derived.by(() => {
    let best: { provider: string; percent: number; resetsAt: string | null } | null = null;
    for (const usage of usageStore.values) {
      if (usage.error) continue;
      for (const window of usage.windows) {
        if (!best || window.usedPercent > best.percent) best = { provider: usage.provider, percent: Math.round(window.usedPercent), resetsAt: window.resetsAt };
      }
    }
    return best;
  });

  function resetLabel(value: string | null): string {
    if (!value) return '—';
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '—';
    const sameDay = date.toDateString() === new Date().toDateString();
    return new Intl.DateTimeFormat(getLocale(), sameDay ? { hour: '2-digit', minute: '2-digit' } : { weekday: 'short', hour: '2-digit', minute: '2-digit' }).format(date);
  }

  function tone(percent: number): string {
    const severity = usageSeverity(percent);
    if (severity === 'danger') return 'var(--app-danger)';
    if (severity === 'warning') return 'var(--app-warning)';
    return 'var(--app-success)';
  }
</script>

{#if workspaceContext.workspaceId && agentStatus.loaded}
  <Tooltip.Root>
    <Tooltip.Trigger>
      {#snippet child({ props })}
        <button {...props} type="button" class="pill" data-testid="topbar-live" aria-label={m['topbar.live_detail']({ working: counts.working, attention: counts.attention, idle: counts.idle })} onclick={() => runCanvasAction('mission-map', workspaceContext.workspaceId)}>
          <span class="live-dot" class:on={counts.working > 0} class:warn={counts.attention > 0 && counts.working === 0} aria-hidden="true"></span>
          <span class="mono">{m['topbar.live']({ count: counts.live })}</span>
        </button>
      {/snippet}
    </Tooltip.Trigger>
    <Tooltip.Content side="bottom">{m['topbar.live_detail']({ working: counts.working, attention: counts.attention, idle: counts.idle })}</Tooltip.Content>
  </Tooltip.Root>
{/if}

{#if tightest}
  {@const meta = usageProviderDefinition(tightest.provider)}
  <Tooltip.Root>
    <Tooltip.Trigger>
      {#snippet child({ props })}
        <button {...props} type="button" class="pill" data-testid="topbar-usage" aria-label={m['topbar.usage_detail']({ provider: meta.name, percent: tightest.percent, time: resetLabel(tightest.resetsAt) })} onclick={() => runCanvasAction('usage', workspaceContext.workspaceId)}>
          <span class="ring" style:--pct={`${Math.min(100, Math.max(0, tightest.percent))}%`} style:--tone={tone(tightest.percent)} aria-hidden="true"></span>
          {#if meta.icon}<img src={meta.icon} width="12" height="12" alt="" class="logo" />{/if}
          <span class="mono strong">{tightest.percent}%</span>
          <span class="mono soft">{m['topbar.usage_resets']({ time: resetLabel(tightest.resetsAt) })}</span>
        </button>
      {/snippet}
    </Tooltip.Trigger>
    <Tooltip.Content side="bottom">{m['topbar.usage_detail']({ provider: meta.name, percent: tightest.percent, time: resetLabel(tightest.resetsAt) })}</Tooltip.Content>
  </Tooltip.Root>
{/if}

<style>
  .pill {
    height: 26px;
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 0 10px;
    border: 1px solid var(--app-glass-line);
    border-radius: 999px;
    background: color-mix(in srgb, var(--app-surface) 50%, transparent);
    color: var(--app-text-soft);
    white-space: nowrap;
    transition: background-color var(--duration-quick) ease-out, border-color var(--duration-quick) ease-out, color var(--duration-quick) ease-out;
  }

  .pill:hover {
    background: var(--app-hover);
    color: var(--app-text);
  }

  .mono {
    font-family: var(--font-mono);
    font-size: 11.5px;
    font-variant-numeric: tabular-nums;
  }

  .strong {
    color: var(--app-text);
    font-weight: 600;
  }

  .soft {
    color: var(--app-text-muted);
  }

  .live-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--app-text-muted);
  }

  .live-dot.on {
    background: var(--app-success);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--app-success) 22%, transparent);
    animation: live-pulse 2.4s ease-in-out infinite;
  }

  .live-dot.warn {
    background: var(--app-warning);
  }

  @keyframes live-pulse {
    50% { box-shadow: 0 0 0 5px color-mix(in srgb, var(--app-success) 6%, transparent); }
  }

  .ring {
    width: 13px;
    height: 13px;
    border-radius: 50%;
    background: conic-gradient(var(--tone) var(--pct), color-mix(in srgb, var(--app-text) 14%, transparent) 0);
    -webkit-mask: radial-gradient(circle, transparent 3.4px, #000 3.6px);
    mask: radial-gradient(circle, transparent 3.4px, #000 3.6px);
  }

  .logo {
    border-radius: 3px;
  }

  @media (max-width: 1180px) {
    .soft {
      display: none;
    }
  }
</style>
