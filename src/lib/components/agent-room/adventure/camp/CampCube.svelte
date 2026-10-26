<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import { Slider } from '$lib/components/ui/slider';
  import * as NativeSelect from '$lib/components/ui/native-select';
  import type { AdventureCatalog } from '$lib/i18n/adventure/index.js';
  import { HERO_CLASS_IDS, type HeroClassId } from '$lib/modules/agent-room/domain/adventure/catalog.js';
  import {
    COINS_PER_OFFERING, CRAFT_GEMS, CUBE_UNLOCKS, SYNTHESIS_INPUTS, craftCost, cubeAllows, cubeXpToNext, removalCost, socketFunction, synthesisCost, type CubeFunction,
  } from '$lib/modules/agent-room/domain/adventure/cube.js';
  import {
    GEM_FUSION_INPUTS, GEM_QUALITIES, MATERIALS, MATERIAL_IDS, RARITIES, SLOTS, classSlot, gemFusionCost, materialIcon, materialKey, rarityIndex,
    type GemQuality, type Item, type MaterialId, type Rarity, type Slot,
  } from '$lib/modules/agent-room/domain/adventure/items.js';
  import * as m from '$lib/paraglide/messages.js';
  import type { AdventureAction, AdventureOutcome, AdventureSnapshot } from '../adventure-client.js';
  import type { HeroView } from '../adventure-party.js';
  import { formatNumber, itemName, materialName } from '../adventure-text.js';
  import ItemIcon from './ItemIcon.svelte';
  import ItemSlot from './ItemSlot.svelte';

  let { snapshot, catalog, heroes, act, busy }: {
    snapshot: AdventureSnapshot;
    catalog: AdventureCatalog;
    heroes: HeroView[];
    act: (action: AdventureAction) => Promise<AdventureOutcome | null>;
    busy: boolean;
  } = $props();

  const cube = $derived(snapshot.account.cube);
  const loose = $derived(snapshot.items.filter((item) => item.location !== 'equipped' && !item.locked));

  // Synthesis.
  let synthRarity = $state<Rarity>('common');
  const synthPool = $derived(loose.filter((item) => item.rarity === synthRarity).sort((a, b) => a.level - b.level));
  const synthCost = $derived(synthPool.length >= SYNTHESIS_INPUTS ? synthesisCost(synthRarity, Math.max(...synthPool.slice(0, SYNTHESIS_INPUTS).map((item) => item.level))) : 0);
  let created = $state<Item | null>(null);

  // Crafting.
  let craftSlot = $state<Slot>('ring');
  // svelte-ignore state_referenced_locally
  let craftClass = $state<HeroClassId>(heroes[0]?.classId ?? 'knight');
  let craftLevel = $state(1);
  const maxLevel = $derived(snapshot.highestRegionLevel);
  const gems = $derived(MATERIAL_IDS.filter((id) => MATERIALS[id].socket === 'decoration'));
  let gemA = $state<MaterialId>('ruby');
  let gemB = $state<MaterialId>('sapphire');
  const haveGems = $derived.by(() => {
    const need: Partial<Record<MaterialId, number>> = {};
    for (const gem of [gemA, gemB]) need[gem] = (need[gem] ?? 0) + 1;
    return (Object.entries(need) as Array<[MaterialId, number]>).every(([gem, count]) => gemsOf(gem) >= count);
  });

  /** Gems of a kind in the bag, every cut. */
  function gemsOf(gem: MaterialId): number {
    return GEM_QUALITIES.reduce((sum, quality) => sum + (snapshot.account.materials[materialKey(gem, quality)] ?? 0), 0);
  }

  function owned(material: MaterialId, quality: GemQuality): number {
    return snapshot.account.materials[materialKey(material, quality)] ?? 0;
  }

  /** What can go into a socket of a kind: gems by cut, runestones and glyphs as they are. */
  function socketChoices(kind: Item['sockets'][number]['kind']): Array<{ material: MaterialId; quality: GemQuality }> {
    return MATERIAL_IDS.filter((id) => MATERIALS[id].socket === kind)
      .flatMap((material) => (kind === 'decoration' ? GEM_QUALITIES : ([3] as GemQuality[])).map((quality) => ({ material, quality })))
      .filter((choice) => owned(choice.material, choice.quality) > 0 || (kind !== 'decoration' && choice.quality === 3));
  }

  // Gem fusion: every gem and cut below Imperial the bag holds.
  const fusable = $derived(gems.flatMap((gem) => GEM_QUALITIES.filter((quality) => quality < 5 && owned(gem, quality) > 0).map((quality) => ({ gem, quality }))));

  // Sockets.
  let socketItemId = $state<string | null>(null);
  const socketable = $derived(snapshot.items.filter((item) => item.sockets.length).sort((a, b) => rarityIndex(b.rarity) - rarityIndex(a.rarity) || b.level - a.level));
  const socketItem = $derived(socketable.find((item) => item.id === socketItemId) ?? null);

  $effect(() => {
    if (craftLevel > maxLevel) craftLevel = maxLevel;
  });

  function locked(fn: CubeFunction): boolean {
    return !cubeAllows(cube.level, fn);
  }

  async function synthesize() {
    const outcome = await act({ type: 'synthesize', itemIds: synthPool.slice(0, SYNTHESIS_INPUTS).map((item) => item.id) });
    created = (outcome?.result as { item?: Item } | undefined)?.item ?? null;
  }

  async function craftNow() {
    const outcome = await act({ type: 'craft', slot: craftSlot, level: craftLevel, classId: classSlot(craftSlot) ? craftClass : null, gems: [gemA, gemB] });
    created = (outcome?.result as { item?: Item } | undefined)?.item ?? null;
  }

  async function offer() {
    const outcome = await act({ type: 'offering' });
    created = (outcome?.result as { item?: Item } | undefined)?.item ?? null;
  }

  const className = (id: HeroClassId) => (m as unknown as Record<string, () => string>)[`adventure.class_${id}`]?.() ?? id;
</script>

<div class="cube">
  <header class="level">
    <ItemIcon atlasId="icons-misc" frame={7} size={40} />
    <div>
      <b>{m['adventure.camp_cube_title']()} · {m['adventure.level']({ level: cube.level })}</b>
      <span class="xp"><span style:width={`${Number.isFinite(cubeXpToNext(cube.level)) ? Math.min(100, (cube.xp / cubeXpToNext(cube.level)) * 100) : 100}%`}></span></span>
      <small>{m['adventure.camp_cube_hint']()}</small>
    </div>
  </header>

  {#if created}
    <div class="created" aria-live="polite">
      <ItemSlot item={created} {catalog} />
      <span>{m['adventure.camp_created']({ item: itemName(catalog, created), rarity: catalog.rarities[created.rarity] })}</span>
      <Button size="sm" variant="ghost" onclick={() => (created = null)}>{m['adventure.camp_close']()}</Button>
    </div>
  {/if}

  <div class="functions">
    <section class:locked={locked('synthesis')}>
      <h3>{catalog.cube.synthesis.name}</h3>
      <p>{catalog.cube.synthesis.description}</p>
      <div class="controls">
        <NativeSelect.Root size="sm" class="w-[150px]" value={synthRarity} onchange={(event: Event) => (synthRarity = (event.currentTarget as HTMLSelectElement).value as Rarity)} aria-label={m['adventure.camp_filter_rarity']()}>
          {#each RARITIES.slice(0, -1) as rarity (rarity)}<NativeSelect.Option value={rarity}>{catalog.rarities[rarity]} ({loose.filter((item) => item.rarity === rarity).length})</NativeSelect.Option>{/each}
        </NativeSelect.Root>
        <Button size="sm" disabled={busy || synthPool.length < SYNTHESIS_INPUTS || snapshot.account.gold < synthCost} onclick={() => void synthesize()}>
          {m['adventure.camp_synthesize']({ count: SYNTHESIS_INPUTS, gold: formatNumber(synthCost) })}
        </Button>
      </div>
      <small>{m['adventure.camp_synthesis_have']({ count: synthPool.length, needed: SYNTHESIS_INPUTS })}</small>
    </section>

    <section class:locked={locked('crafting')}>
      <h3>{catalog.cube.crafting.name}</h3>
      <p>{catalog.cube.crafting.description}</p>
      {#if locked('crafting')}<small>{m['adventure.camp_cube_needs']({ level: CUBE_UNLOCKS.crafting })}</small>{:else}
        <div class="controls">
          <NativeSelect.Root size="sm" class="w-[120px]" value={craftSlot} onchange={(event: Event) => (craftSlot = (event.currentTarget as HTMLSelectElement).value as Slot)} aria-label={m['adventure.camp_filter_slot']()}>
            {#each SLOTS as slot (slot)}<NativeSelect.Option value={slot}>{catalog.slots[slot]}</NativeSelect.Option>{/each}
          </NativeSelect.Root>
          {#if classSlot(craftSlot)}
            <NativeSelect.Root size="sm" class="w-[130px]" value={craftClass} onchange={(event: Event) => (craftClass = (event.currentTarget as HTMLSelectElement).value as HeroClassId)} aria-label={m['adventure.class_pick']()}>
              {#each HERO_CLASS_IDS as classId (classId)}<NativeSelect.Option value={classId}>{className(classId)}</NativeSelect.Option>{/each}
            </NativeSelect.Root>
          {/if}
          {#each [0, 1] as index (index)}
            <NativeSelect.Root size="sm" class="w-[130px]" value={index ? gemB : gemA} onchange={(event: Event) => { const value = (event.currentTarget as HTMLSelectElement).value as MaterialId; if (index) gemB = value; else gemA = value; }} aria-label={m['adventure.camp_gem']({ index: index + 1 })}>
              {#each gems as gem (gem)}<NativeSelect.Option value={gem}>{catalog.materials[gem]} ({gemsOf(gem)})</NativeSelect.Option>{/each}
            </NativeSelect.Root>
          {/each}
        </div>
        <div class="field">
          <span>{m['adventure.camp_item_level_pick']({ level: craftLevel, max: maxLevel })}</span>
          <Slider type="single" value={craftLevel} min={1} max={maxLevel} step={1} onValueChange={(value: number) => (craftLevel = value)} aria-label={m['adventure.camp_item_level_pick']({ level: craftLevel, max: maxLevel })} />
        </div>
        <Button size="sm" class="w-fit" disabled={busy || !haveGems || snapshot.account.gold < craftCost(craftLevel)} onclick={() => void craftNow()}>
          {m['adventure.camp_craft']({ gold: formatNumber(craftCost(craftLevel)), gems: CRAFT_GEMS })}
        </Button>
      {/if}
    </section>

    <section class="sockets" class:locked={locked('decoration')}>
      <h3>{m['adventure.camp_sockets']()}</h3>
      <p>{catalog.cube.decoration.description} {catalog.cube.engraving.description} {catalog.cube.inscription.description}</p>
      <div class="grid">
        {#each socketable as item (item.id)}<ItemSlot {item} {catalog} size={42} selected={socketItemId === item.id} onclick={() => (socketItemId = socketItemId === item.id ? null : item.id)} />{/each}
        {#if !socketable.length}<small>{m['adventure.camp_no_sockets']()}</small>{/if}
      </div>
      {#if socketItem}
        <ul class="socket-list">
          {#each socketItem.sockets as socket, index (index)}
            <li>
              <span class="kind">{catalog.sockets[socket.kind]}</span>
              {#if socket.material}
                {@const icon = materialIcon(socket.material, socket.quality)}
                <ItemIcon atlasId={icon.atlas} frame={icon.frame} size={22} />
                <span>{materialName(catalog, socket.material, socket.quality)}</span>
                <Button size="sm" variant="ghost" disabled={busy || locked('removal') || socketItem.location === 'equipped'} title={socketItem.location === 'equipped' ? catalog.errors.equipped : ''} onclick={() => void act({ type: 'unsocket', itemId: socketItem.id, socketIndex: index })}>
                  {m['adventure.camp_remove']({ gold: formatNumber(removalCost(socketItem)) })}
                </Button>
              {:else if locked(socketFunction(socket.kind))}
                <small>{m['adventure.camp_cube_needs']({ level: CUBE_UNLOCKS[socketFunction(socket.kind)] })}</small>
              {:else}
                <div class="materials">
                  {#each socketChoices(socket.kind) as choice (`${choice.material}:${choice.quality}`)}
                    {@const icon = materialIcon(choice.material, choice.quality)}
                    <Button size="sm" variant="outline" disabled={busy || !owned(choice.material, choice.quality)} onclick={() => void act({ type: 'socket', itemId: socketItem.id, socketIndex: index, material: choice.material, quality: choice.quality })} title={materialName(catalog, choice.material, choice.quality)} aria-label={materialName(catalog, choice.material, choice.quality)}>
                      <ItemIcon atlasId={icon.atlas} frame={icon.frame} size={18} />{owned(choice.material, choice.quality)}
                    </Button>
                  {/each}
                </div>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    <section class:locked={locked('fusion')}>
      <h3>{catalog.cube.fusion.name}</h3>
      <p>{catalog.cube.fusion.description}</p>
      {#if locked('fusion')}<small>{m['adventure.camp_cube_needs']({ level: CUBE_UNLOCKS.fusion })}</small>{:else if !fusable.length}<small>{m['adventure.camp_fusion_none']()}</small>{:else}
        <ul class="fusion">
          {#each fusable as entry (`${entry.gem}:${entry.quality}`)}
            {@const from = materialIcon(entry.gem, entry.quality)}
            {@const to = materialIcon(entry.gem, (entry.quality + 1) as GemQuality)}
            <li>
              <ItemIcon atlasId={from.atlas} frame={from.frame} size={22} />
              <span>{materialName(catalog, entry.gem, entry.quality)} · {owned(entry.gem, entry.quality)}</span>
              <span aria-hidden="true">→</span>
              <ItemIcon atlasId={to.atlas} frame={to.frame} size={22} />
              <Button size="sm" variant="outline" disabled={busy || owned(entry.gem, entry.quality) < GEM_FUSION_INPUTS || snapshot.account.gold < gemFusionCost(entry.quality)} onclick={() => void act({ type: 'fuse-gems', gem: entry.gem, quality: entry.quality })}>
                {m['adventure.camp_fuse']({ gold: formatNumber(gemFusionCost(entry.quality)) })}
              </Button>
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    <section class:locked={locked('offering')}>
      <h3>{catalog.cube.offering.name}</h3>
      <p>{catalog.cube.offering.description}</p>
      {#if locked('offering')}<small>{m['adventure.camp_cube_needs']({ level: CUBE_UNLOCKS.offering })}</small>{:else}
        <Button size="sm" class="w-fit" disabled={busy || snapshot.account.coins < COINS_PER_OFFERING} onclick={() => void offer()}>
          <ItemIcon atlasId="icons-misc" frame={5} size={18} />{m['adventure.camp_offer']({ coins: snapshot.account.coins, needed: COINS_PER_OFFERING })}
        </Button>
      {/if}
    </section>

    <section>
      <h3>{catalog.cube.alchemy.name}</h3>
      <p>{catalog.cube.alchemy.description}</p>
      <small>{m['adventure.camp_alchemy_hint']()}</small>
    </section>
  </div>
</div>

<style>
  .cube {
    display: grid;
    gap: 14px;
  }

  .level {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .level > div {
    display: grid;
    gap: 4px;
    min-width: 260px;
  }

  .level small,
  section small {
    color: var(--app-text-muted);
    font-size: 11.5px;
  }

  .xp {
    position: relative;
    height: 5px;
    border-radius: 3px;
    background: var(--app-hover);
    overflow: hidden;
  }

  .xp > span {
    position: absolute;
    inset: 0 auto 0 0;
    background: linear-gradient(90deg, #2fa7a0, #38e2d9);
  }

  .created {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 12px;
    border-radius: 10px;
    background: color-mix(in srgb, var(--app-accent) 8%, var(--app-surface));
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--app-accent) 40%, transparent);
    font-size: 13px;
  }

  .functions {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    gap: 12px;
  }

  section {
    display: grid;
    align-content: start;
    gap: 8px;
    padding: 12px;
    border-radius: 10px;
    background: var(--app-surface);
    box-shadow: inset 0 0 0 1px var(--app-border);
  }

  section.locked {
    opacity: 0.6;
  }

  section.sockets {
    grid-column: 1 / -1;
  }

  h3 {
    margin: 0;
    font-size: 13.5px;
    font-weight: 600;
  }

  section > p {
    margin: 0;
    color: var(--app-text-soft);
    font-size: 12px;
  }

  .controls,
  .materials,
  .grid {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
  }

  .field {
    display: grid;
    gap: 6px;
    max-width: 300px;
    color: var(--app-text-soft);
    font-size: 12px;
  }

  .socket-list {
    display: grid;
    gap: 6px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .socket-list li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    font-size: 12px;
  }

  .kind {
    min-width: 90px;
    color: var(--app-text-muted);
  }

  .fusion {
    display: grid;
    gap: 6px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  /* Icon, name and count, arrow, next cut, button: the same columns on every row. */
  .fusion li {
    display: grid;
    grid-template-columns: 22px minmax(0, 1fr) 12px 22px auto;
    gap: 6px;
    align-items: center;
    font-size: 12px;
  }
</style>
