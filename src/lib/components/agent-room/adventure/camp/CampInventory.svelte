<script lang="ts">
  import { Archive, Coins, Lock, LockOpen, PackageOpen, Trash2 } from '@lucide/svelte';
  import { Button } from '$lib/components/ui/button';
  import { SegmentedControl } from '$lib/components/ui/segmented';
  import * as NativeSelect from '$lib/components/ui/native-select';
  import { Switch } from '$lib/components/ui/switch';
  import { SALVAGE_LEVELS, type SalvageLevel } from '$lib/modules/agent-room/domain/adventure/account.js';
  import type { AdventureCatalog } from '$lib/i18n/adventure/index.js';
  import { ELIXIRS, ELIXIR_ATLAS, ELIXIR_IDS, type ElixirId, type SetId } from '$lib/modules/agent-room/domain/adventure/artifacts.js';
  import { MATERIAL_IDS, RARITIES, RARITY_RULES, SLOTS, canEquip, itemGoldValue, materialIcon, parseMaterialKey, rarityIndex, type Item, type Rarity, type Slot } from '$lib/modules/agent-room/domain/adventure/items.js';
  import { CHEST_TIERS, type ChestTier } from '$lib/modules/agent-room/domain/adventure/loot.js';
  import { runeRule } from '$lib/modules/agent-room/domain/adventure/runes.js';
  import { DIFFICULTIES } from '$lib/modules/agent-room/domain/adventure/world.js';
  import * as m from '$lib/paraglide/messages.js';
  import type { AdventureAction, AdventureOutcome, AdventureSnapshot } from '../adventure-client.js';
  import type { HeroView } from '../adventure-party.js';
  import { formatNumber, heroLevelText, itemName, materialName, statLines } from '../adventure-text.js';
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
  // What became of each revealed item: put on by a hero (id) or salvaged.
  let fate = $state<Record<string, { heroId?: string; salvaged?: boolean }>>({});
  const heroNames = $derived(Object.fromEntries(snapshot.heroes.map((hero) => [hero.id, hero.name])));
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
  // The bag shows every slot it has: the empty ones wait as wells (filters show only matches).
  const capacity = $derived(place === 'inventory' ? snapshot.limits.inventory : snapshot.limits.stash);
  const emptyWells = $derived(slotFilter || rarityFilter ? 0 : Math.max(0, Math.min(capacity, 120) - items.length));
  const junk = $derived(snapshot.items.filter((item) => item.location === 'inventory' && !item.locked && rarityIndex(item.rarity) <= 1));
  /** Materials in the bag, gems by cut, in catalog order. */
  const materials = $derived(Object.entries(snapshot.account.materials)
    .map(([key, count]) => ({ key, count, parsed: parseMaterialKey(key) }))
    .filter((entry): entry is { key: string; count: number; parsed: NonNullable<ReturnType<typeof parseMaterialKey>> } => Boolean(entry.parsed) && entry.count > 0)
    .sort((a, b) => MATERIAL_IDS.indexOf(a.parsed.material) - MATERIAL_IDS.indexOf(b.parsed.material) || a.parsed.quality - b.parsed.quality));
  // Ticks so the elixirs' time left counts down while the camp is open.
  let clock = $state(Date.now());
  $effect(() => {
    const timer = setInterval(() => (clock = Date.now()), 30_000);
    return () => clearInterval(timer);
  });
  function minutesLeft(elixirId: ElixirId): number {
    const until = snapshot.account.activeElixirs?.[elixirId];
    return until ? Math.max(0, Math.ceil((Date.parse(until) - clock) / 60_000)) : 0;
  }

  async function openChests(tier: ChestTier) {
    const outcome = await act({ type: 'open-chests', tier, limit: 10 });
    if (!outcome) return;
    revealed = outcome.opened.flatMap((opened) => opened.items).sort((a, b) => rarityIndex(b.rarity) - rarityIndex(a.rarity));
    fate = Object.fromEntries(outcome.opened.flatMap((opened) => [
      ...Object.entries(opened.equipped ?? {}).map(([itemId, heroId]) => [itemId, { heroId }] as const),
      ...(opened.salvaged ?? []).map((itemId) => [itemId, { salvaged: true }] as const),
    ]));
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
  <section class="automation camp-panel" aria-label={m['adventure.camp_automation']()}>
    <h3 class="camp-heading">{m['adventure.camp_automation']()}</h3>
    <div class="orders">
      <label class="toggle">
        <Switch checked={snapshot.account.settings.autoOpen} disabled={busy} onCheckedChange={(value: boolean) => void act({ type: 'settings', settings: { autoOpen: value } })} aria-label={m['adventure.camp_auto_open']()} data-testid="camp-auto-open" />
        <span><b>{m['adventure.camp_auto_open']()}</b><small>{m['adventure.camp_auto_open_hint']()}</small></span>
      </label>
      <div class="toggle">
        <NativeSelect.Root size="sm" class="w-auto min-w-[170px] shrink-0" value={snapshot.account.settings.autoSalvage ?? 'off'} disabled={busy} onchange={(event: Event) => void act({ type: 'settings', settings: { autoSalvage: (event.currentTarget as HTMLSelectElement).value as SalvageLevel } })} aria-label={m['adventure.camp_auto_salvage']()} data-testid="camp-auto-salvage">
          {#each SALVAGE_LEVELS as level (level)}
            <NativeSelect.Option value={level}>{level === 'off' ? m['adventure.camp_salvage_off']() : m['adventure.camp_salvage_up_to']({ rarity: catalog.rarities[level] })}</NativeSelect.Option>
          {/each}
        </NativeSelect.Root>
        <span><b>{m['adventure.camp_auto_salvage']()}</b><small>{m['adventure.camp_auto_salvage_hint']()}</small></span>
      </div>
    </div>
  </section>

  <section class="treasure" aria-label={m['adventure.camp_chests']()}>
    {#each CHEST_TIERS as tier (tier)}
      <div class={`chest camp-panel tier-${tier}`} class:none={!chestsByTier[tier]}>
        <span class="chest-art"><ItemIcon atlasId="icons-misc" frame={CHEST_FRAME[tier]} size={52} dim={!chestsByTier[tier]} />{#if chestsByTier[tier]}<span class="count">{chestsByTier[tier]}</span>{/if}</span>
        <b>{catalog.chests[tier]}</b>
        <Button size="sm" class={chestsByTier[tier] ? 'camp-gold-button' : ''} variant={chestsByTier[tier] ? 'default' : 'ghost'} disabled={busy || !chestsByTier[tier]} onclick={() => void openChests(tier)} data-testid={`camp-open-${tier}`}>
          <PackageOpen size={14} aria-hidden="true" />{m['adventure.camp_open']()}
        </Button>
      </div>
    {/each}
    <div class="purse camp-panel">
      <span class="coin" title={m['adventure.camp_soulstones']()}><ItemIcon atlasId="icons-misc" frame={4} size={26} />{#each DIFFICULTIES as difficulty (difficulty)}{#if snapshot.account.soulstones[difficulty]}<small>{catalog.difficulties[difficulty]} {snapshot.account.soulstones[difficulty]}</small>{/if}{/each}{#if !Object.values(snapshot.account.soulstones).some(Boolean)}<small>0</small>{/if}</span>
      <span class="coin" title={m['adventure.camp_coins']()}><ItemIcon atlasId="icons-misc" frame={5} size={26} /><small>{snapshot.account.coins}</small></span>
      {#each materials as entry (entry.key)}
        {@const icon = materialIcon(entry.parsed.material, entry.parsed.quality)}
        <span class="coin" title={materialName(catalog, entry.parsed.material, entry.parsed.quality)}><ItemIcon atlasId={icon.atlas} frame={icon.frame} size={26} /><small>{entry.count}</small></span>
      {/each}
    </div>
  </section>

  {#if revealed.length}
    <section class="reveal camp-panel ornate" aria-live="polite">
      <header><h3 class="camp-heading plain">{m['adventure.camp_found']({ count: revealed.length })}</h3><Button size="sm" variant="ghost" onclick={() => (revealed = [])}>{m['adventure.camp_close']()}</Button></header>
      <div class="found-grid">
        {#each revealed as item, index (item.id)}
          {@const outcome = fate[item.id]}
          <div class="found" class:salvaged={outcome?.salvaged} style:--delay={`${Math.min(index, 12) * 45}ms`}>
            <ItemSlot {item} {catalog} size={56} onclick={() => { if (outcome?.salvaged) return; focused = item.id; revealed = []; }} />
            {#if outcome?.heroId}<small>{m['adventure.camp_put_on_by']({ hero: heroNames[outcome.heroId] ?? '—' })}</small>
            {:else if outcome?.salvaged}<small>{m['adventure.camp_salvaged']()}</small>{/if}
          </div>
        {/each}
      </div>
    </section>
  {/if}

  <section class="shelf camp-panel" aria-label={m['adventure.camp_elixirs']()}>
    <header><h3 class="camp-heading plain">{m['adventure.camp_elixirs']()}</h3><small class="camp-muted">{m['adventure.camp_elixirs_hint']()}</small></header>
    <div class="potions">
      {#each ELIXIR_IDS as elixirId (elixirId)}
        {@const count = snapshot.account.elixirs?.[elixirId] ?? 0}
        {@const left = minutesLeft(elixirId)}
        <div class="potion" class:active={left > 0} class:empty={!count && !left}>
          <span class="flask camp-well"><ItemIcon atlasId={ELIXIR_ATLAS} frame={ELIXIRS[elixirId].frame} size={40} dim={!count && !left} />{#if count}<span class="count stock">{count}</span>{/if}</span>
          <span class="label">
            <b>{catalog.elixirs[elixirId]}</b>
            <span>{statLines(catalog, ELIXIRS[elixirId].stats).join(', ')}</span>
            {#if left > 0}<span class="left">{m['adventure.camp_elixir_left']({ minutes: left })}</span>{/if}
          </span>
          <Button size="sm" variant={count ? 'outline' : 'ghost'} disabled={busy || !count} onclick={() => void act({ type: 'drink', elixirId })} data-testid={`camp-drink-${elixirId}`}>{m['adventure.camp_drink']()}</Button>
        </div>
      {/each}
    </div>
  </section>

  <div class="body">
    <section class="bag camp-panel">
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
      {#if items.length || emptyWells}
        <div class="grid" role="list">
          {#each items as item (item.id)}
            <div role="listitem"><ItemSlot {item} {catalog} locked={item.locked} size={54} selected={picking ? picked.includes(item.id) : focused === item.id} onclick={() => choose(item)} /></div>
          {/each}
          {#each Array.from({ length: emptyWells }, (_, index) => index) as well (well)}<span class="well camp-well" aria-hidden="true"></span>{/each}
        </div>
      {:else}
        <p class="empty camp-muted">{place === 'inventory' ? m['adventure.camp_bag_empty']() : m['adventure.camp_stash_empty']()}</p>
      {/if}
    </section>
    {#if focus && !picking}
      <aside class="focus camp-panel ornate" aria-label={itemName(catalog, focus)} style:--rarity={RARITY_RULES[focus.rarity].color}>
        <ItemDetails item={focus} {catalog} compare={worn} heroLevel={target?.level ?? null} wornSets={(target?.build.sets ?? {}) as Partial<Record<SetId, number>>} />
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
    gap: 16px;
  }

  .automation {
    display: grid;
    gap: 10px;
    padding: 12px 16px 14px;
  }

  .orders {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
    gap: 12px 28px;
  }

  .toggle {
    display: flex;
    gap: 10px;
    align-items: flex-start;
  }

  label.toggle {
    cursor: pointer;
  }

  .toggle span {
    display: grid;
    gap: 2px;
    font-size: 12.5px;
  }

  .toggle small {
    color: var(--camp-ink-muted);
    font-size: 11.5px;
    line-height: 1.4;
  }

  /* Chests as treasure: the bigger the haul, the brighter the card. */
  .treasure {
    display: grid;
    grid-template-columns: repeat(4, minmax(130px, 1fr)) minmax(220px, 1.4fr);
    gap: 12px;
  }

  @media (max-width: 1100px) {
    .treasure { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    /* Stock on hand (potions) reads as a tally, not an alert. */
  .count.stock {
    background: linear-gradient(180deg, #f2cd72, #d39a32);
    color: #2a1a05;
  }

  .purse { grid-column: 1 / -1; }
  }

  .chest {
    display: grid;
    justify-items: center;
    gap: 6px;
    padding: 12px 10px;
    text-align: center;
  }

  .chest b {
    font-size: 12.5px;
  }

  .chest.none b {
    color: var(--camp-ink-muted);
    font-weight: 500;
  }

  .chest:not(.none) {
    box-shadow: inset 0 0 0 1px var(--camp-edge-strong), 0 0 18px -8px var(--camp-gold), var(--camp-shadow);
  }

  .chest-art {
    position: relative;
    display: grid;
    filter: drop-shadow(0 4px 6px rgba(0, 0, 0, 0.35));
  }

  .chest:not(.none) .chest-art {
    animation: bob 3s ease-in-out infinite;
  }

  @keyframes bob {
    50% { transform: translateY(-3px); }
  }

  .count {
    position: absolute;
    right: -6px;
    top: -4px;
    min-width: 20px;
    padding: 0 6px;
    border-radius: 999px;
    background: #c4372b;
    box-shadow: 0 0 0 2px var(--camp-panel);
    color: #fff;
    font-size: 11.5px;
    font-weight: 700;
    line-height: 20px;
    text-align: center;
  }

  .purse {
    display: flex;
    flex-wrap: wrap;
    align-content: center;
    gap: 6px 14px;
    padding: 10px 14px;
  }

  .coin {
    display: inline-flex;
    align-items: center;
    gap: 3px;
  }

  .coin small {
    color: var(--camp-ink-soft);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }

  .reveal {
    display: grid;
    gap: 10px;
    padding: 12px 16px 14px;
    box-shadow: inset 0 0 0 1px var(--camp-gold), 0 0 26px -10px var(--camp-gold), var(--camp-shadow);
  }

  .reveal header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .found-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
  }

  .found {
    display: grid;
    justify-items: center;
    gap: 3px;
    max-width: 96px;
    animation: found-in 360ms cubic-bezier(0.2, 0.9, 0.3, 1.25) both;
    animation-delay: var(--delay, 0ms);
  }

  @keyframes found-in {
    from { opacity: 0; transform: translateY(8px) scale(0.85); }
  }

  .found small {
    color: var(--camp-ink-muted);
    font-size: 11px;
    text-align: center;
  }

  .found.salvaged :global(button) {
    opacity: 0.45;
  }

  /* The elixir shelf. */
  .shelf {
    display: grid;
    gap: 10px;
    padding: 12px 16px 14px;
  }

  .shelf header {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 4px 14px;
  }

  .shelf header small {
    font-size: 11.5px;
  }

  .potions {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
    gap: 8px;
  }

  .potion {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    gap: 10px;
    align-items: center;
    padding: 6px 8px;
    border-radius: 10px;
  }

  .potion.active {
    background: color-mix(in srgb, var(--camp-teal) 8%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--camp-teal) 45%, transparent);
  }

  .flask {
    position: relative;
    display: grid;
    place-items: center;
    width: 48px;
    height: 48px;
  }

  .potion.active .flask {
    box-shadow: inset 0 0 0 1px var(--camp-teal), 0 0 14px -4px var(--camp-teal);
  }

  .potion .label {
    display: grid;
    gap: 1px;
    min-width: 0;
    font-size: 11.5px;
  }

  .potion .label b {
    font-size: 12.5px;
  }

  .potion .label span {
    color: var(--camp-ink-muted);
  }

  .potion .label .left {
    color: var(--camp-teal);
    font-weight: 600;
  }

  .potion.empty .label b {
    color: var(--camp-ink-muted);
    font-weight: 500;
  }

  .body {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 16px;
    align-items: start;
  }

  @media (max-width: 980px) {
    .body { grid-template-columns: 1fr; }
  }

  .bag {
    display: grid;
    gap: 12px;
    padding: 12px 16px 16px;
    min-width: 0;
  }

  .toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }

  /* The bag's slots: items first, then the empty wells it still has. */
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, 54px);
    gap: 6px;
  }

  .well {
    width: 54px;
    height: 54px;
    opacity: 0.55;
  }

  .empty,
  .hint {
    margin: 0;
    font-size: 12.5px;
  }

  .focus {
    display: grid;
    gap: 10px;
    width: 320px;
    padding: 14px;
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--rarity) 60%, var(--camp-edge)), 0 0 22px -10px var(--rarity), var(--camp-shadow);
  }

  @media (max-width: 980px) {
    .focus { width: auto; }
  }

  .equip,
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  @media (prefers-reduced-motion: reduce) {
    .chest:not(.none) .chest-art, .found { animation: none; }
  }
</style>
