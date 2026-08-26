<script lang="ts">
  import { onMount } from 'svelte';
  import { Bot, ExternalLink, PanelTopOpen, RefreshCw, TriangleAlert, X } from '@lucide/svelte';
  import HeaderIconButton from './HeaderIconButton.svelte';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import * as m from '$lib/paraglide/messages.js';
  import { localeState } from '$lib/i18n/locale.svelte.js';
  import { usageSeverity } from '$lib/modules/agent-room/domain/usage.js';
  import { usageRoutingId } from '$lib/modules/agent-room/domain/usage-routing.js';
  import type { UsageWindow } from '$lib/modules/agent-room/application/services/UsageService.js';
  import { USAGE_PROVIDERS, usageProviderDefinition, type UsageDiagnostic } from '$lib/modules/agent-room/domain/usage-providers.js';
  import { refreshUsage, retainUsageFeed, usageStore } from '../usage-store.svelte.js';
  import { usageErrorText } from '../usage-i18n.js';

  type Props = {
    onClose: () => void;
    onAddToCanvas?: () => void;
  };

  let { onClose, onAddToCanvas }: Props = $props();

  const usages = $derived(usageStore.values);
  const loading = $derived(usageStore.loading);
  const lastFetchAt = $derived(usageStore.lastFetchAt);

  function barColor(percent: number): string {
    const severity = usageSeverity(percent);
    if (severity === 'danger') return 'var(--app-danger)';
    if (severity === 'warning') return 'var(--app-warning)';
    return 'var(--app-success)';
  }

  function resetText(resetsAt: string | null): string {
    if (!resetsAt) return '';
    const target = new Date(resetsAt).getTime();
    const diffMs = target - Date.now();
    if (diffMs <= 0) return m['usage.resetting']();
    const minutes = Math.floor(diffMs / 60_000);
    if (minutes < 60) return m['usage.reset_minutes']({ minutes });
    const hours = Math.floor(minutes / 60);
    if (hours < 48) return m['usage.reset_hours']({ hours, minutes: String(minutes % 60).padStart(2, '0') });
    const locale = localeState.current === 'en' ? 'en-US' : localeState.current === 'es' ? 'es-MX' : 'pt-BR';
    const date = new Date(resetsAt);
    return m['usage.reset_at']({
      date: date.toLocaleDateString(locale, { day: '2-digit', month: '2-digit' }),
      time: date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }),
    });
  }

  function updatedText(): string {
    void clock;
    if (!lastFetchAt) return '';
    const seconds = Math.max(0, Math.floor((Date.now() - lastFetchAt.getTime()) / 1000));
    return seconds < 5 ? m['usage.just_now']() : m['usage.seconds_ago']({ seconds });
  }

  /** Labels das janelas vem do backend fixos em pt-BR; aqui localizamos por kind. */
  function windowLabel(win: UsageWindow): string {
    if (win.kind === '5h') return m['usage.window_5h']();
    if (win.kind === 'weekly') return m['usage.window_weekly']();
    if (win.kind === 'monthly') return m['usage.window_monthly']();
    return win.label;
  }

  function diagnosticText(diagnostic: UsageDiagnostic): string {
    if (diagnostic === 'provider_cli_only') return m['usage.diagnostic_cli_only']();
    if (diagnostic === 'admin_api_required') return m['usage.diagnostic_admin_api']();
    if (diagnostic === 'enterprise_api_required') return m['usage.diagnostic_enterprise_api']();
    return m['usage.diagnostic_model_provider']();
  }

  // Tick de 5s so para re-renderizar os textos relativos (reseta em / ha Xs).
  let clock = $state(0);

  onMount(() => {
    const release = retainUsageFeed();
    const ticker = setInterval(() => (clock += 1), 5_000);
    return () => {
      release();
      clearInterval(ticker);
    };
  });
</script>

<aside class="usage-panel">
  <header class="panel-header">
    <h3>{m['usage.title']()}</h3>
    <div class="panel-actions">
      {#if onAddToCanvas}
        <HeaderIconButton label={m['usage.add_canvas']()} class="node-action-btn" side="left" onclick={onAddToCanvas}>
          <PanelTopOpen size={13} />
        </HeaderIconButton>
      {/if}
      <HeaderIconButton label={m['usage.refresh']()} class="node-action-btn" side="left" onclick={() => void refreshUsage(true)}>
        <RefreshCw size={13} />
      </HeaderIconButton>
      <HeaderIconButton label={m['usage.close']()} class="node-action-btn" side="left" onclick={onClose}>
        <X size={13} />
      </HeaderIconButton>
    </div>
  </header>

  {#if loading && !usages.length}
    {#each USAGE_PROVIDERS as provider (provider.id)}
      <section class="usage-card usage-skeleton" aria-hidden="true">
        <div class="usage-card-header">
          <Skeleton class="h-4 w-4 rounded-full bg-[var(--app-surface-raised)]" />
          <Skeleton class="h-3.5 w-20 bg-[var(--app-surface-raised)]" />
        </div>
        <Skeleton class="h-2.5 w-full bg-[var(--app-surface-raised)]" />
        <Skeleton class="h-2.5 w-3/4 bg-[var(--app-surface-raised)]" />
      </section>
    {/each}
  {/if}

  {#each usages as usage (usageRoutingId(usage))}
    {@const meta = usageProviderDefinition(usage.provider)}
    <section class="usage-card">
      <div class="usage-card-header">
        {#if meta.icon}<img src={meta.icon} width="18" height="18" alt="" class="provider-icon" />{:else}<Bot size={18} class="text-[var(--app-text-muted)]" aria-hidden="true" />{/if}
        <span class="provider-name">{meta.name}{#if usage.profileName} · {usage.profileName}{/if}</span>
        {#if usage.plan}<span class="plan-badge">{usage.plan}</span>{/if}
      </div>

      {#if usage.error}
        <p class="usage-error"><TriangleAlert size={12} /> {usageErrorText(usage.error, meta.name)}</p>
      {:else if usage.diagnostic}
        <div class="usage-diagnostic">
          <p>{diagnosticText(usage.diagnostic)}</p>
          {#if usage.helpUrl}
            <a href={usage.helpUrl} target="_blank" rel="noreferrer">{m['usage.official_docs']()} <ExternalLink size={11} aria-hidden="true" /></a>
          {/if}
        </div>
      {:else if !usage.windows.length}
        <p class="hint">{m['usage.no_windows']()}</p>
      {:else}
        {#each usage.windows as win (win.kind)}
          <div class="window-row">
            <div class="window-top">
              <span class="window-label">{windowLabel(win)}</span>
              <span class="window-percent" style:color={barColor(win.usedPercent)}>{win.usedPercent}%</span>
            </div>
            <div class="bar-track">
              <div
                class="bar-fill"
                style:width="{win.usedPercent}%"
                style:background={barColor(win.usedPercent)}
              ></div>
            </div>
            {#if win.resetsAt}<span class="window-reset">{resetText(win.resetsAt)}</span>{/if}
          </div>
        {/each}
      {/if}
    </section>
  {/each}

  {#if lastFetchAt}
    <footer class="panel-footer">{m['usage.updated']({ when: updatedText() })} · {m['usage.refresh_interval']()}</footer>
  {/if}
</aside>

<style>
  .usage-panel {
    width: 320px;
    flex-shrink: 0;
    border-left: 1px solid var(--app-border);
    background: var(--app-sidebar);
    padding: 14px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .panel-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .panel-header h3 {
    margin: 0;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0;
    color: var(--app-text-muted);
  }

  .panel-actions {
    display: flex;
    gap: 4px;
  }
  .usage-skeleton {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .usage-card {

    border: 1px solid var(--app-border);
    border-radius: 7px;
    padding: 11px;
    background: var(--app-surface-subtle);
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .usage-card-header {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .provider-icon {
    border-radius: 4px;
  }

  .usage-diagnostic {
    display: grid;
    gap: 7px;
    font-size: 11px;
    line-height: 1.45;
    color: var(--app-text-muted);
  }

  .usage-diagnostic p { margin: 0; }

  .usage-diagnostic a {
    display: inline-flex;
    width: fit-content;
    align-items: center;
    gap: 4px;
    color: var(--app-accent);
    font-weight: 600;
    text-decoration: none;
  }

  .usage-diagnostic a:hover { text-decoration: underline; }

  .provider-name {
    font-size: 13px;
    font-weight: 600;
    color: var(--app-text);
  }

  .plan-badge {
    margin-left: auto;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0;
    text-transform: uppercase;
    color: var(--app-accent);
    background: color-mix(in srgb, var(--app-accent) 15%, transparent);
    border: 1px solid color-mix(in srgb, var(--app-accent) 35%, transparent);
    border-radius: 999px;
    padding: 2px 8px;
  }

  .window-row {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .window-top {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
  }

  .window-label {
    font-size: 11px;
    color: var(--app-text-muted);
  }

  .window-percent {
    font-size: 12px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }

  .bar-track {
    height: 6px;
    border-radius: 999px;
    background: var(--app-border);
    overflow: hidden;
  }

  .bar-fill {
    height: 100%;
    border-radius: 999px;
    transition: width 600ms ease;
  }

  .window-reset {
    font-size: 10px;
    color: var(--app-text-muted);
  }

  .usage-error {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0;
    font-size: 11px;
    line-height: 1.4;
    color: var(--app-warning);
  }

  .hint {
    margin: 0;
    font-size: 11px;
    color: var(--app-text-muted);
  }

  .panel-footer {
    margin-top: auto;
    font-size: 10px;
    color: var(--app-text-muted);
    text-align: center;
  }
</style>
