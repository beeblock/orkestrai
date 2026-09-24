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

  // Diagnosticos longos ficam recolhidos em 3 linhas; o usuario expande.
  let expandedDiagnostics = $state<Set<string>>(new Set());

  function toggleDiagnostic(key: string) {
    const next = new Set(expandedDiagnostics);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    expandedDiagnostics = next;
  }

  // "Ler mais" so aparece quando o texto realmente foi cortado.
  let clampedDiagnostics = $state<Set<string>>(new Set());

  function trackClamp(node: HTMLElement, key: string) {
    const check = () => {
      if (expandedDiagnostics.has(key)) return;
      const cut = node.scrollHeight > node.clientHeight + 1;
      if (cut === clampedDiagnostics.has(key)) return;
      const next = new Set(clampedDiagnostics);
      if (cut) next.add(key);
      else next.delete(key);
      clampedDiagnostics = next;
    };
    const observer = new ResizeObserver(check);
    observer.observe(node);
    check();
    return { destroy: () => observer.disconnect() };
  }

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
        <HeaderIconButton label={m['usage.add_canvas']()} class="panel-btn" side="left" onclick={onAddToCanvas}>
          <PanelTopOpen size={14} />
        </HeaderIconButton>
      {/if}
      <HeaderIconButton label={m['usage.refresh']()} class="panel-btn" side="left" onclick={() => void refreshUsage(true)}>
        <RefreshCw size={14} class={loading ? 'animate-spin' : undefined} />
      </HeaderIconButton>
      <HeaderIconButton label={m['usage.close']()} class="panel-btn" side="left" onclick={onClose}>
        <X size={14} />
      </HeaderIconButton>
    </div>
  </header>

  {#if loading && !usages.length}
    {#each USAGE_PROVIDERS as provider (provider.id)}
      <section class="usage-card usage-skeleton" aria-hidden="true">
        <div class="usage-card-header">
          <Skeleton class="size-6 rounded-md bg-[var(--app-surface-raised)]" />
          <Skeleton class="h-3.5 w-24 bg-[var(--app-surface-raised)]" />
        </div>
        <Skeleton class="h-1.5 w-full bg-[var(--app-surface-raised)]" />
        <Skeleton class="h-1.5 w-2/3 bg-[var(--app-surface-raised)]" />
      </section>
    {/each}
  {/if}

  {#each usages as usage (usageRoutingId(usage))}
    {@const meta = usageProviderDefinition(usage.provider)}
    {@const key = usageRoutingId(usage)}
    {@const fullName = usage.profileName ? `${meta.name} · ${usage.profileName}` : meta.name}
    <section class="usage-card">
      <div class="usage-card-header">
        {#if meta.icon}<img src={meta.icon} width="18" height="18" alt="" class="provider-icon app-logo-plate" />{:else}<span class="provider-icon provider-fallback" aria-hidden="true"><Bot size={16} /></span>{/if}
        <span class="provider-name" title={fullName}>{fullName}</span>
        {#if usage.plan}<span class="plan-badge" title={usage.plan}>{usage.plan}</span>{/if}
      </div>

      {#if usage.error}
        <p class="usage-error"><TriangleAlert size={13} aria-hidden="true" /> <span>{usageErrorText(usage.error, meta.name)}</span></p>
      {:else if usage.diagnostic}
        {@const open = expandedDiagnostics.has(key)}
        <div class="usage-diagnostic">
          <p class:clamped={!open} use:trackClamp={key}>{diagnosticText(usage.diagnostic)}</p>
          <div class="diagnostic-actions">
            {#if open || clampedDiagnostics.has(key)}
              <button type="button" class="diagnostic-toggle" aria-expanded={open} onclick={() => toggleDiagnostic(key)}>
                {open ? m['docs.read_less']() : m['docs.read_more']()}
              </button>
            {/if}
            {#if usage.helpUrl}
              <a href={usage.helpUrl} target="_blank" rel="noreferrer">{m['usage.official_docs']()} <ExternalLink size={12} aria-hidden="true" /></a>
            {/if}
          </div>
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
            <div
              class="bar-track"
              role="progressbar"
              aria-label={`${windowLabel(win)} ${win.usedPercent}%`}
              aria-valuemin="0"
              aria-valuemax="100"
              aria-valuenow={win.usedPercent}
            >
              <div
                class="bar-fill"
                style:width="{Math.min(100, Math.max(0, win.usedPercent))}%"
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
    display: flex;
    width: 320px;
    flex-shrink: 0;
    flex-direction: column;
    gap: 8px;
    padding: 12px;
    overflow-y: auto;
    border-left: 1px solid var(--app-border);
    background: var(--app-sidebar);
  }

  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    min-height: 32px;
    margin-bottom: 4px;
  }

  .panel-header h3 {
    margin: 0;
    color: var(--app-text);
    font-size: 13px;
    font-weight: 600;
  }

  .panel-actions {
    display: flex;
    gap: 2px;
  }

  /* Acoes do painel: mesmos 26px/raio 6 dos cabecalhos de no. */
  .panel-actions :global(.panel-btn) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    padding: 0;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--app-text-muted);
    cursor: pointer;
    transition: background-color var(--duration-quick) ease-out, color var(--duration-quick) ease-out, transform var(--duration-quick) var(--ease-smooth-out);
  }

  .panel-actions :global(.panel-btn:hover) {
    background: var(--app-hover);
    color: var(--app-text);
  }

  .panel-actions :global(.panel-btn:active) {
    transform: scale(var(--scale-press));
  }

  .panel-actions :global(.panel-btn:focus-visible) {
    outline: 2px solid var(--app-accent);
    outline-offset: 1px;
  }

  .usage-card {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px;
    border-radius: 10px;
    background: var(--app-surface);
    box-shadow: var(--app-shadow-border);
  }

  .usage-skeleton {
    gap: 10px;
  }

  .usage-card-header {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 8px;
  }

  .provider-icon {
    box-sizing: content-box;
    flex-shrink: 0;
    padding: 3px;
    border-radius: 6px;
    /* Placa escura fixa: os logos em /images sao brancos (igual ao no de Uso). */
    background: var(--app-logo-plate);
  }

  .provider-fallback {
    display: grid;
    place-items: center;
    width: 18px;
    height: 18px;
    color: var(--app-text-muted);
  }

  .provider-name {
    min-width: 0;
    flex: 1;
    overflow: hidden;
    color: var(--app-text);
    font-size: 13px;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Plano e informacao, nao acao: chip neutro. */
  .plan-badge {
    max-width: 96px;
    flex-shrink: 0;
    overflow: hidden;
    padding: 0 8px;
    border-radius: 999px;
    background: var(--app-hover);
    color: var(--app-text-soft);
    font-size: 11px;
    font-weight: 500;
    line-height: 20px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .window-row {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .window-top {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
  }

  .window-label {
    color: var(--app-text-soft);
    font-size: 12px;
  }

  .window-percent {
    font-family: var(--font-mono);
    font-size: 12px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }

  .bar-track {
    height: 6px;
    overflow: hidden;
    border-radius: 999px;
    background: var(--app-hover);
  }

  .bar-fill {
    height: 100%;
    border-radius: 999px;
    transition: width var(--duration-slow) var(--ease-smooth-out);
  }

  .window-reset {
    color: var(--app-text-muted);
    font-family: var(--font-mono);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
  }

  .usage-error {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    margin: 0;
    color: var(--app-warning);
    font-size: 12px;
    line-height: 1.5;
    overflow-wrap: anywhere;
    text-wrap: pretty;
  }

  .usage-error :global(svg) {
    flex-shrink: 0;
    margin-top: 2px;
  }

  .usage-diagnostic {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .usage-diagnostic p {
    margin: 0;
    color: var(--app-text-muted);
    font-size: 12px;
    line-height: 1.5;
    overflow-wrap: anywhere;
    text-wrap: pretty;
  }

  .usage-diagnostic p.clamped {
    display: -webkit-box;
    overflow: hidden;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
  }

  .diagnostic-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 12px;
  }

  .diagnostic-toggle,
  .usage-diagnostic a {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    min-height: 24px;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--app-text-soft);
    font-size: 11.5px;
    font-weight: 500;
    text-decoration: none;
    cursor: pointer;
    transition: color var(--duration-quick) ease-out;
  }

  .usage-diagnostic a {
    color: var(--app-secondary);
  }

  .diagnostic-toggle:hover {
    color: var(--app-text);
  }

  .usage-diagnostic a:hover {
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .diagnostic-toggle:focus-visible,
  .usage-diagnostic a:focus-visible {
    border-radius: 4px;
    outline: 2px solid var(--app-accent);
    outline-offset: 2px;
  }

  .hint {
    margin: 0;
    color: var(--app-text-muted);
    font-size: 12px;
  }

  .panel-footer {
    margin-top: auto;
    padding-top: 4px;
    color: var(--app-text-muted);
    font-size: 11px;
    text-align: center;
    font-variant-numeric: tabular-nums;
  }

  @media (prefers-reduced-motion: reduce) {
    .bar-fill {
      transition: none;
    }
  }
</style>
