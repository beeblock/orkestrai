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
  class="flex h-7 min-w-0 items-center border-t border-[var(--app-border)] bg-[var(--app-surface)] px-2"
  aria-label={m['workbench.usage_footer_label']()}
>
  <Activity size={12} class="mr-2 shrink-0 text-[var(--app-text-muted)]" aria-hidden="true" />
  <div class="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto [scrollbar-width:none]">
    {#if usageStore.loading && !usageStore.values.length}
      <span class="text-[10px] text-[var(--app-text-muted)]">{m['workbench.usage_loading']()}</span>
    {:else}
      {#each usageStore.values.filter((usage) => usage.windows.length > 0 || usage.error) as usage (usageRoutingId(usage))}
        {@const meta = usageProviderDefinition(usage.provider)}
        <Tooltip.Root>
          <Tooltip.Trigger>
            {#snippet child({ props })}
              <button
                {...props}
                type="button"
                class="flex h-5 shrink-0 items-center gap-1 rounded-[4px] px-1.5 text-[9px] text-[var(--app-text-soft)] hover:bg-[var(--app-surface-raised)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--app-accent)]"
                aria-label={summary(usage)}
                onclick={openUsage}
              >
                {#if meta.icon}<img src={meta.icon} width="12" height="12" alt="" class="size-3 object-contain" />{/if}
                <span class="font-medium">{meta.name}{#if usage.profileName} · {usage.profileName}{/if}</span>
                {#if usage.error || !usage.windows.length}
                  <TriangleAlert size={10} class="text-[var(--app-warning)]" aria-hidden="true" />
                {:else}
                  {#each usage.windows as window (window.kind)}
                    <span class="flex items-center gap-0.5 tabular-nums">
                      <span class="text-[8px] text-[var(--app-text-muted)]">{windowLabel(window)}</span>
                      <span class="font-semibold" style:color={color(window.usedPercent)}>{window.usedPercent}%</span>
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
    class="ml-2 shrink-0 text-[9px] text-[var(--app-text-muted)] hover:text-[var(--app-text)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--app-accent)]"
    onclick={openUsage}
  >{m['workbench.usage_open']()}</button>
</footer>
