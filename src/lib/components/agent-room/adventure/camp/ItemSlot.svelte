<script lang="ts">
  import { Lock } from '@lucide/svelte';
  import * as Tooltip from '$lib/components/ui/tooltip';
  import type { AdventureCatalog } from '$lib/i18n/adventure/index.js';
  import { RARITY_RULES, itemIcon, type ItemData } from '$lib/modules/agent-room/domain/adventure/items.js';
  import ItemDetails from './ItemDetails.svelte';
  import ItemIcon from './ItemIcon.svelte';
  import { itemName } from '../adventure-text.js';

  /** A gear cell: the item's icon in its rarity's frame, with its details on hover. */
  let {
    item,
    catalog,
    compare = null,
    heroLevel = null,
    selected = false,
    locked = false,
    size = 48,
    placeholder = null,
    onclick,
  }: {
    item: ItemData | null;
    catalog: AdventureCatalog;
    compare?: ItemData | null;
    heroLevel?: number | null;
    selected?: boolean;
    locked?: boolean;
    size?: number;
    /** What an empty cell shows (an equipment slot's name). */
    placeholder?: string | null;
    onclick?: (event: MouseEvent) => void;
  } = $props();

  const icon = $derived(item ? itemIcon(item) : null);
</script>

{#if item && icon}
  <Tooltip.Root>
    <Tooltip.Trigger>
      {#snippet child({ props })}
        <button
          {...props}
          type="button"
          class="slot"
          class:selected
          style:--rarity={RARITY_RULES[item.rarity].color}
          style:width={`${size}px`}
          style:height={`${size}px`}
          aria-label={`${itemName(catalog, item)} · ${catalog.rarities[item.rarity]} · ${item.level}`}
          aria-pressed={selected}
          {onclick}
        >
          <ItemIcon atlasId={icon.atlas} frame={icon.frame} size={size - 6} />
          <span class="level">{item.level}</span>
          {#if locked}<Lock size={10} class="lock" aria-hidden="true" />{/if}
          {#if item.sockets.length}<span class="sockets" aria-hidden="true">{#each item.sockets as socket, index (index)}<i class:filled={Boolean(socket.material)}></i>{/each}</span>{/if}
        </button>
      {/snippet}
    </Tooltip.Trigger>
    <Tooltip.Content side="right" class="max-w-none border border-[var(--app-border-strong)] bg-[var(--app-surface-raised)] p-3 text-[var(--app-text)]">
      <ItemDetails {item} {catalog} {compare} {heroLevel} />
    </Tooltip.Content>
  </Tooltip.Root>
{:else}
  <button type="button" class="slot empty" style:width={`${size}px`} style:height={`${size}px`} {onclick} aria-label={placeholder ?? ''}>
    {#if placeholder}<span class="placeholder">{placeholder}</span>{/if}
  </button>
{/if}

<style>
  .slot {
    position: relative;
    display: grid;
    place-items: center;
    padding: 0;
    border: 0;
    border-radius: 7px;
    background: color-mix(in srgb, var(--rarity, #ffffff) 10%, var(--app-surface-subtle));
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--rarity, var(--app-border)) 60%, transparent);
    cursor: pointer;
    transition: transform 120ms ease-out, box-shadow 120ms ease-out;
  }

  .slot:hover {
    transform: translateY(-1px);
    box-shadow: inset 0 0 0 1px var(--rarity, var(--app-border-strong)), 0 0 10px -2px color-mix(in srgb, var(--rarity, transparent) 70%, transparent);
  }

  .slot:focus-visible {
    outline: 2px solid var(--app-ring);
    outline-offset: 2px;
  }

  .slot.selected {
    box-shadow: inset 0 0 0 2px var(--app-accent), 0 0 0 2px color-mix(in srgb, var(--app-accent) 35%, transparent);
  }

  .slot.empty {
    background: var(--app-surface-subtle);
    box-shadow: inset 0 0 0 1px var(--app-border);
  }

  .placeholder {
    color: var(--app-text-muted);
    font-size: 11px;
    text-align: center;
    line-height: 1.1;
  }

  .level {
    position: absolute;
    right: 3px;
    bottom: 2px;
    color: var(--app-text-soft);
    font-size: 11px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    text-shadow: 0 1px 2px #000;
  }

  .slot :global(.lock) {
    position: absolute;
    top: 3px;
    left: 3px;
    color: var(--app-accent);
  }

  .sockets {
    position: absolute;
    top: 3px;
    right: 3px;
    display: flex;
    gap: 2px;
  }

  .sockets i {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    box-shadow: inset 0 0 0 1px var(--app-text-muted);
  }

  .sockets i.filled {
    background: var(--app-accent);
    box-shadow: none;
  }
</style>
