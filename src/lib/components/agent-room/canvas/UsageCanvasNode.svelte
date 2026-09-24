<script lang="ts">
  import { onMount } from 'svelte';
  import type { NodeProps } from '@xyflow/svelte';
  import { Bot, CircleCheck, ExternalLink, Gauge, Info, RefreshCw, Route, TriangleAlert, X } from '@lucide/svelte';
  import * as Select from '$lib/components/ui/select';
  import { Switch } from '$lib/components/ui/switch';
  import { Slider } from '$lib/components/ui/slider';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import { SegmentedControl } from '$lib/components/ui/segmented';
  import NodeShell from './NodeShell.svelte';
  import HeaderIconButton from './HeaderIconButton.svelte';
  import * as m from '$lib/paraglide/messages.js';
  import { localeState } from '$lib/i18n/locale.svelte.js';
  import { usageSeverity } from '$lib/modules/agent-room/domain/usage.js';
  import {
    buildUsageRoutingReport,
    normalizeUsageRoutingPolicy,
    type ProviderUsageStatus,
  } from '$lib/modules/agent-room/domain/usage-routing.js';
  import type { UsageWindow, UsageWindowKind } from '$lib/modules/agent-room/application/services/UsageService.js';
  import { ROUTABLE_USAGE_PROVIDERS, usageProviderDefinition, type UsageDiagnostic } from '$lib/modules/agent-room/domain/usage-providers.js';
  import type { UsageNodePayload } from '$lib/modules/agent-room/domain/types.js';
  import { refreshUsage, retainUsageFeed, usageStore } from '../usage-store.svelte.js';
  import { usageErrorText } from '../usage-i18n.js';

  export type UsageNodeData = {
    title: string;
    payload: UsageNodePayload;
    onDelete: (id: string) => void;
    onResize?: (id: string, params: { x: number; y: number; width: number; height: number }) => void;
    onPayloadChange?: (id: string, partial: Record<string, unknown>) => void;
    connections?: import('./NodeShell.svelte').NodeConnection[];
    onJumpToNode?: (nodeId: string) => void;
    onRemoveConnection?: (edgeId: string) => void;
    onRename?: (id: string, title: string) => void;
  };

  let { id, data, selected } = $props<NodeProps & { data: UsageNodeData }>();

  const PROVIDERS = ROUTABLE_USAGE_PROVIDERS;

  const usages = $derived(usageStore.values);
  const loading = $derived(usageStore.loading);
  const lastFetchAt = $derived(usageStore.lastFetchAt);
  let clock = $state(0);

  const policy = $derived(normalizeUsageRoutingPolicy(data.payload));
  const report = $derived(buildUsageRoutingReport(usages, policy));

  /** Fonte/fallback do roteamento: a conta padrao de cada provider routavel,
      mais uma entrada por perfil de multi-conta (chaveada por routingId, nao
      por nome — trocar de conta na Central de Providers nunca quebra a
      politica salva). */
  const routingOptions = $derived([
    ...PROVIDERS.map((provider) => ({ id: provider.id, name: provider.name })),
    ...report.providers
      .filter((provider) => provider.profileId)
      .map((provider) => ({ id: provider.routingId, name: `${usageProviderDefinition(provider.provider).name} · ${provider.profileName}` })),
  ]);

  function persist(partial: Partial<UsageNodePayload>) {
    data.onPayloadChange?.(id, partial);
  }

  function otherOption(exclude: string): string {
    return routingOptions.find((option) => option.id !== exclude)?.id ?? exclude;
  }

  function changeSource(sourceProvider: string) {
    const fallbackProvider = sourceProvider === policy.fallbackProvider ? otherOption(sourceProvider) : policy.fallbackProvider;
    persist({ sourceProvider, fallbackProvider });
  }

  function changeFallback(fallbackProvider: string) {
    const sourceProvider = fallbackProvider === policy.sourceProvider ? otherOption(fallbackProvider) : policy.sourceProvider;
    persist({ sourceProvider, fallbackProvider });
  }

  function providerName(id: string): string {
    return routingOptions.find((option) => option.id === id)?.name ?? usageProviderDefinition(id).name;
  }

  function diagnosticText(diagnostic: UsageDiagnostic): string {
    if (diagnostic === 'provider_cli_only') return m['usage.diagnostic_cli_only']();
    if (diagnostic === 'admin_api_required') return m['usage.diagnostic_admin_api']();
    if (diagnostic === 'enterprise_api_required') return m['usage.diagnostic_enterprise_api']();
    return m['usage.diagnostic_model_provider']();
  }

  function statusLabel(status: ProviderUsageStatus): string {
    if (status === 'available') return m['usage.status_available']();
    if (status === 'near_limit') return m['usage.status_near_limit']();
    if (status === 'exhausted') return m['usage.status_exhausted']();
    return m['usage.status_unavailable']();
  }

  function statusColor(status: ProviderUsageStatus): string {
    if (status === 'available') return 'var(--app-success)';
    if (status === 'near_limit') return 'var(--app-warning)';
    if (status === 'exhausted') return 'var(--app-danger)';
    return 'var(--app-text-muted)';
  }

  function barColor(percent: number): string {
    const severity = usageSeverity(percent);
    if (severity === 'danger') return 'var(--app-danger)';
    if (severity === 'warning') return 'var(--app-warning)';
    return 'var(--app-success)';
  }

  function windowLabel(window: UsageWindow): string {
    return windowKindLabel(window.kind);
  }

  function windowKindLabel(kind: UsageWindowKind): string {
    if (kind === '5h') return m['usage.window_5h']();
    if (kind === 'weekly') return m['usage.window_weekly']();
    return m['usage.window_monthly']();
  }

  function resetText(resetsAt: string | null): string {
    if (!resetsAt) return '';
    const diffMs = new Date(resetsAt).getTime() - Date.now();
    if (diffMs <= 0) return m['usage.resetting']();
    const minutes = Math.floor(diffMs / 60_000);
    if (minutes < 60) return m['usage.reset_minutes']({ minutes });
    const hours = Math.floor(minutes / 60);
    if (hours < 48) return m['usage.reset_hours']({ hours, minutes: String(minutes % 60).padStart(2, '0') });
    const locale = localeState.current === 'en' ? 'en-US' : localeState.current === 'es' ? 'es-MX' : 'pt-BR';
    const date = new Date(resetsAt);
    return m['usage.reset_at']({
      date: new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit' }).format(date),
      time: new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(date),
    });
  }

  function updatedText(): string {
    void clock;
    if (!lastFetchAt) return '';
    const seconds = Math.max(0, Math.floor((Date.now() - lastFetchAt.getTime()) / 1000));
    return seconds < 5 ? m['usage.just_now']() : m['usage.seconds_ago']({ seconds });
  }

  // Limiar: o slider mostra o valor ao arrastar e so grava ao soltar (mesmo
  // persist que o range nativo fazia no change).
  let thresholdDrag = $state<number | null>(null);
  const thresholdValue = $derived(thresholdDrag ?? policy.thresholdPercent);

  function commitThreshold(value: number) {
    thresholdDrag = null;
    if (value !== policy.thresholdPercent) persist({ thresholdPercent: value });
  }

  const windowOptions = $derived([
    { value: '5h' as UsageWindowKind, label: m['usage.window_5h'](), disabled: !policy.enabled },
    { value: 'weekly' as UsageWindowKind, label: m['usage.window_weekly'](), disabled: !policy.enabled },
    { value: 'monthly' as UsageWindowKind, label: m['usage.window_monthly'](), disabled: !policy.enabled },
  ]);

  // Diagnosticos longos ficam recolhidos em 3 linhas; o usuario expande.
  let expandedDiagnostics = $state<Set<string>>(new Set());

  function toggleDiagnostic(routingId: string) {
    const next = new Set(expandedDiagnostics);
    if (next.has(routingId)) next.delete(routingId);
    else next.add(routingId);
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

<NodeShell
  {id}
  {selected}
  accent="var(--app-warning)"
  minWidth={380}
  minHeight={360}
  onResize={data.onResize}
  connections={data.connections}
  onJumpToNode={data.onJumpToNode}
  onRemoveConnection={data.onRemoveConnection}
  titleText={data.title}
  onRename={data.onRename}
  class="canvas-usage"
>
  {#snippet icon()}<Gauge size={14} />{/snippet}
  {#snippet title()}{data.title}{/snippet}
  {#snippet actions()}
    <HeaderIconButton label={m['usage.refresh']()} class="node-action-btn" side="left" onclick={() => void refreshUsage(true)}>
      <RefreshCw size={14} class={loading ? 'animate-spin' : undefined} />
    </HeaderIconButton>
    <HeaderIconButton label={m['settings.delete']()} class="node-action-btn danger" side="left" onclick={() => data.onDelete(id)}>
      <X size={14} />
    </HeaderIconButton>
  {/snippet}

  <!-- Keyboard focus is required so a compact scroll region supports PageUp/PageDown. -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <div
    class="usage-node-body nodrag nowheel"
    role="region"
    aria-label={m['usage.node_title']()}
    tabindex="0"
    onwheel={(event) => event.stopPropagation()}
  >
    <section class="routing-policy" class:off={!policy.enabled}>
      <header>
        <div class="routing-title">
          <span class="routing-icon" aria-hidden="true"><Route size={14} /></span>
          <strong>{m['usage.routing_title']()}</strong>
        </div>
        <label class="routing-toggle">
          <span>{policy.enabled ? m['usage.routing_enabled']() : m['usage.routing_disabled']()}</span>
          <Switch
            checked={policy.enabled}
            aria-label={policy.enabled ? m['usage.routing_enabled']() : m['usage.routing_disabled']()}
            onCheckedChange={(enabled: boolean) => persist({ enabled })}
          />
        </label>
      </header>

      <div class="routing-fields" class:disabled={!policy.enabled}>
        <label class="routing-field">
          <span class="field-label">{m['usage.routing_source']()}</span>
          <Select.Root type="single" value={policy.sourceProvider} disabled={!policy.enabled} onValueChange={changeSource}>
            <Select.Trigger size="sm" class="routing-select">{providerName(policy.sourceProvider)}</Select.Trigger>
            <Select.Content>
              {#each routingOptions as option (option.id)}<Select.Item value={option.id}>{option.name}</Select.Item>{/each}
            </Select.Content>
          </Select.Root>
        </label>
        <label class="routing-field">
          <span class="field-label">{m['usage.routing_fallback']()}</span>
          <Select.Root type="single" value={policy.fallbackProvider} disabled={!policy.enabled} onValueChange={changeFallback}>
            <Select.Trigger size="sm" class="routing-select">{providerName(policy.fallbackProvider)}</Select.Trigger>
            <Select.Content>
              {#each routingOptions as option (option.id)}<Select.Item value={option.id}>{option.name}</Select.Item>{/each}
            </Select.Content>
          </Select.Root>
        </label>
        <div class="routing-field window-field">
          <span class="field-label">{m['usage.routing_window']()}</span>
          <SegmentedControl
            options={windowOptions}
            value={policy.windowKind}
            onValueChange={(value: UsageWindowKind) => persist({ windowKind: value })}
            label={m['usage.routing_window']()}
            size="sm"
            fill
          />
        </div>
        <div class="routing-field threshold-field">
          <span class="field-label threshold-label">{m['usage.routing_threshold']({ percent: thresholdValue })}</span>
          <Slider
            type="single"
            min={50}
            max={100}
            step={5}
            value={thresholdValue}
            disabled={!policy.enabled}
            aria-label={m['usage.routing_threshold']({ percent: thresholdValue })}
            onValueChange={(value: number) => (thresholdDrag = value)}
            onValueCommit={commitThreshold}
            class="threshold-slider"
          />
        </div>
      </div>

      {#if policy.enabled}
        {@const sourceReport = report.providers.find((provider) => provider.routingId === policy.sourceProvider)}
        {@const warn = report.shouldFallback || sourceReport?.status === 'near_limit' || sourceReport?.status === 'exhausted'}
        {@const unknown = !report.shouldFallback && sourceReport?.status === 'unavailable'}
        <p class:recommendation={warn} class:unknown class="routing-result">
          {#if warn}<TriangleAlert size={14} aria-hidden="true" />{:else if unknown}<Info size={14} aria-hidden="true" />{:else}<CircleCheck size={14} aria-hidden="true" />{/if}
          <span>
            {#if report.shouldFallback}
              {m['usage.routing_recommendation']({ source: providerName(policy.sourceProvider), fallback: providerName(report.recommendedProvider ?? policy.fallbackProvider) })}
            {:else if sourceReport?.status === 'unavailable'}
              {m['usage.routing_window_unavailable']({ source: providerName(policy.sourceProvider), window: windowKindLabel(policy.windowKind) })}
            {:else if sourceReport?.status === 'near_limit' || sourceReport?.status === 'exhausted'}
              {m['usage.routing_no_fallback']({ source: providerName(policy.sourceProvider), fallback: providerName(policy.fallbackProvider), window: windowKindLabel(policy.windowKind) })}
            {:else}
              {m['usage.routing_healthy']({ source: providerName(policy.sourceProvider) })}
            {/if}
          </span>
        </p>
      {/if}
    </section>

    <div class="provider-list" aria-live="polite">
      {#if loading && !report.providers.length}
        {#each PROVIDERS as provider (provider.id)}
          <div class="provider-row loading-row" aria-hidden="true">
            <div class="provider-head">
              <Skeleton class="size-6 rounded-md bg-[var(--app-surface-raised)]" />
              <Skeleton class="h-3.5 w-24 bg-[var(--app-surface-raised)]" />
            </div>
            <Skeleton class="h-1.5 w-full bg-[var(--app-surface-raised)]" />
            <Skeleton class="h-1.5 w-2/3 bg-[var(--app-surface-raised)]" />
          </div>
        {/each}
      {/if}

      {#each report.providers as provider (provider.routingId)}
        {@const meta = usageProviderDefinition(provider.provider)}
        {@const fullName = provider.profileName ? `${meta.name} · ${provider.profileName}` : meta.name}
        <section class="provider-row" data-status={provider.status}>
          <div class="provider-head">
            {#if meta.icon}<img class="app-logo-plate" src={meta.icon} width="18" height="18" alt="" />{:else}<span class="provider-fallback" aria-hidden="true"><Bot size={16} /></span>{/if}
            <span class="provider-name">
              <strong title={fullName}>{fullName}</strong>
              <span class="provider-sub">
                <span class="status" style:--status-color={statusColor(provider.status)}>{statusLabel(provider.status)}</span>
                {#if provider.plan}<span class="plan" title={provider.plan}>{provider.plan}</span>{/if}
              </span>
            </span>
          </div>
          {#if provider.error}
            <p class="provider-error"><TriangleAlert size={13} aria-hidden="true" /><span>{usageErrorText(provider.error, meta.name)}</span></p>
          {:else if provider.diagnostic}
            {@const open = expandedDiagnostics.has(provider.routingId)}
            <div class="provider-diagnostic">
              <p class:clamped={!open} use:trackClamp={provider.routingId}>{diagnosticText(provider.diagnostic)}</p>
              <div class="diagnostic-actions">
                {#if open || clampedDiagnostics.has(provider.routingId)}
                  <button type="button" class="diagnostic-toggle" aria-expanded={open} onclick={() => toggleDiagnostic(provider.routingId)}>
                    {open ? m['docs.read_less']() : m['docs.read_more']()}
                  </button>
                {/if}
                {#if provider.helpUrl}
                  <a href={provider.helpUrl} target="_blank" rel="noreferrer">{m['usage.official_docs']()}<ExternalLink size={12} aria-hidden="true" /></a>
                {/if}
              </div>
            </div>
          {:else}
            <div class="windows">
              {#each provider.windows as window (window.kind)}
                <div class="window">
                  <div class="window-label">
                    <span>{windowLabel(window)}</span>
                    <strong style:color={barColor(window.usedPercent)}>{window.usedPercent}%</strong>
                  </div>
                  <div
                    class="bar"
                    role="progressbar"
                    aria-label={`${windowLabel(window)} ${window.usedPercent}%`}
                    aria-valuemin="0"
                    aria-valuemax="100"
                    aria-valuenow={window.usedPercent}
                  >
                    <span style:width={`${Math.min(100, Math.max(0, window.usedPercent))}%`} style:background={barColor(window.usedPercent)}></span>
                  </div>
                  {#if window.resetsAt}<small>{resetText(window.resetsAt)}</small>{/if}
                </div>
              {/each}
            </div>
          {/if}
        </section>
      {/each}
    </div>

    {#if lastFetchAt}<footer>{m['usage.updated']({ when: updatedText() })} · {m['usage.refresh_interval']()}</footer>{/if}
  </div>
</NodeShell>

<style>
  .usage-node-body {
    display: flex;
    flex: 1;
    width: 100%;
    height: 100%;
    min-height: 0;
    max-height: 100%;
    flex-direction: column;
    gap: 12px;
    overflow-x: hidden;
    overflow-y: auto;
    overscroll-behavior: contain;
    scrollbar-gutter: stable;
    scrollbar-width: thin;
    scrollbar-color: var(--app-border-strong) transparent;
    touch-action: pan-y;
    padding: 12px;
    color: var(--app-text);
  }

  .usage-node-body:focus-visible {
    outline: 2px solid color-mix(in srgb, var(--app-accent) 45%, transparent);
    outline-offset: -2px;
  }

  .usage-node-body::-webkit-scrollbar {
    width: 8px;
  }

  .usage-node-body::-webkit-scrollbar-track {
    background: transparent;
  }

  .usage-node-body::-webkit-scrollbar-thumb {
    border: 2px solid transparent;
    border-radius: 999px;
    background: var(--app-border-strong);
    background-clip: padding-box;
  }

  /* ---- Politica de roteamento ------------------------------------------- */
  .routing-policy {
    container-type: inline-size;
    display: flex;
    flex: none;
    flex-direction: column;
    gap: 12px;
    padding: 12px;
    border-radius: 10px;
    background: var(--app-surface-subtle);
    box-shadow: var(--app-shadow-border);
  }

  .routing-policy header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .routing-title {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 8px;
  }

  .routing-icon {
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    flex-shrink: 0;
    border-radius: 6px;
    background: var(--app-warning-soft);
    color: var(--app-warning);
    transition: background-color var(--duration-quick) ease-out, color var(--duration-quick) ease-out;
  }

  .routing-policy.off .routing-icon {
    background: var(--app-hover);
    color: var(--app-text-muted);
  }

  .routing-title strong {
    overflow: hidden;
    color: var(--app-text);
    font-size: 13px;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .routing-toggle {
    display: inline-flex;
    flex-shrink: 0;
    align-items: center;
    gap: 8px;
    color: var(--app-text-soft);
    font-size: 12px;
    cursor: pointer;
  }

  /* 2 colunas por padrao (origem|fallback, janela|limiar); 4 quando cabe. */
  .routing-fields {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
    transition: opacity var(--duration-quick) ease-out;
  }

  .routing-fields.disabled {
    opacity: 0.45;
    pointer-events: none;
  }

  .routing-field {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 6px;
  }

  .field-label {
    overflow: hidden;
    color: var(--app-text-muted);
    font-size: 11.5px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .threshold-label {
    color: var(--app-text-soft);
    font-variant-numeric: tabular-nums;
  }

  .routing-fields :global(.routing-select) {
    width: 100%;
    min-width: 0;
    height: 28px;
    border-color: var(--app-border);
    background: var(--app-surface);
    color: var(--app-text);
    font-size: 12px;
  }

  /* Slider alinhado ao centro da altura dos selects (28px). */
  .threshold-field :global(.threshold-slider) {
    height: 28px;
  }

  .routing-result {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    margin: 0;
    padding: 8px 10px;
    border-radius: 8px;
    background: var(--app-success-soft);
    color: var(--app-text-soft);
    font-size: 12px;
    line-height: 1.5;
    text-wrap: pretty;
  }

  .routing-result :global(svg) {
    flex-shrink: 0;
    margin-top: 2px;
    color: var(--app-success);
  }

  .routing-result.recommendation {
    background: var(--app-warning-soft);
    color: var(--app-text);
  }

  .routing-result.recommendation :global(svg) {
    color: var(--app-warning);
  }

  /* Sem dado reportado nao e "saudavel": tom neutro, nao verde. */
  .routing-result.unknown {
    background: var(--app-hover);
  }

  .routing-result.unknown :global(svg) {
    color: var(--app-text-muted);
  }

  /* ---- Providers ---------------------------------------------------------- */
  .provider-list {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 8px;
  }

  .provider-row {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 10px;
    padding: 10px;
    border-radius: 10px;
    background: var(--app-surface-subtle);
    box-shadow: var(--app-shadow-border);
  }

  .provider-head {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 8px;
  }

  .provider-head img,
  .provider-fallback {
    box-sizing: content-box;
    flex-shrink: 0;
    padding: 3px;
    border-radius: 6px;
    /* Placa fixa escura de proposito: os SVGs em /images sao preenchidos com
       branco, entao um token de superficie apagaria a marca no tema claro.
       Mesmo valor da Central de Providers (.provider-icon) e do no Terminal. */
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
    display: flex;
    min-width: 0;
    flex: 1;
    flex-direction: column;
  }

  .provider-name strong {
    overflow: hidden;
    color: var(--app-text);
    font-size: 12.5px;
    font-weight: 600;
    line-height: 1.35;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .provider-sub {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    line-height: 1.45;
  }

  .plan {
    overflow: hidden;
    color: var(--app-text-muted);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .plan::before {
    content: '·';
    margin-right: 6px;
  }

  /* Estado com ponto colorido + rotulo legivel (cor nunca e o unico sinal). */
  .status {
    display: inline-flex;
    flex-shrink: 0;
    align-items: center;
    gap: 5px;
    color: var(--status-color);
    font-weight: 500;
    white-space: nowrap;
  }

  .status::before {
    content: '';
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: currentColor;
  }

  .windows {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .window {
    display: grid;
    gap: 4px;
  }

  .window-label {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
    color: var(--app-text-soft);
    font-size: 12px;
  }

  .window-label strong {
    font-family: var(--font-mono);
    font-size: 12px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }

  .bar {
    height: 6px;
    overflow: hidden;
    border-radius: 999px;
    background: var(--app-hover);
  }

  .bar span {
    display: block;
    height: 100%;
    border-radius: inherit;
    transition: width var(--duration-slow) var(--ease-smooth-out);
  }

  .window small {
    color: var(--app-text-muted);
    font-family: var(--font-mono);
    font-size: 10.5px;
    font-variant-numeric: tabular-nums;
  }

  .provider-error {
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

  .provider-error :global(svg) {
    flex-shrink: 0;
    margin-top: 2px;
  }

  .provider-diagnostic {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .provider-diagnostic p {
    margin: 0;
    color: var(--app-text-muted);
    font-size: 12px;
    line-height: 1.5;
    overflow-wrap: anywhere;
    text-wrap: pretty;
  }

  .provider-diagnostic p.clamped {
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
  .provider-diagnostic a {
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

  .provider-diagnostic a {
    color: var(--app-secondary);
  }

  .diagnostic-toggle:hover {
    color: var(--app-text);
  }

  .provider-diagnostic a:hover {
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .diagnostic-toggle:focus-visible,
  .provider-diagnostic a:focus-visible {
    border-radius: 4px;
    outline: 2px solid var(--app-accent);
    outline-offset: 2px;
  }

  footer {
    margin-top: auto;
    color: var(--app-text-muted);
    font-size: 11px;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  .loading-row {
    gap: 10px;
  }

  @container (min-width: 760px) {
    .routing-fields {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }
  }

  /* No estreito, janela (3 segmentos) e limiar ocupam a linha inteira. */
  @container (max-width: 420px) {
    .window-field,
    .threshold-field {
      grid-column: 1 / -1;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .bar span {
      transition: none;
    }
  }
</style>
