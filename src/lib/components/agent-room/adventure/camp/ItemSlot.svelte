<script lang="ts">
  import { Lock } from '@lucide/svelte';
  import * as Tooltip from '$lib/components/ui/tooltip';
  import type { AdventureCatalog } from '$lib/i18n/adventure/index.js';
  import type { SetId } from '$lib/modules/agent-room/domain/adventure/artifacts.js';
  import { RARITY_RULES, itemIcon, rarityIndex, type ItemData } from '$lib/modules/agent-room/domain/adventure/items.js';
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
    wornSets = {},
    ghost = null,
    onclick,
  }: {
    item: ItemData | null;
    catalog: AdventureCatalog;
    compare?: ItemData | null;
    heroLevel?: number | null;
    selected?: boolean;
    locked?: boolean;
    size?: number;
    /** An empty cell's name (an equipment slot's), read by screen readers and shown when there is no ghost. */
    placeholder?: string | null;
    /** A faint picture of what goes in an empty cell. */
    ghost?: { atlas: string; frame: number } | null;
    /** Pieces of each set the hero in question wears (for the details). */
    wornSets?: Partial<Record<SetId, number>>;
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
          class:unique={Boolean(item.uniqueId)}
          class:set={Boolean(item.setId)}
          class:radiant={rarityIndex(item.rarity) >= 4}
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
    <Tooltip.Content side="right" class="camp-popover max-w-none p-3">
      <ItemDetails {item} {catalog} {compare} {heroLevel} {wornSets} />
    </Tooltip.Content>
  </Tooltip.Root>
{:else}
  <button type="button" class="slot empty" class:selected style:width={`${size}px`} style:height={`${size}px`} {onclick} aria-label={placeholder ?? ''}>
    {#if ghost}<span class="ghost"><ItemIcon atlasId={ghost.atlas} frame={ghost.frame} size={size - 14} /></span>
    {:else if placeholder}<span class="placeholder">{placeholder}</span>{/if}
  </button>
{/if}

<style>
  /* A recessed cell tinted and ringed by the item's rarity. */
  .slot {
    position: relative;
    display: grid;
    place-items: center;
    padding: 0;
    border: 0;
    border-radius: 8px;
    background:
      radial-gradient(circle at 50% 42%, color-mix(in srgb, var(--rarity, transparent) 24%, transparent), transparent 70%),
      radial-gradient(circle at 50% 40%, var(--camp-raised, var(--app-surface-raised)), var(--camp-inset, var(--app-surface-subtle)) 78%);
    box-shadow:
      inset 0 0 0 1px color-mix(in srgb, var(--rarity, var(--app-border)) 70%, transparent),
      inset 0 2px 6px rgba(0, 0, 0, 0.3);
    cursor: pointer;
    transition: transform 120ms ease-out, box-shadow 160ms ease-out;
  }

  .slot:hover {
    transform: translateY(-1px);
    box-shadow:
      inset 0 0 0 1px var(--rarity, var(--app-border-strong)),
      0 0 12px -2px color-mix(in srgb, var(--rarity, transparent) 75%, transparent);
  }

  .slot:active {
    transform: translateY(0) scale(0.97);
  }

  .slot:focus-visible {
    outline: 2px solid var(--camp-gold, var(--app-ring));
    outline-offset: 2px;
  }

  /* Legendary and beyond glow softly. */
  .slot.radiant {
    box-shadow:
      inset 0 0 0 1px var(--rarity),
      inset 0 2px 6px rgba(0, 0, 0, 0.3),
      0 0 10px -3px var(--rarity);
  }

  .slot.selected {
    box-shadow: inset 0 0 0 2px var(--camp-gold, var(--app-accent)), 0 0 0 2px color-mix(in srgb, var(--camp-gold, var(--app-accent)) 35%, transparent);
  }

  /* Uniques and set pieces wear a second ring: orange for uniques, green for sets. */
  .slot.unique {
    box-shadow: inset 0 0 0 1px var(--rarity), inset 0 0 0 3px color-mix(in srgb, #ff9b30 55%, transparent), 0 0 10px -3px #ff9b30;
  }

  .slot.set {
    box-shadow: inset 0 0 0 1px var(--rarity), inset 0 0 0 3px color-mix(in srgb, #3ddc97 50%, transparent), 0 0 10px -3px #3ddc97;
  }

  .slot.selected.unique,
  .slot.selected.set {
    box-shadow: inset 0 0 0 2px var(--camp-gold, var(--app-accent)), 0 0 0 2px color-mix(in srgb, var(--camp-gold, var(--app-accent)) 35%, transparent);
  }

  .slot.empty {
    background: radial-gradient(circle at 50% 40%, var(--camp-panel, var(--app-surface)), var(--camp-inset, var(--app-surface-subtle)) 80%);
    box-shadow: inset 0 0 0 1px var(--camp-edge, var(--app-border)), inset 0 2px 6px rgba(0, 0, 0, 0.3);
  }

  .slot.empty.selected {
    box-shadow: inset 0 0 0 2px var(--camp-gold, var(--app-accent));
  }

  /* What goes in an empty cell, as a faint engraving. */
  .ghost {
    display: grid;
    opacity: 0.28;
    filter: grayscale(1) contrast(0.9);
  }

  .slot.empty:hover .ghost {
    opacity: 0.45;
  }

  .placeholder {
    color: var(--camp-ink-muted, var(--app-text-muted));
    font-size: 11px;
    text-align: center;
    line-height: 1.1;
  }

  .level {
    position: absolute;
    right: 4px;
    bottom: 2px;
    color: #fff4d6;
    font-size: 11px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    text-shadow: 0 1px 2px #000, 0 0 3px #000;
  }

  .slot :global(.lock) {
    position: absolute;
    top: 4px;
    left: 4px;
    color: var(--camp-gold, var(--app-accent));
  }

  .sockets {
    position: absolute;
    top: 4px;
    right: 4px;
    display: flex;
    gap: 2px;
  }

  .sockets i {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    box-shadow: inset 0 0 0 1px rgba(255, 244, 214, 0.7);
  }

  .sockets i.filled {
    background: var(--camp-teal, var(--app-accent));
    box-shadow: 0 0 4px var(--camp-teal, var(--app-accent));
  }

  @media (prefers-reduced-motion: reduce) {
    .slot { transition: none; }
    .slot:hover, .slot:active { transform: none; }
  }
</style>
