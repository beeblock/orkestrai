<script lang="ts">
  import { Bot, ChevronDown, CodeXml, Pin, Settings2 } from '@lucide/svelte';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
  import * as Tooltip from '$lib/components/ui/tooltip';
  import ToolbarButton from './ToolbarButton.svelte';
  import { cn } from '$lib/utils.js';
  import { MAX_PINNED_AGENT_PROVIDERS } from '$lib/components/agent-room/provider-toolbar.js';
  import { providerIcons } from '$lib/modules/agent-room/domain/provider-icons.js';
  import type { AgentProviderInfo } from '$lib/modules/agent-room/domain/types.js';
  import * as m from '$lib/paraglide/messages.js';

  type Props = {
    providers: AgentProviderInfo[];
    pinnedProviderIds: string[];
    activeProviderId: string | null;
    allowUnavailableSelection?: boolean;
    onSelect: (provider: AgentProviderInfo) => void;
    onTogglePin: (providerId: string, pinned: boolean) => void;
    onOpenProviderCenter: () => void;
  };

  let {
    providers,
    pinnedProviderIds,
    activeProviderId,
    allowUnavailableSelection = false,
    onSelect,
    onTogglePin,
    onOpenProviderCenter,
  }: Props = $props();

  const pinnedProviderSet = $derived(new Set(pinnedProviderIds));
  const unpinnedProviderActive = $derived(
    activeProviderId !== null && !pinnedProviderSet.has(activeProviderId)
  );
  const pinnedProviders = $derived(
    pinnedProviderIds
      .map((id) => providers.find((provider) => provider.id === id))
      .filter((provider): provider is AgentProviderInfo => Boolean(provider && (provider.installed || allowUnavailableSelection)))
  );
</script>

<DropdownMenu.Root>
  <Tooltip.Root>
    <Tooltip.Trigger>
      {#snippet child({ props })}
        <DropdownMenu.Trigger
          {...props}
          data-testid="agent-toolbar-menu"
          class={cn(
            'group relative inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent p-0 text-[var(--app-text-muted)] outline-none transition-[color,background-color,box-shadow] duration-150 hover:bg-[var(--app-border)] hover:text-[var(--app-text)] focus-visible:ring-2 focus-visible:ring-[var(--app-accent)]/45 data-[state=open]:bg-[var(--app-accent-soft)] data-[state=open]:text-[var(--app-accent)]',
            unpinnedProviderActive && 'bg-[var(--app-accent-soft)] text-[var(--app-accent)]',
          )}
          aria-label={m['canvas.agents_menu_aria']()}
        >
          <Bot size={15} aria-hidden="true" />
          <ChevronDown
            size={9}
            class="absolute right-0.5 bottom-0.5 text-[var(--app-text-muted)] transition-transform duration-150 group-data-[state=open]:rotate-180"
            aria-hidden="true"
          />
        </DropdownMenu.Trigger>
      {/snippet}
    </Tooltip.Trigger>
    <Tooltip.Content side="top">{m['canvas.agents_menu']()}</Tooltip.Content>
  </Tooltip.Root>
  <DropdownMenu.Content side="top" align="start" sideOffset={10} class="agents-menu-content">
    <DropdownMenu.Label>{m['canvas.agents_available']()}</DropdownMenu.Label>
    {#each providers as provider (provider.id)}
      <DropdownMenu.Item
        class="agent-menu-item"
        textValue={provider.displayName}
        onclick={() => provider.installed || allowUnavailableSelection ? onSelect(provider) : onOpenProviderCenter()}
      >
        <span class="provider-menu-icon app-logo-plate" aria-hidden="true">
          {#if providerIcons[provider.id]}
            <img src={providerIcons[provider.id]} width="16" height="16" alt="" />
          {:else}
            <CodeXml size={16} />
          {/if}
        </span>
        <span class="provider-menu-copy">
          <strong>{provider.displayName}</strong>
          <small>{provider.installed ? m['providers.detected']() : allowUnavailableSelection ? m['providers.not_in_default_runtime']() : m['providers.not_detected']()}</small>
        </span>
        {#if !provider.installed}<Settings2 size={14} class="provider-setup-icon" aria-hidden="true" />{/if}
      </DropdownMenu.Item>
    {/each}
    <DropdownMenu.Separator />
    <DropdownMenu.Sub>
      <DropdownMenu.SubTrigger>
        <Pin size={14} aria-hidden="true" />
        <span class="pin-provider-name">
          {m['canvas.agents_pinned']({ count: String(pinnedProviderIds.length), max: String(MAX_PINNED_AGENT_PROVIDERS) })}
        </span>
      </DropdownMenu.SubTrigger>
      <DropdownMenu.SubContent sideOffset={8} class="agent-pin-submenu">
        {#each providers as provider (provider.id)}
          <DropdownMenu.CheckboxItem
            checked={pinnedProviderSet.has(provider.id)}
            disabled={pinnedProviderIds.length >= MAX_PINNED_AGENT_PROVIDERS && !pinnedProviderSet.has(provider.id)}
            closeOnSelect={false}
            textValue={provider.displayName}
            onCheckedChange={(checked: boolean) => onTogglePin(provider.id, checked)}
          >
            <span class="pin-provider-name">{provider.displayName}</span>
          </DropdownMenu.CheckboxItem>
        {/each}
      </DropdownMenu.SubContent>
    </DropdownMenu.Sub>
    <DropdownMenu.Separator />
    <DropdownMenu.Item onclick={onOpenProviderCenter}>
      <Settings2 size={15} aria-hidden="true" />
      {m['canvas.open_provider_center']()}
    </DropdownMenu.Item>
  </DropdownMenu.Content>
</DropdownMenu.Root>

{#each pinnedProviders as provider (provider.id)}
  <ToolbarButton
    label={m['canvas.pinned_agent_tooltip']({ provider: provider.displayName })}
    active={activeProviderId === provider.id}
    onclick={() => onSelect(provider)}
  >
    {#if providerIcons[provider.id]}
      <img src={providerIcons[provider.id]} width="15" height="15" alt="" class="tool-icon" />
    {:else}
      <CodeXml size={15} class="tool-icon-svg" />
    {/if}
    {provider.displayName}
  </ToolbarButton>
{/each}

<style>
  :global(.agents-menu-content) {
    width: min(300px, calc(100vw - 24px));
    max-height: min(560px, calc(100vh - 120px));
    padding: 6px;
    overscroll-behavior: contain;
  }

  :global(.agent-menu-item) {
    min-height: 44px;
    gap: 9px;
    padding: 6px 8px;
  }

  :global(.provider-menu-icon) {
    display: inline-flex;
    width: 24px;
    height: 24px;
    align-items: center;
    justify-content: center;
    border-radius: 6px;
    background: var(--app-logo-plate);
    color: var(--app-text-soft);
    flex-shrink: 0;
  }

  :global(.provider-menu-icon img) {
    display: block;
  }

  :global(.provider-menu-copy) {
    display: flex;
    min-width: 0;
    flex: 1;
    flex-direction: column;
    gap: 1px;
  }

  :global(.provider-menu-copy strong) {
    overflow: hidden;
    color: inherit;
    font-size: 12px;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  :global(.provider-menu-copy small) {
    color: var(--app-text-muted);
    font-size: 10.5px;
  }

  :global(.provider-setup-icon) {
    color: var(--app-text-muted);
  }

  :global(.pin-provider-name) {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  :global(.agent-pin-submenu) {
    width: 210px;
    max-height: min(360px, calc(100vh - 24px));
    overflow-y: auto;
    overscroll-behavior: contain;
  }

</style>
