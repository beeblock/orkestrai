<script lang="ts">
  import { X } from '@lucide/svelte';
  import { Button } from '$lib/components/ui/button';
  import type { AdventureCatalog } from '$lib/i18n/adventure/index.js';
  import type { SetId } from '$lib/modules/agent-room/domain/adventure/artifacts.js';
  import { outfitProgress } from '$lib/modules/agent-room/domain/adventure/build.js';
  import { RARITY_RULES, SLOT_CAPACITY, canEquip, classSlot, itemIcon, itemScore, type Item, type Slot } from '$lib/modules/agent-room/domain/adventure/items.js';
  import * as m from '$lib/paraglide/messages.js';
  import type { AdventureAction, AdventureOutcome, AdventureSnapshot } from '../../adventure-client.js';
  import type { HeroView } from '../../adventure-party.js';
  import { campArt } from '../../camp-art.js';
  import ItemSlot from '../ItemSlot.svelte';
  import SpriteView from '../SpriteView.svelte';

  /**
   * The hero's armory as a character sheet: the hero on a pedestal in the
   * middle, armor on one side, weapons and legwear on the other, jewelry
   * below, and how close the gear is to the next outfit.
   */
  let { hero, snapshot, catalog, act, busy }: {
    hero: HeroView;
    snapshot: AdventureSnapshot;
    catalog: AdventureCatalog;
    act: (action: AdventureAction) => Promise<AdventureOutcome | null>;
    busy: boolean;
  } = $props();

  type Cell = { slot: Slot; index: number; area: string };
  const SIDES: Cell[] = [
    { slot: 'helmet', index: 0, area: 'helmet' },
    { slot: 'shoulders', index: 0, area: 'shoulders' },
    { slot: 'armor', index: 0, area: 'armor' },
    { slot: 'gloves', index: 0, area: 'gloves' },
    { slot: 'weapon', index: 0, area: 'weapon' },
    { slot: 'offhand', index: 0, area: 'offhand' },
    { slot: 'legs', index: 0, area: 'legs' },
    { slot: 'boots', index: 0, area: 'boots' },
  ];
  const JEWELRY: Cell[] = [
    { slot: 'amulet', index: 0, area: '' },
    { slot: 'ring', index: 0, area: '' },
    { slot: 'ring', index: 1, area: '' },
    { slot: 'trinket', index: 0, area: '' },
    { slot: 'trinket', index: 1, area: '' },
  ];
  const pedestal = campArt('pedestal');

  /** The cell being filled. */
  let picking = $state<Cell | null>(null);

  const equipped = $derived(snapshot.items.filter((item) => item.location === 'equipped' && item.heroId === hero.id));
  const wornSets = $derived((hero.build.sets ?? {}) as Partial<Record<SetId, number>>);
  const outfit = $derived(outfitProgress(equipped));
  const atlasId = $derived(hero.build.visualTier === 2 ? `hero-${hero.classId}` : `hero-${hero.classId}-t${hero.build.visualTier}`);
  const candidates = $derived(picking
    ? snapshot.items
      .filter((item) => item.slot === picking!.slot && item.location !== 'equipped' && canEquip(item, { classId: hero.classId, level: hero.level }) === 'ok')
      .sort((a, b) => itemScore(b) - itemScore(a))
    : []);
  const current = $derived(picking ? wornIn(picking.slot, picking.index) : null);

  $effect(() => {
    void hero.id;
    picking = null;
  });

  /** What a cell holds: the slot's items in a steady order, one per cell. */
  function wornIn(slot: Slot, index = 0): Item | null {
    return equipped.filter((item) => item.slot === slot).sort((a, b) => a.id.localeCompare(b.id))[index] ?? null;
  }

  function cellLabel(slot: Slot, index: number): string {
    return SLOT_CAPACITY[slot] > 1 ? m['adventure.camp_slot_pair']({ slot: catalog.slots[slot], index: index + 1 }) : catalog.slots[slot];
  }

  function ghost(slot: Slot) {
    return itemIcon({ slot, classId: classSlot(slot) ? hero.classId : null, level: 1, variant: 0 });
  }

  function same(cell: Cell): boolean {
    return picking?.slot === cell.slot && picking.index === cell.index;
  }

  function toggle(cell: Cell) {
    picking = same(cell) ? null : cell;
  }

  /** Names of the pieces holding the outfit back: "Shoulders (empty), Hands (Common)". */
  const weakText = $derived(outfit.weakest.map((slot) => {
    const item = equipped.find((entry) => entry.slot === slot);
    return `${catalog.slots[slot]} (${item ? catalog.rarities[item.rarity] : m['adventure.camp_empty_slot']()})`;
  }).join(', '));
</script>

{#snippet cell(entry: Cell)}
  {@const item = wornIn(entry.slot, entry.index)}
  <div class="cell" style:grid-area={entry.area || undefined}>
    <ItemSlot {item} {catalog} heroLevel={hero.level} {wornSets} size={60} placeholder={cellLabel(entry.slot, entry.index)} ghost={ghost(entry.slot)} selected={same(entry)} onclick={() => toggle(entry)} />
    <span class="label" class:filled={Boolean(item)} style:--ink={item ? `var(--adventure-ink-${item.rarity})` : undefined}>{cellLabel(entry.slot, entry.index)}</span>
  </div>
{/snippet}

<section class="armory camp-panel ornate" aria-label={m['adventure.camp_equipment']()}>
  <h3 class="camp-heading">{m['adventure.camp_equipment']()}</h3>
  <div class="doll">
    {#each SIDES as entry (entry.area)}{@render cell(entry)}{/each}
    <div class="portrait">
      <div class="stand">
        {#if pedestal}<img class="pedestal" src={pedestal} alt="" width="190" height="111" />{/if}
        <SpriteView {atlasId} fallbackId={`hero-${hero.classId}`} animation={hero.activity === 'working' ? 'walk' : 'idle'} width={190} height={200} glow={hero.build.weaponRarity ? RARITY_RULES[hero.build.weaponRarity].color : null} />
      </div>
      <div class="outfit" title={m['adventure.camp_outfit_rule']()}>
        <span class="outfit-name"><b>{catalog.outfits[String(outfit.tier) as '1']}</b>{#if outfit.next}<span class="camp-muted"> → {catalog.outfits[String(outfit.next) as '1']}</span>{/if}</span>
        <span class="camp-bar" role="progressbar" aria-label={m['adventure.camp_outfit']()} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(outfit.progress * 100)}><span style:width={`${Math.round(outfit.progress * 100)}%`}></span></span>
        <small class="camp-muted">{outfit.next ? m['adventure.camp_outfit_hint']({ slots: weakText }) : m['adventure.camp_outfit_max']()}</small>
      </div>
    </div>
  </div>
  <div class="jewelry" role="group" aria-label={m['adventure.camp_jewelry']()}>
    {#each JEWELRY as entry (`${entry.slot}-${entry.index}`)}{@render cell(entry)}{/each}
  </div>

  {#if picking}
    <div class="picker" aria-label={m['adventure.camp_pick_for']({ slot: cellLabel(picking.slot, picking.index) })}>
      <header>
        <b>{m['adventure.camp_pick_for']({ slot: cellLabel(picking.slot, picking.index) })}</b>
        {#if current}<Button size="sm" variant="ghost" disabled={busy} onclick={() => void act({ type: 'unequip', itemId: current!.id })}>{m['adventure.camp_unequip']()}</Button>{/if}
        <Button size="icon-sm" variant="ghost" aria-label={m['adventure.camp_close']()} onclick={() => (picking = null)}><X size={14} /></Button>
      </header>
      {#if candidates.length}
        <div class="choices">
          {#each candidates as item (item.id)}
            <ItemSlot {item} {catalog} heroLevel={hero.level} {wornSets} compare={current} locked={item.locked} size={54} onclick={() => void act({ type: 'equip', itemId: item.id, heroId: hero.id, replaceId: current?.id }).then(() => (picking = null))} />
          {/each}
        </div>
      {:else}
        <p class="camp-muted none">{m['adventure.camp_no_candidates']()}</p>
      {/if}
    </div>
  {/if}
</section>

<style>
  .armory {
    display: grid;
    gap: 14px;
    padding: 14px 16px 16px;
    min-width: 0;
  }

  .doll {
    display: grid;
    grid-template-columns: auto minmax(190px, 1fr) auto;
    grid-template-areas:
      'helmet portrait weapon'
      'shoulders portrait offhand'
      'armor portrait legs'
      'gloves portrait boots';
    gap: 8px 14px;
    justify-items: center;
  }

  .cell {
    display: grid;
    justify-items: center;
    gap: 3px;
    width: 72px;
  }

  .label {
    max-width: 72px;
    overflow: hidden;
    color: var(--camp-ink-muted);
    font-size: 11px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .label.filled {
    color: var(--ink, var(--camp-ink-soft));
  }

  /* The hero on a glowing pedestal. */
  .portrait {
    grid-area: portrait;
    display: grid;
    align-content: end;
    justify-items: center;
    gap: 8px;
    width: 100%;
    padding-bottom: 2px;
    background: radial-gradient(circle at 50% 40%, var(--camp-glow), transparent 62%);
  }

  /* The hero stands on the pedestal's top: its feet meet the stone 28 px under the pedestal's top edge. */
  .stand {
    position: relative;
    display: grid;
    justify-items: center;
    padding-bottom: 80px;
  }

  .stand :global(canvas) {
    position: relative;
  }

  .pedestal {
    position: absolute;
    bottom: 0;
    left: 50%;
    width: 190px;
    height: auto;
    transform: translateX(-50%);
    image-rendering: auto;
    pointer-events: none;
  }

  .outfit {
    display: grid;
    gap: 4px;
    width: min(100%, 220px);
    text-align: center;
  }

  .outfit-name {
    font-family: var(--camp-title-font);
    font-size: 13px;
    letter-spacing: 0.04em;
  }

  .outfit-name b {
    color: var(--camp-gold-strong);
  }

  .outfit small {
    font-size: 11px;
    line-height: 1.35;
  }

  .jewelry {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 8px 10px;
    padding-top: 12px;
    border-top: 1px solid color-mix(in srgb, var(--camp-edge-strong) 45%, transparent);
  }

  .picker {
    display: grid;
    gap: 10px;
    padding: 12px;
    border-radius: 8px;
    background: var(--camp-inset);
    box-shadow: inset 0 0 0 1px var(--camp-edge-strong);
    animation: picker-in 200ms cubic-bezier(0.2, 0.8, 0.2, 1);
  }

  .picker header {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .picker header b {
    flex: 1;
    font-size: 12.5px;
  }

  .choices {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .none {
    margin: 0;
    font-size: 12px;
  }

  @keyframes picker-in {
    from { opacity: 0; transform: translateY(-4px); }
  }

  @container (max-width: 430px) {
    .doll {
      grid-template-columns: repeat(4, auto);
      grid-template-areas:
        'portrait portrait portrait portrait'
        'helmet shoulders armor gloves'
        'weapon offhand legs boots';
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .picker { animation: none; }
  }
</style>
