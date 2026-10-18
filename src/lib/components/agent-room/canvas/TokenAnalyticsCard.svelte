<script lang="ts">
  import { RefreshCw } from '@lucide/svelte';
  import AgentAvatar from '../AgentAvatar.svelte';
  import { getLocale } from '$lib/paraglide/runtime.js';
  import type { TokenAnalytics, TokenCounts } from '$lib/modules/agent-room/application/services/TokenAnalyticsService.js';
  import * as m from '$lib/paraglide/messages.js';

  /** Tokens by day (stacked by CLI) and by agent, from local session logs. */
  let { workspaceId = null, days = 30 }: { workspaceId?: string | null; days?: number } = $props();

  type Mode = 'all' | 'in_out' | 'output';
  const COLORS = { claude: '#f0883e', codex: '#7cbff0' } as const;

  let data = $state<TokenAnalytics | null>(null);
  let loading = $state(false);
  let failed = $state(false);
  let mode = $state<Mode>('all');

  async function load() {
    loading = true;
    failed = false;
    const params = new URLSearchParams({ days: String(days) });
    if (workspaceId) params.set('workspaceId', workspaceId);
    const response = await fetch(`/api/agent-room/usage/tokens?${params}`, { cache: 'no-store' }).catch(() => null);
    const body = response?.ok ? await response.json().catch(() => null) as { data?: TokenAnalytics } | null : null;
    loading = false;
    if (body?.data) data = body.data;
    else failed = true;
  }

  $effect(() => {
    void workspaceId;
    void load();
  });

  function value(counts: TokenCounts): number {
    if (mode === 'output') return counts.output;
    if (mode === 'in_out') return counts.input + counts.output;
    return counts.input + counts.output + counts.cached;
  }

  const series = $derived.by(() => {
    const dates: string[] = [];
    const end = new Date();
    for (let index = days - 1; index >= 0; index -= 1) {
      const date = new Date(end.getFullYear(), end.getMonth(), end.getDate() - index);
      dates.push(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`);
    }
    return dates.map((date) => {
      const claude = data?.days.find((day) => day.date === date && day.provider === 'claude');
      const codex = data?.days.find((day) => day.date === date && day.provider === 'codex');
      return { date, claude: claude ? value(claude) : 0, codex: codex ? value(codex) : 0 };
    });
  });
  const peak = $derived(Math.max(1, ...series.map((day) => day.claude + day.codex)));
  const total = $derived(series.reduce((sum, day) => sum + day.claude + day.codex, 0));
  const agentPeak = $derived(Math.max(1, ...(data?.agents ?? []).map((agent) => value(agent))));

  function compact(amount: number): string {
    return new Intl.NumberFormat(getLocale(), { notation: 'compact', maximumFractionDigits: 1 }).format(amount);
  }

  function dayName(date: string): string {
    const [year, month, day] = date.split('-').map(Number);
    return new Intl.DateTimeFormat(getLocale(), { day: 'numeric', month: 'short' }).format(new Date(year, month - 1, day));
  }
</script>

<section class="tokens" data-testid="token-analytics">
  <header>
    <h4>{m['tokens.title']({ days })}</h4>
    <button type="button" class="refresh" aria-label={m['tokens.refresh']()} title={m['tokens.refresh']()} onclick={() => void load()}><RefreshCw size={13} class={loading ? 'animate-spin' : undefined} /></button>
  </header>
  <div class="modes" role="radiogroup" aria-label={m['tokens.title']({ days })}>
    {#each [['all', m['tokens.all']()], ['in_out', m['tokens.in_out']()], ['output', m['tokens.output']()]] as [key, label] (key)}
      <button type="button" role="radio" aria-checked={mode === key} class:on={mode === key} onclick={() => (mode = key as Mode)}>{label}</button>
    {/each}
  </div>

  {#if failed}
    <p class="hint">{m['tokens.failed']()}</p>
  {:else if !data && loading}
    <p class="hint">{m['tokens.loading']()}</p>
  {:else if data}
    {#if total === 0}
      <p class="hint">{m['tokens.empty']()}</p>
    {:else}
      <p class="total">{m['tokens.total']({ value: compact(total) })}</p>
      <div class="chart" role="img" aria-label={m['tokens.total']({ value: compact(total) })}>
        {#each series as day (day.date)}
          {@const sum = day.claude + day.codex}
          <div class="bar" title={m['tokens.day_label']({ date: dayName(day.date), value: compact(sum) })}>
            <span class="seg" style:height={`${(day.codex / peak) * 100}%`} style:background={COLORS.codex}></span>
            <span class="seg" style:height={`${(day.claude / peak) * 100}%`} style:background={COLORS.claude}></span>
          </div>
        {/each}
      </div>
      <div class="axis"><span>{dayName(series[0].date)}</span><span>{dayName(series[series.length - 1].date)}</span></div>
      <div class="legend">
        <span><i style:background={COLORS.claude}></i>Claude · {compact(value(data.totals.claude))}</span>
        <span><i style:background={COLORS.codex}></i>Codex · {compact(value(data.totals.codex))}</span>
      </div>
      {#if data.agents.length}
        <p class="label">{m['tokens.by_agent']()}</p>
        {#each data.agents.slice(0, 8) as agent (agent.nodeId)}
          <div class="agent">
            <AgentAvatar nodeId={agent.nodeId} title={agent.title} size={18} />
            <span class="name">{agent.title}</span>
            <span class="amount">{compact(value(agent))}</span>
            <span class="track"><span style:width={`${(value(agent) / agentPeak) * 100}%`} style:background={COLORS[agent.provider]}></span></span>
          </div>
        {/each}
      {/if}
    {/if}
    <p class="source">{m['tokens.source']({ count: data.scannedFiles })}</p>
  {/if}
</section>

<style>
  .tokens {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px;
    border-radius: 12px;
    background: var(--app-surface);
    box-shadow: var(--app-shadow-border);
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  h4 {
    margin: 0;
    font-size: 12.5px;
    font-weight: 600;
  }

  .refresh {
    width: 24px;
    height: 24px;
    display: grid;
    place-items: center;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--app-text-muted);
  }

  .refresh:hover {
    background: var(--app-hover);
    color: var(--app-text);
  }

  .modes {
    display: flex;
    gap: 4px;
  }

  .modes button {
    height: 24px;
    padding: 0 9px;
    border: 1px solid var(--app-border);
    border-radius: 999px;
    background: transparent;
    color: var(--app-text-soft);
    font-size: 11.5px;
  }

  .modes button.on {
    border-color: transparent;
    background: var(--app-accent);
    color: var(--app-accent-contrast);
    font-weight: 600;
  }

  .total {
    margin: 2px 0 0;
    font-family: var(--font-headline);
    font-stretch: 62%;
    font-size: 26px;
    font-weight: 700;
    line-height: 1;
  }

  .chart {
    height: 96px;
    display: flex;
    align-items: flex-end;
    gap: 2px;
  }

  .bar {
    flex: 1;
    height: 100%;
    display: flex;
    flex-direction: column-reverse;
    border-radius: 2px;
    overflow: hidden;
  }

  .bar:hover {
    filter: brightness(1.2);
  }

  .seg {
    display: block;
    width: 100%;
  }

  .axis {
    display: flex;
    justify-content: space-between;
    color: var(--app-text-muted);
    font-size: 11px;
  }

  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    color: var(--app-text-soft);
    font-size: 11.5px;
  }

  .legend span {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  .legend i {
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }

  .label {
    margin: 6px 0 0;
    color: var(--app-text-muted);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }

  .agent {
    display: grid;
    grid-template-columns: 18px minmax(0, 1fr) auto;
    grid-template-rows: auto 4px;
    column-gap: 8px;
    row-gap: 3px;
    align-items: center;
  }

  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12px;
  }

  .amount {
    color: var(--app-text-soft);
    font-family: var(--font-mono);
    font-size: 11px;
  }

  .track {
    grid-column: 2 / 4;
    height: 4px;
    border-radius: 2px;
    background: color-mix(in srgb, var(--app-text) 8%, transparent);
    overflow: hidden;
  }

  .track span {
    display: block;
    height: 100%;
    border-radius: 2px;
  }

  .hint,
  .source {
    margin: 0;
    color: var(--app-text-muted);
    font-size: 11.5px;
    line-height: 1.5;
  }

  button:focus-visible {
    outline: 2px solid var(--app-accent);
    outline-offset: 1px;
  }
</style>
