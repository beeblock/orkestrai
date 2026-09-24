<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { Activity, TriangleAlert } from '@lucide/svelte';
  import * as Tooltip from '$lib/components/ui/tooltip';
  import { usageSeverity } from '$lib/modules/agent-room/domain/usage.js';
  import { usageRoutingId } from '$lib/modules/agent-room/domain/usage-routing.js';
  import type { ProviderUsage, UsageWindow } from '$lib/modules/agent-room/application/services/UsageService.js';
  import { usageProviderDefinition } from '$lib/modules/agent-room/domain/usage-providers.js';
  import { retainUsageFeed, usageStore } from './usage-store.svelte.js';
  import * as m from '$lib/paraglide/messages.js';

  let { workspaceId }: { workspaceId: string | null } = $props();

  function windowLabel(window: UsageWindow): string {
    if (window.kind === '5h') return m['usage.window_5h']();
    if (window.kind === 'weekly') return m['usage.window_weekly']();
    return m['usage.window_monthly']();
  }

  function color(percent: number): string {
    const severity = usageSeverity(percent);
    if (severity === 'danger') return 'var(--app-danger)';
    if (severity === 'warning') return 'var(--app-warning)';
    return 'var(--app-success)';
  }

  function summary(usage: ProviderUsage): string {
    const meta = usageProviderDefinition(usage.provider);
    if (usage.error || !usage.windows.length) return `${meta.name}: ${m['workbench.usage_unavailable']()}`;
    const providerLabel = usage.profileName ? `${meta.name} · ${usage.profileName}` : meta.name;
    return usage.windows
      .map((window) => m['workbench.usage_summary']({
        provider: providerLabel,
        window: windowLabel(window),
        percent: window.usedPercent,
      }))
      .join('. ');
  }

  async function openUsage() {
    sessionStorage.setItem('orkestrai.menu-action', 'usage');
    await goto(workspaceId ? `/canvas?workspace=${workspaceId}` : '/canvas');
  }

  onMount(retainUsageFeed);
</script>

<footer
  data-testid="workbench-usage-footer"
  class="flex h-7 min-w-0 items-center border-t border-[var(--app-border)] bg-[var(--app-surface)] px-2.5"
  aria-label={m['workbench.usage_footer_label']()}
>
  <Activity size={12} class="mr-2 shrink-0 text-[var(--app-text-muted)]" aria-hidden="true" />
  <div class="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto [scrollbar-width:none]">
    {#if usageStore.loading && !usageStore.values.length}
      <span class="text-ui-xs text-[var(--app-text-muted)]" role="status">{m['workbench.usage_loading']()}</span>
    {:else}
      {#each usageStore.values.filter((usage) => usage.windows.length > 0 || usage.error) as usage (usageRoutingId(usage))}
        {@const meta = usageProviderDefinition(usage.provider)}
        <Tooltip.Root>
          <Tooltip.Trigger>
            {#snippet child({ props })}
              <button
                {...props}
                type="button"
                class="usage-chip"
                aria-label={summary(usage)}
                onclick={openUsage}
              >
                {#if meta.icon}<span class="usage-logo app-logo-plate"><img src={meta.icon} width="11" height="11" alt="" /></span>{/if}
                <span class="font-medium">{meta.name}{#if usage.profileName} · {usage.profileName}{/if}</span>
                {#if usage.error || !usage.windows.length}
                  <TriangleAlert size={11} class="text-[var(--app-warning)]" aria-hidden="true" />
                {:else}
                  {#each usage.windows as window (window.kind)}
                    <span class="usage-window">
                      <span class="usage-window-label">{windowLabel(window)}</span>
                      <span class="usage-meter" aria-hidden="true"><span style:width={`${Math.min(100, Math.max(0, window.usedPercent))}%`} style:background={color(window.usedPercent)}></span></span>
                      <span class="usage-percent" style:color={color(window.usedPercent)}>{window.usedPercent}%</span>
                    </span>
                  {/each}
                {/if}
              </button>
            {/snippet}
          </Tooltip.Trigger>
          <Tooltip.Content side="top">{summary(usage)}</Tooltip.Content>
        </Tooltip.Root>
      {/each}
    {/if}
  </div>
  <button
    type="button"
    class="ml-2 h-5 shrink-0 rounded-md px-1.5 text-ui-xs text-[var(--app-text-muted)] transition-colors duration-150 hover:bg-[var(--app-hover)] hover:text-[var(--app-text)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--app-accent)]"
    onclick={openUsage}
  >{m['workbench.usage_open']()}</button>
</footer>

<style>
  /* Chip de uso: marca, nome e mini medidor por janela com cor por limite. */
  .usage-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 20px;
    flex-shrink: 0;
    padding: 0 7px 0 3px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--app-text-soft);
    font-size: 11px;
    cursor: pointer;
    transition: background-color var(--duration-quick) ease-out;
  }

  .usage-chip:hover {
    background: var(--app-hover);
  }

  .usage-chip:focus-visible {
    outline: 2px solid var(--app-accent);
    outline-offset: 1px;
  }

  .usage-logo {
    display: grid;
    place-items: center;
    width: 16px;
    height: 16px;
    border-radius: 4px;
  }

  .usage-window {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }

  .usage-window-label {
    color: var(--app-text-muted);
  }

  .usage-meter {
    position: relative;
    width: 24px;
    height: 4px;
    overflow: hidden;
    border-radius: 999px;
    background: var(--app-hover);
  }

  .usage-meter > span {
    position: absolute;
    inset: 0 auto 0 0;
    border-radius: inherit;
    transition: width var(--duration-slow) var(--ease-smooth-out);
  }

  .usage-percent {
    font-family: var(--font-mono);
    font-size: 10.5px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
</style>
