<script lang="ts">
  import type { AdventureCatalog } from '$lib/i18n/adventure/index.js';
  import { SETS, SET_PIECES, UNIQUES, uniqueStats, type SetId } from '$lib/modules/agent-room/domain/adventure/artifacts.js';
  import { EQUIP_LEVEL_MARGIN, RARITY_RULES, itemGoldValue, itemIcon, itemImplicitStats, itemStats, materialIcon, materialStats, rarityIndex, type ItemData } from '$lib/modules/agent-room/domain/adventure/items.js';
  import { STAT_IDS, type StatBlock, type StatId } from '$lib/modules/agent-room/domain/adventure/stats.js';
  import * as m from '$lib/paraglide/messages.js';
  import { itemName, materialName, rarityInk, statLines, statText } from '../adventure-text.js';
  import ItemIcon from './ItemIcon.svelte';

  /**
   * Everything about an item, and how it compares with the one worn in its
   * slot. `wornSets` (pieces the hero in question wears of each set) lights
   * up the set bonuses already active.
   */
  let { item, catalog, compare = null, heroLevel = null, wornSets = {} }: {
    item: ItemData;
    catalog: AdventureCatalog;
    compare?: ItemData | null;
    heroLevel?: number | null;
    wornSets?: Partial<Record<SetId, number>>;
  } = $props();

  const unique = $derived(item.uniqueId ? UNIQUES[item.uniqueId] ?? null : null);
  const set = $derived(item.setId ? SETS[item.setId] ?? null : null);
  const setWorn = $derived(set ? wornSets[set.id] ?? 0 : 0);

  const rarity = $derived(RARITY_RULES[item.rarity]);
  const implicit = $derived(itemImplicitStats(item));
  const deltas = $derived.by(() => {
    if (!compare) return [] as Array<[StatId, number]>;
    const mine: StatBlock = itemStats(item);
    const theirs: StatBlock = itemStats(compare);
    return STAT_IDS.map((stat): [StatId, number] => [stat, (mine[stat] ?? 0) - (theirs[stat] ?? 0)]).filter(([, value]) => Math.abs(value) >= 0.05);
  });
  const tooHigh = $derived(heroLevel !== null && item.level > heroLevel + EQUIP_LEVEL_MARGIN);
  const icon = $derived(itemIcon(item));
  const className = (id: string) => (m as unknown as Record<string, () => string>)[`adventure.class_${id}`]?.() ?? id;
</script>

<div class="details" style:--rarity={rarity.color} style:--rarity-ink={rarityInk(item.rarity)}>
  <header>
    <span class="frame"><ItemIcon atlasId={icon.atlas} frame={icon.frame} size={44} /></span>
    <div>
      <b>{itemName(catalog, item)}</b>
      <span class="meta">{[catalog.rarities[item.rarity], catalog.slots[item.slot], item.classId ? className(item.classId) : null].filter(Boolean).join(' · ')}</span>
      <span class="meta" class:warn={tooHigh}>{m['adventure.item_level']({ level: item.level })}</span>
    </div>
  </header>
  <ul class="stats">
    {#each Object.entries(implicit) as [stat, value] (stat)}<li>{statText(catalog, stat as StatId, value)}</li>{/each}
  </ul>
  {#if unique}
    <div class="unique">
      <span class="tag">{m['adventure.item_unique']()}</span>
      <ul>{#each statLines(catalog, uniqueStats(unique.id, rarityIndex(item.rarity))) as line (line)}<li>{line}</li>{/each}</ul>
      <p>{catalog.powers[unique.power]}</p>
    </div>
  {/if}
  {#if set}
    <div class="set">
      <span class="tag">{m['adventure.item_set']({ set: catalog.sets[set.id], count: setWorn, total: SET_PIECES.length })}</span>
      <ul>
        <li class:on={setWorn >= 2}>(2) {statLines(catalog, set.bonuses[2]).join(', ')}</li>
        <li class:on={setWorn >= 4}>(4) {statLines(catalog, set.bonuses[4]).join(', ')}</li>
        <li class:on={setWorn >= 6}>(6) {catalog.powers[set.power]}</li>
      </ul>
    </div>
  {/if}
  {#if item.affixes.length}
    <ul class="affixes">
      {#each item.affixes as affix (affix.stat)}<li>{statText(catalog, affix.stat, affix.value)}</li>{/each}
    </ul>
  {/if}
  {#if item.sockets.length}
    <ul class="sockets">
      {#each item.sockets as socket, index (index)}
        <li class:empty={!socket.material}>
          {#if socket.material}
            {@const gem = materialIcon(socket.material, socket.quality)}
            <ItemIcon atlasId={gem.atlas} frame={gem.frame} size={16} />
            {materialName(catalog, socket.material, socket.quality)}: {statLines(catalog, materialStats(socket.material, socket.quality, item.slot)).join(', ')}
          {:else}
            <span class="hole" aria-hidden="true"></span>{m['adventure.empty_socket']({ kind: catalog.sockets[socket.kind] })}
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
  {#if deltas.length}
    <ul class="compare" aria-label={m['adventure.compare_label']()}>
      {#each deltas as [stat, value] (stat)}<li class:up={value > 0} class:down={value < 0}>{statText(catalog, stat, value)}</li>{/each}
    </ul>
  {/if}
  <footer>{m['adventure.item_value']({ gold: itemGoldValue(item) })}</footer>
</div>

<style>
  .details {
    display: grid;
    gap: 6px;
    width: 250px;
    font-size: 12px;
    line-height: 1.35;
    color: var(--app-text);
  }

  header {
    display: flex;
    gap: 8px;
    align-items: center;
  }

  header > div {
    display: grid;
    min-width: 0;
  }

  b {
    color: var(--rarity-ink);
    font-size: 13px;
  }

  .frame {
    border-radius: 6px;
    background: color-mix(in srgb, var(--rarity) 14%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--rarity) 55%, transparent);
  }

  .meta {
    color: var(--app-text-muted);
    font-size: 11.5px;
  }

  .warn {
    color: var(--app-danger);
  }

  ul {
    display: grid;
    gap: 2px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .stats {
    color: var(--app-text);
  }

  .affixes {
    color: var(--adventure-ink-affix);
  }

  .unique,
  .set {
    display: grid;
    gap: 3px;
    padding: 6px 8px;
    border-radius: 6px;
    background: color-mix(in srgb, var(--accent-tone) 10%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent-tone) 35%, transparent);
  }

  .unique {
    --accent-tone: #ff9b30;
    --tag-ink: var(--adventure-ink-unique);
    color: var(--adventure-ink-unique);
  }

  .set {
    --accent-tone: #3ddc97;
    --tag-ink: var(--adventure-ink-set);
    color: var(--app-text-muted);
  }

  .unique p {
    margin: 0;
    color: var(--app-text);
  }

  .tag {
    color: var(--tag-ink);
    font-weight: 600;
  }

  .set li.on {
    color: var(--adventure-ink-set);
  }

  .sockets li {
    display: flex;
    align-items: center;
    gap: 5px;
    color: var(--app-text-soft);
  }

  .sockets li.empty {
    color: var(--app-text-muted);
  }

  .hole {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    box-shadow: inset 0 0 0 1.5px var(--app-border-strong);
  }

  .compare {
    padding-top: 4px;
    border-top: 1px solid var(--app-border);
  }

  .up {
    color: var(--app-success);
  }

  .down {
    color: var(--app-danger);
  }

  footer {
    color: var(--app-text-muted);
    font-size: 11.5px;
  }
</style>
