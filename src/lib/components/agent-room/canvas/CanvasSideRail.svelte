<script lang="ts" module>
  import type { Component, Snippet } from 'svelte';

  export type RailItem = {
    id: string;
    label: string;
    icon: Component<{ size?: number; strokeWidth?: number; class?: string }>;
    active?: boolean;
    badge?: number;
    onSelect: () => void;
  };
</script>

<script lang="ts">
  import * as Tooltip from '$lib/components/ui/tooltip';

  /** A floating glass rail of panel toggles; the active panel keeps a gold mark. */
  let { items, label, side = 'left', children }: { items: RailItem[]; label: string; side?: 'left' | 'right'; children?: Snippet } = $props();
</script>

<div class="side-rail" role="toolbar" aria-orientation="vertical" aria-label={label} data-testid="canvas-side-rail">
  {#each items as item (item.id)}
    {@const Icon = item.icon}
    <Tooltip.Root>
      <Tooltip.Trigger>
        {#snippet child({ props })}
          <button {...props} type="button" class="rail-btn" class:active={item.active} aria-pressed={item.active ? 'true' : 'false'} aria-label={item.label} data-rail-item={item.id} onclick={item.onSelect}>
            <Icon size={16} strokeWidth={1.8} />
            {#if item.badge}<span class="badge">{item.badge > 99 ? '99+' : item.badge}</span>{/if}
          </button>
        {/snippet}
      </Tooltip.Trigger>
      <Tooltip.Content side={side}>{item.label}</Tooltip.Content>
    </Tooltip.Root>
  {/each}
  {#if children}<span class="sep" aria-hidden="true"></span>{@render children()}{/if}
</div>

<style>
  .side-rail {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    padding: 5px;
    border-radius: 16px;
    background: var(--app-glass);
    -webkit-backdrop-filter: blur(22px) saturate(170%);
    backdrop-filter: blur(22px) saturate(170%);
    border: 1px solid var(--app-glass-line);
    box-shadow: var(--app-glass-shadow);
  }

  .rail-btn {
    position: relative;
    width: 34px;
    height: 34px;
    display: grid;
    place-items: center;
    border: 0;
    border-radius: 11px;
    background: transparent;
    color: var(--app-text-muted);
    transition: background-color var(--duration-quick) ease-out, color var(--duration-quick) ease-out, transform var(--duration-quick) var(--ease-smooth-out);
  }

  .rail-btn:hover {
    background: var(--app-hover);
    color: var(--app-text);
  }

  .rail-btn:active {
    transform: scale(var(--scale-press));
  }

  .rail-btn.active {
    background: color-mix(in srgb, var(--app-accent) 16%, transparent);
    color: var(--app-accent);
  }

  .rail-btn:focus-visible {
    outline: 2px solid var(--app-accent);
    outline-offset: 1px;
  }

  .badge {
    position: absolute;
    top: 2px;
    right: 1px;
    min-width: 15px;
    height: 15px;
    padding: 0 4px;
    display: grid;
    place-items: center;
    border-radius: 8px;
    background: var(--app-warning);
    color: #1d1204;
    font-size: 10px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }

  .sep {
    width: 18px;
    height: 1px;
    margin: 4px 0;
    background: var(--app-glass-line);
  }

  .side-rail > :global(*:not(.sep):not(.rail-btn)) {
    flex: none;
  }
</style>
