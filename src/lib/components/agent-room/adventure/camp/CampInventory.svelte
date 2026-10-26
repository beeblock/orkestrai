<script lang="ts">
  import { Archive, Coins, Lock, LockOpen, PackageOpen, Trash2 } from '@lucide/svelte';
  import { Button } from '$lib/components/ui/button';
  import { SegmentedControl } from '$lib/components/ui/segmented';
  import * as NativeSelect from '$lib/components/ui/native-select';
  import type { AdventureCatalog } from '$lib/i18n/adventure/index.js';
  import { MATERIALS, MATERIAL_IDS, RARITIES, RARITY_RULES, SLOTS, canEquip, itemGoldValue, rarityIndex, type Item, type Rarity, type Slot } from '$lib/modules/agent-room/domain/adventure/items.js';
  import { CHEST_TIERS, type ChestTier } from '$lib/modules/agent-room/domain/adventure/loot.js';
  import { runeRule } from '$lib/modules/agent-room/domain/adventure/runes.js';
  import { DIFFICULTIES } from '$lib/modules/agent-room/domain/adventure/world.js';
  import * as m from '$lib/paraglide/messages.js';
  import type { AdventureAction, AdventureOutcome, AdventureSnapshot } from '../adventure-client.js';
  import type { HeroView } from '../adventure-party.js';
  import { formatNumber, heroLevelText, itemName } from '../adventure-text.js';
  import ItemDetails from './ItemDetails.svelte';
  import ItemIcon from './ItemIcon.svelte';
  import ItemSlot from './ItemSlot.svelte';

  let { snapshot, catalog, heroes, act, busy }: {
    snapshot: AdventureSnapshot;
    catalog: AdventureCatalog;
    heroes: HeroView[];
    act: (action: AdventureAction) => Promise<AdventureOutcome | null>;
    busy: boolean;
  } = $props();

  const CHEST_FRAME: Record<ChestTier, number> = { white: 0, blue: 1, red: 2, quest: 3 };

  let place = $state<'inventory' | 'stash'>('inventory');
  let slotFilter = $state<Slot | ''>('');
  let rarityFilter = $state<Rarity | ''>('');
  let focused = $state<string | null>(null);
  let picking = $state(false);
  let picked = $state<string[]>([]);
  let revealed = $state<Item[]>([]);
  let equipTo = $state<string>('');

  const items = $derived(snapshot.items
    .filter((item) => item.location === place)
    .filter((item) => !slotFilter || item.slot === slotFilter)
    .filter((item) => !rarityFilter || item.rarity === rarityFilter)
    .sort((a, b) => rarityIndex(b.rarity) - rarityIndex(a.rarity) || b.level - a.level));
  const counts = $derived({
    inventory: snapshot.items.filter((item) => item.location === 'inventory').length,
    stash: snapshot.items.filter((item) => item.location === 'stash').length,
  });
  const focus = $derived(snapshot.items.find((item) => item.id === focused) ?? null);
  const chestsByTier = $derived(Object.fromEntries(CHEST_TIERS.map((tier) => [tier, snapshot.account.chests.filter((chest) => chest.tier === tier).length])) as Record<ChestTier, number>);
  const able = $derived(focus ? heroes.filter((hero) => canEquip(focus, { classId: hero.classId, level: hero.level }) === 'ok') : []);
  const target = $derived(able.find((hero) => hero.id === equipTo) ?? able[0] ?? null);
  const worn = $derived(focus && target ? snapshot.items.find((item) => item.location === 'equipped' && item.heroId === target.id && item.slot === focus.slot) ?? null : null);
  const pickedGold = $derived(snapshot.items.filter((item) => picked.includes(item.id)).reduce((sum, item) => sum + itemGoldValue(item, runeRule(snapshot.account.runes, 'alchemy')), 0));
  const junk = $derived(snapshot.items.filter((item) => item.location === 'inventory' && !item.locked && rarityIndex(item.rarity) <= 1));

  async function openChests(tier: ChestTier) {
    const outcome = await act({ type: 'open-chests', tier, limit: 10 });
    if (outcome) revealed = outcome.opened.flatMap((opened) => opened.items).sort((a, b) => rarityIndex(b.rarity) - rarityIndex(a.rarity));
  }

  function choose(item: Item) {
    if (picking) {
      picked = picked.includes(item.id) ? picked.filter((id) => id !== item.id) : [...picked, item.id];
      return;
    }
    focused = focused === item.id ? null : item.id;
  }

  async function salvage(ids: string[]) {
    if (!ids.length) return;
    await act({ type: 'salvage', itemIds: ids });
    picked = [];
    if (focused && ids.includes(focused)) focused = null;
  }
</script>

<div class="inventory">
  <section class="chests" aria-label={m['adventure.camp_chests']()}>
    {#each CHEST_TIERS as tier (tier)}
      <div class="chest" class:none={!chestsByTier[tier]}>
        <ItemIcon atlasId="icons-misc" frame={CHEST_FRAME[tier]} size={34} dim={!chestsByTier[tier]} />
        <span class="label"><b>{catalog.chests[tier]}</b><span>{chestsByTier[tier]}</span></span>
        <Button size="sm" variant={chestsByTier[tier] ? 'default' : 'ghost'} disabled={busy || !chestsByTier[tier]} onclick={() => void openChests(tier)} data-testid={`camp-open-${tier}`}>
          <PackageOpen size={14} aria-hidden="true" />{m['adventure.camp_open']()}
        </Button>
      </div>
    {/each}
    <div class="wallet">
      <span title={m['adventure.camp_soulstones']()}><ItemIcon atlasId="icons-misc" frame={4} size={22} />{#each DIFFICULTIES as difficulty (difficulty)}{#if snapshot.account.soulstones[difficulty]}<small>{catalog.difficulties[difficulty]} {snapshot.account.soulstones[difficulty]}</small>{/if}{/each}{#if !Object.values(snapshot.account.soulstones).some(Boolean)}<small>0</small>{/if}</span>
      <span title={m['adventure.camp_coins']()}><ItemIcon atlasId="icons-misc" frame={5} size={22} /><small>{snapshot.account.coins}</small></span>
      {#each MATERIAL_IDS as material (material)}
        {#if snapshot.account.materials[material]}
          <span title={catalog.materials[material]}><ItemIcon atlasId="icons-materials" frame={MATERIALS[material].icon} size={22} /><small>{snapshot.account.materials[material]}</small></span>
        {/if}
      {/each}
    </div>
  </section>

  {#if revealed.length}
    <section class="reveal" aria-live="polite">
      <header><b>{m['adventure.camp_found']({ count: revealed.length })}</b><Button size="sm" variant="ghost" onclick={() => (revealed = [])}>{m['adventure.camp_close']()}</Button></header>
      <div class="grid">
        {#each revealed as item (item.id)}<ItemSlot {item} {catalog} onclick={() => { focused = item.id; revealed = []; }} />{/each}
      </div>
    </section>
  {/if}

  <div class="body">
    <section class="bag">
      <header class="toolbar">
        <SegmentedControl
          label={m['adventure.camp_place']()}
          value={place}
          onValueChange={(value: string) => { place = value as 'inventory' | 'stash'; focused = null; }}
          options={[
            { value: 'inventory', label: m['adventure.camp_bag']({ count: counts.inventory, max: snapshot.limits.inventory }) },
            { value: 'stash', label: m['adventure.camp_stash']({ count: counts.stash, max: snapshot.limits.stash }) },
          ]}
        />
        <NativeSelect.Root size="sm" class="w-[130px]" value={slotFilter} onchange={(event: Event) => (slotFilter = (event.currentTarget as HTMLSelectElement).value as Slot | '')} aria-label={m['adventure.camp_filter_slot']()}>
          <NativeSelect.Option value="">{m['adventure.camp_all_slots']()}</NativeSelect.Option>
          {#each SLOTS as slot (slot)}<NativeSelect.Option value={slot}>{catalog.slots[slot]}</NativeSelect.Option>{/each}
        </NativeSelect.Root>
        <NativeSelect.Root size="sm" class="w-[130px]" value={rarityFilter} onchange={(event: Event) => (rarityFilter = (event.currentTarget as HTMLSelectElement).value as Rarity | '')} aria-label={m['adventure.camp_filter_rarity']()}>
          <NativeSelect.Option value="">{m['adventure.camp_all_rarities']()}</NativeSelect.Option>
          {#each RARITIES as rarity (rarity)}<NativeSelect.Option value={rarity}>{catalog.rarities[rarity]}</NativeSelect.Option>{/each}
        </NativeSelect.Root>
        <Button size="sm" variant={picking ? 'default' : 'outline'} onclick={() => { picking = !picking; picked = []; }}>{picking ? m['adventure.camp_done_selecting']() : m['adventure.camp_select']()}</Button>
        {#if picking}
          <Button size="sm" variant="outline" disabled={busy || !picked.length} onclick={() => void salvage(picked)}><Coins size={14} aria-hidden="true" />{m['adventure.camp_salvage_selected']({ count: picked.length, gold: formatNumber(pickedGold) })}</Button>
        {:else if place === 'inventory' && junk.length}
          <Button size="sm" variant="ghost" disabled={busy} onclick={() => void salvage(junk.map((item) => item.id))}><Trash2 size={14} aria-hidden="true" />{m['adventure.camp_salvage_junk']({ count: junk.length })}</Button>
        {/if}
      </header>
      {#if items.length}
        <div class="grid" role="list">
          {#each items as item (item.id)}
            <div role="listitem"><ItemSlot {item} {catalog} locked={item.locked} selected={picking ? picked.includes(item.id) : focused === item.id} onclick={() => choose(item)} /></div>
          {/each}
        </div>
      {:else}
        <p class="empty">{place === 'inventory' ? m['adventure.camp_bag_empty']() : m['adventure.camp_stash_empty']()}</p>
      {/if}
    </section>

    {#if focus && !picking}
      <aside class="focus" aria-label={itemName(catalog, focus)} style:--rarity={RARITY_RULES[focus.rarity].color}>
        <ItemDetails item={focus} {catalog} compare={worn} heroLevel={target?.level ?? null} />
        {#if able.length}
          <div class="equip">
            <NativeSelect.Root size="sm" class="flex-1" value={target?.id ?? ''} onchange={(event: Event) => (equipTo = (event.currentTarget as HTMLSelectElement).value)} aria-label={m['adventure.camp_equip_on']()}>
              {#each able as hero (hero.id)}<NativeSelect.Option value={hero.id}>{hero.agent ? `${hero.name} (${hero.agent.title})` : hero.name} · {heroLevelText(hero.level, hero.paragon)}</NativeSelect.Option>{/each}
            </NativeSelect.Root>
            <Button size="sm" disabled={busy || !target} onclick={() => target && void act({ type: 'equip', itemId: focus.id, heroId: target.id }).then(() => (focused = null))}>{m['adventure.camp_equip']()}</Button>
          </div>
        {:else}
          <p class="hint">{m['adventure.camp_nobody_can_equip']()}</p>
        {/if}
        <div class="row">
          <Button size="sm" variant="ghost" disabled={busy} onclick={() => void act({ type: 'lock', itemId: focus.id, locked: !focus.locked })}>
            {#if focus.locked}<LockOpen size={14} aria-hidden="true" />{m['adventure.camp_unlock']()}{:else}<Lock size={14} aria-hidden="true" />{m['adventure.camp_lock']()}{/if}
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onclick={() => void act({ type: 'move', itemId: focus.id, location: focus.location === 'stash' ? 'inventory' : 'stash' })}>
            <Archive size={14} aria-hidden="true" />{focus.location === 'stash' ? m['adventure.camp_to_bag']() : m['adventure.camp_to_stash']()}
          </Button>
          <Button size="sm" variant="ghost" class="text-[var(--app-danger)]" disabled={busy || focus.locked} onclick={() => void salvage([focus.id])}>
            <Coins size={14} aria-hidden="true" />{m['adventure.camp_salvage_one']({ gold: formatNumber(itemGoldValue(focus, runeRule(snapshot.account.runes, 'alchemy'))) })}
          </Button>
        </div>
      </aside>
    {/if}
  </div>
</div>

<style>
  .inventory {
    display: grid;
    gap: 14px;
  }

  .chests {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 18px;
    padding: 10px 12px;
    border-radius: 10px;
    background: var(--app-surface);
    box-shadow: inset 0 0 0 1px var(--app-border);
  }

  .chest {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .chest .label {
    display: grid;
    font-size: 12px;
  }

  .chest .label span {
    color: var(--app-text-muted);
    font-variant-numeric: tabular-nums;
  }

  .chest.none .label b {
    color: var(--app-text-muted);
    font-weight: 500;
  }

  .wallet {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 12px;
    margin-left: auto;
  }

  .wallet > span {
    display: inline-flex;
    align-items: center;
    gap: 3px;
  }

  .wallet small {
    color: var(--app-text-soft);
    font-size: 11.5px;
    font-variant-numeric: tabular-nums;
  }

  .reveal {
    display: grid;
    gap: 8px;
    padding: 10px 12px;
    border-radius: 10px;
    background: color-mix(in srgb, var(--app-accent) 8%, var(--app-surface));
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--app-accent) 40%, transparent);
    animation: reveal-in 320ms cubic-bezier(0.2, 0.9, 0.3, 1.2);
  }

  .reveal header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  @keyframes reveal-in {
    from { opacity: 0; transform: translateY(6px); }
  }

  @media (prefers-reduced-motion: reduce) {
    .reveal { animation: none; }
  }

  .body {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 16px;
    align-items: start;
  }

  .bag {
    display: grid;
    gap: 10px;
    min-width: 0;
  }

  .toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }

  .grid {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .empty,
  .hint {
    margin: 0;
    color: var(--app-text-muted);
    font-size: 12px;
  }

  .focus {
    position: sticky;
    top: 12px;
    display: grid;
    gap: 10px;
    width: 280px;
    padding: 12px;
    border-radius: 10px;
    background: var(--app-surface);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--rarity) 45%, var(--app-border));
  }

  .equip,
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
</style>
