<script lang="ts">
  import { RotateCcw, Sparkles, X } from '@lucide/svelte';
  import { Button } from '$lib/components/ui/button';
  import { Switch } from '$lib/components/ui/switch';
  import * as NativeSelect from '$lib/components/ui/native-select';
  import * as Tooltip from '$lib/components/ui/tooltip';
  import type { AdventureCatalog } from '$lib/i18n/adventure/index.js';
  import { TEAMMATE_CLASS_IDS, type HeroClassId } from '$lib/modules/agent-room/domain/adventure/catalog.js';
  import { SETS, SET_PIECES, type SetId } from '$lib/modules/agent-room/domain/adventure/artifacts.js';
  import { RARITY_RULES, SLOTS, SLOT_CAPACITY, canEquip, itemScore, type Item, type Slot } from '$lib/modules/agent-room/domain/adventure/items.js';
  import { SKILL_TREES, canRaise, tierRequirement, type SkillNode } from '$lib/modules/agent-room/domain/adventure/skills.js';
  import * as m from '$lib/paraglide/messages.js';
  import type { AdventureAction, AdventureOutcome, AdventureSnapshot } from '../adventure-client.js';
  import type { HeroView } from '../adventure-party.js';
  import { formatNumber, heroLevelText, skillDescription } from '../adventure-text.js';
  import ItemSlot from './ItemSlot.svelte';
  import SpriteView from './SpriteView.svelte';

  let { snapshot, catalog, heroes, act, busy, selected = $bindable() }: {
    snapshot: AdventureSnapshot;
    catalog: AdventureCatalog;
    heroes: HeroView[];
    act: (action: AdventureAction) => Promise<AdventureOutcome | null>;
    busy: boolean;
    selected: string | null;
  } = $props();

  /** The armory cell being filled: its slot and, for rings and trinkets, which of the two. */
  let picking = $state<{ slot: Slot; index: number } | null>(null);

  const KIND_LABEL: Record<SkillNode['kind'], () => string> = {
    passive: m['adventure.skill_kind_passive'],
    aura: m['adventure.skill_kind_aura'],
    active: m['adventure.skill_kind_active'],
  };

  const hero = $derived(heroes.find((entry) => entry.id === selected) ?? heroes[0]);
  const equipped = $derived(snapshot.items.filter((item) => item.location === 'equipped' && item.heroId === hero?.id));
  const candidates = $derived(picking && hero
    ? snapshot.items
      .filter((item) => item.slot === picking!.slot && item.location !== 'equipped' && canEquip(item, { classId: hero.classId, level: hero.level }) === 'ok')
      .sort((a, b) => itemScore(b) - itemScore(a))
    : []);
  /** Every cell of the armory: one per slot, two for rings and trinkets. */
  const cells = $derived(SLOTS.flatMap((slot) => Array.from({ length: SLOT_CAPACITY[slot] }, (_, index) => ({ slot, index }))));
  const wornSets = $derived((hero?.build.sets ?? {}) as Partial<Record<SetId, number>>);
  const tree = $derived(hero ? SKILL_TREES[hero.classId] : []);
  const free = $derived(hero ? hero.build.skillPoints - hero.build.pointsSpent : 0);
  const outfitAtlas = $derived(hero ? (hero.build.visualTier === 2 ? `hero-${hero.classId}` : `hero-${hero.classId}-t${hero.build.visualTier}`) : '');

  function className(id: HeroClassId): string {
    return (m as unknown as Record<string, () => string>)[`adventure.class_${id}`]?.() ?? id;
  }

  /** What a cell holds: the slot's items in a steady order, one per cell. */
  function wornIn(slot: Slot, index = 0): Item | null {
    return equipped.filter((item) => item.slot === slot).sort((a, b) => a.id.localeCompare(b.id))[index] ?? null;
  }

  function cellLabel(slot: Slot, index: number): string {
    return SLOT_CAPACITY[slot] > 1 ? m['adventure.camp_slot_pair']({ slot: catalog.slots[slot], index: index + 1 }) : catalog.slots[slot];
  }

  function samePick(slot: Slot, index: number): boolean {
    return picking?.slot === slot && picking.index === index;
  }

  function pointsBelow(tier: number): number {
    return tree.filter((node) => node.tier < tier).reduce((sum, node) => sum + (hero?.skills[node.id] ?? 0), 0);
  }

  function raise(node: SkillNode) {
    if (!hero || canRaise(hero.classId, hero.level, hero.skills, node.id) !== 'ok') return;
    void act({ type: 'raise-skill', heroId: hero.id, skillId: node.id });
  }

  const stats = $derived.by(() => {
    if (!hero) return [] as Array<[string, string]>;
    const profile = hero.build.profile;
    const pct = (value: number) => `${formatNumber(Math.round(value * 10) / 10)}%`;
    return [
      [m['adventure.stat_damage'](), formatNumber(Math.round(profile.attack))],
      [m['adventure.stat_attacks'](), (1000 / profile.attackMs).toFixed(2)],
      [catalog.stats.critChance, pct(profile.critChance * 100)],
      [catalog.stats.critDamage, pct((profile.critMultiplier - 1) * 100)],
      [catalog.stats.maxHp, formatNumber(Math.round(profile.maxHp))],
      [catalog.stats.armor, formatNumber(Math.round(profile.armor))],
      [catalog.stats.damageReduction, pct(profile.damageReduction * 100)],
      [catalog.stats.hpRegen, formatNumber(Math.round(profile.hpRegen * 10) / 10)],
      [catalog.stats.lifeSteal, pct(profile.lifeSteal * 100)],
      [catalog.stats.cooldownReduction, pct((1 - profile.cooldownMultiplier) * 100)],
      [catalog.stats.skillDamage, pct((profile.skillMultiplier - 1) * 100)],
      [catalog.stats.bossDamage, pct((profile.bossMultiplier - 1) * 100)],
      [catalog.stats.goldFind, pct((profile.goldMultiplier - 1) * 100)],
      [catalog.stats.magicFind, pct(profile.magicFind)],
      [catalog.stats.xpBonus, pct((profile.xpMultiplier - 1) * 100)],
      [catalog.stats.chestChance, pct((profile.chestMultiplier - 1) * 100)],
    ] as Array<[string, string]>;
  });
</script>

<div class="heroes">
  <nav class="list" aria-label={m['adventure.camp_tab_heroes']()}>
    <p class="guild">{m['adventure.camp_guild']({ count: heroes.length })}</p>
    {#each heroes as entry (entry.id)}
      <button type="button" class="row" class:active={entry.id === hero?.id} onclick={() => { selected = entry.id; picking = null; }} data-testid="camp-hero">
        <span class="mini"><SpriteView atlasId={entry.build.visualTier === 2 ? `hero-${entry.classId}` : `hero-${entry.classId}-t${entry.build.visualTier}`} fallbackId={`hero-${entry.classId}`} animation="idle" width={36} height={40} /></span>
        <span class="who">
          <b>{entry.name}</b>
          <span>{className(entry.classId)} · {heroLevelText(entry.level, entry.paragon)}</span>
          <span class="agent" class:resting={!entry.agent}>{entry.agent?.title ?? m['adventure.resting']()}</span>
        </span>
        <span class="side">
          <span class="power">{formatNumber(entry.build.rating)}</span>
          <span class={`dot ${entry.deployed ? (entry.activity === 'working' ? 'fighting' : 'deployed') : 'reserve'}`} title={entry.deployed ? m['adventure.camp_deployed']() : m['adventure.reserve']()}></span>
        </span>
      </button>
    {/each}
  </nav>

  {#if hero}
    <section class="detail" aria-label={hero.name}>
      <div class="top">
        <div class="portrait">
          <SpriteView atlasId={outfitAtlas} fallbackId={`hero-${hero.classId}`} animation={hero.activity === 'working' ? 'walk' : 'idle'} width={150} height={160} glow={hero.build.weaponRarity ? RARITY_RULES[hero.build.weaponRarity].color : null} />
          <span class="outfit">{catalog.outfits[String(hero.build.visualTier) as '1']}</span>
        </div>
        <div class="identity">
          <h2>{hero.name}</h2>
          <p class="sub">{hero.agent ? m['adventure.played_by']({ agent: hero.agent.role ? `${hero.agent.title} · ${hero.agent.role}` : hero.agent.title }) : m['adventure.resting_in_guild']()}</p>
          <div class="level">
            <b>{hero.paragon > 0 ? `${m['adventure.level']({ level: hero.level })} · ${heroLevelText(hero.level, hero.paragon)}` : m['adventure.level']({ level: hero.level })}</b>
            <span class="xp" title={m['adventure.xp']({ into: formatNumber(hero.xp), next: formatNumber(hero.build.xpToNext) })}>
              <span style:width={`${Math.min(100, (hero.xp / Math.max(1, hero.build.xpToNext)) * 100)}%`}></span>
            </span>
          </div>
          <p class="sub">{m['adventure.power']({ rating: formatNumber(hero.build.rating) })} · {hero.deployed ? m['adventure.camp_deployed']() : m['adventure.reserve']()}{#if hero.activity === 'working'}<span class="inspired">{` · ${m['adventure.inspired']()}`}</span>{/if}</p>
          {#if hero.leader}
            <p class="sub">{className('maestro')} · {m['adventure.leader']()}</p>
          {:else}
            <label class="pick">
              <span>{m['adventure.class_pick']()}</span>
              <NativeSelect.Root size="sm" class="w-[170px]" value={hero.chosenClass ?? ''} disabled={busy} onchange={(event: Event) => void act({ type: 'set-class', heroId: hero.id, classId: ((event.currentTarget as HTMLSelectElement).value || null) as HeroClassId | null })} aria-label={m['adventure.class_pick']()}>
                <NativeSelect.Option value="">{m['adventure.class_auto']()}</NativeSelect.Option>
                {#each TEAMMATE_CLASS_IDS as classId (classId)}<NativeSelect.Option value={classId}>{className(classId)}</NativeSelect.Option>{/each}
              </NativeSelect.Root>
            </label>
          {/if}
          <Button size="sm" variant="outline" class="w-fit" disabled={busy} onclick={() => void act({ type: 'auto-equip', heroId: hero.id })}>
            <Sparkles size={14} aria-hidden="true" />{m['adventure.camp_equip_best']()}
          </Button>
        </div>
        <div class="doll" role="group" aria-label={m['adventure.camp_equipment']()}>
          {#each cells as cell (`${cell.slot}-${cell.index}`)}
            <div class={`cell slot-${cell.slot}`} class:open={samePick(cell.slot, cell.index)}>
              <ItemSlot item={wornIn(cell.slot, cell.index)} {catalog} heroLevel={hero.level} {wornSets} placeholder={cellLabel(cell.slot, cell.index)} selected={samePick(cell.slot, cell.index)} onclick={() => { picking = samePick(cell.slot, cell.index) ? null : cell; }} />
              <span>{cellLabel(cell.slot, cell.index)}</span>
            </div>
          {/each}
        </div>
        <div class="numbers">
          <dl class="stats">
            {#each stats as [label, value] (label)}<div><dt>{label}</dt><dd>{value}</dd></div>{/each}
          </dl>
          <section class="powers" aria-label={m['adventure.camp_powers']()}>
            <h3>{m['adventure.camp_powers']()}</h3>
            {#each Object.entries(wornSets) as [setId, count] (setId)}
              <p class="set-line">{m['adventure.item_set']({ set: catalog.sets[setId as SetId], count: count ?? 0, total: SET_PIECES.length })}</p>
            {/each}
            {#if hero.build.powers.length}
              <ul>{#each hero.build.powers as power (power)}<li>{catalog.powers[power]}</li>{/each}</ul>
            {:else}
              <p class="none">{m['adventure.camp_powers_none']()}</p>
            {/if}
          </section>
        </div>
      </div>

      {#if picking}
        {@const current = wornIn(picking.slot, picking.index)}
        <div class="picker" aria-label={m['adventure.camp_pick_for']({ slot: cellLabel(picking.slot, picking.index) })}>
          <header>
            <b>{m['adventure.camp_pick_for']({ slot: cellLabel(picking.slot, picking.index) })}</b>
            {#if current}<Button size="sm" variant="ghost" disabled={busy} onclick={() => void act({ type: 'unequip', itemId: current.id })}>{m['adventure.camp_unequip']()}</Button>{/if}
            <Button size="icon-sm" variant="ghost" aria-label={m['adventure.camp_close']()} onclick={() => (picking = null)}><X size={14} /></Button>
          </header>
          {#if candidates.length}
            <div class="grid">
              {#each candidates as item (item.id)}
                <ItemSlot {item} {catalog} heroLevel={hero.level} {wornSets} compare={current} locked={item.locked} onclick={() => void act({ type: 'equip', itemId: item.id, heroId: hero.id, replaceId: current?.id }).then(() => (picking = null))} />
              {/each}
            </div>
          {:else}
            <p class="none">{m['adventure.camp_no_candidates']()}</p>
          {/if}
        </div>
      {/if}

      <div class="skills">
        <header>
          <h3>{m['adventure.camp_skills']()}</h3>
          <span class="points" class:has={free > 0}>{m['adventure.camp_points']({ count: free })}</span>
          <label class="auto"><Switch checked={hero.autoSkills} disabled={busy} onCheckedChange={(checked: boolean) => void act({ type: 'auto-skills', heroId: hero.id, enabled: checked })} aria-label={m['adventure.camp_auto_skills']()} />{m['adventure.camp_auto_skills']()}</label>
          <Button size="sm" variant="ghost" disabled={busy || hero.build.pointsSpent === 0} onclick={() => void act({ type: 'reset-skills', heroId: hero.id })}><RotateCcw size={13} aria-hidden="true" />{m['adventure.camp_respec']()}</Button>
        </header>
        <div class="actives">
          <span>{m['adventure.camp_active_slots']()}</span>
          {#each Array.from({ length: snapshot.limits.activeSlots }, (_, index) => index) as index (index)}
            <NativeSelect.Root size="sm" class="w-[190px]" disabled={busy || !hero.build.learned.length} value={hero.build.actives[index]?.id ?? ''} onchange={(event: Event) => {
              const value = (event.currentTarget as HTMLSelectElement).value;
              const next = hero.build.actives.map((active) => active.id);
              next[index] = value;
              void act({ type: 'set-actives', heroId: hero.id, actives: next.filter(Boolean) });
            }} aria-label={m['adventure.camp_active_slot']({ index: index + 1 })}>
              {#each hero.build.learned as active (active.id)}<NativeSelect.Option value={active.id}>{catalog.skills[active.id]}</NativeSelect.Option>{/each}
            </NativeSelect.Root>
          {/each}
        </div>
        <ol class="tree">
          {#each Array.from({ length: 8 }, (_, index) => index + 1) as tier (tier)}
            {@const open = pointsBelow(tier) >= tierRequirement(tier)}
            <li class="tier" class:locked={!open}>
              <span class="tier-label">{m['adventure.camp_tier']({ tier })}{#if !open}<small>{m['adventure.camp_tier_needs']({ points: tierRequirement(tier) })}</small>{/if}</span>
              <div class="nodes">
                {#each tree.filter((node) => node.tier === tier) as node (node.id)}
                  {@const rank = hero.skills[node.id] ?? 0}
                  {@const verdict = canRaise(hero.classId, hero.level, hero.skills, node.id)}
                  <Tooltip.Root>
                    <Tooltip.Trigger>
                      {#snippet child({ props })}
                        <button {...props} type="button" class={`node ${node.kind}`} class:learned={rank > 0} class:ready={verdict === 'ok'} disabled={busy || verdict !== 'ok'} onclick={() => raise(node)} data-testid="camp-skill">
                          <span class="name">{catalog.skills[node.id]}</span>
                          <span class="rank">{rank}/{node.maxRank}</span>
                          <span class="kind">{KIND_LABEL[node.kind]()}</span>
                        </button>
                      {/snippet}
                    </Tooltip.Trigger>
                    <Tooltip.Content side="top" class="max-w-[280px]">
                      <b>{catalog.skills[node.id]}</b>
                      {#if rank > 0}<p>{m['adventure.camp_now']({ text: skillDescription(catalog, node, rank) })}</p>{/if}
                      {#if rank < node.maxRank}<p>{m['adventure.camp_next']({ text: skillDescription(catalog, node, rank + 1) })}</p>{/if}
                      {#if node.active}<p>{m['adventure.camp_cooldown']({ seconds: Math.round(node.active.cooldownMs / 1000) })}</p>{/if}
                    </Tooltip.Content>
                  </Tooltip.Root>
                {/each}
              </div>
            </li>
          {/each}
        </ol>
      </div>
    </section>
  {/if}
</div>

<style>
  .heroes {
    display: grid;
    grid-template-columns: 230px minmax(0, 1fr);
    gap: 16px;
    min-height: 0;
  }

  @media (max-width: 880px) {
    .heroes { grid-template-columns: 1fr; }
  }

  .list {
    display: grid;
    align-content: start;
    gap: 2px;
  }

  .row {
    display: grid;
    grid-template-columns: 36px minmax(0, 1fr) auto;
    align-items: center;
    gap: 8px;
    padding: 4px 8px 4px 4px;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: var(--app-text);
    text-align: left;
    cursor: pointer;
  }

  .row:hover { background: var(--app-hover); }
  .row.active { background: var(--app-active); box-shadow: inset 2px 0 0 var(--app-accent); }
  .row:focus-visible { outline: 2px solid var(--app-ring); outline-offset: 1px; }

  .who {
    display: grid;
    min-width: 0;
  }

  .who b, .who span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .who b { font-size: 13px; }
  .who span { color: var(--app-text-muted); font-size: 11.5px; }

  .side {
    display: grid;
    justify-items: end;
    gap: 3px;
  }

  .power {
    color: var(--app-accent);
    font-size: 12px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }

  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--app-text-muted);
  }

  .dot.fighting { background: var(--app-accent); }
  .dot.deployed { background: var(--app-secondary); }

  .detail {
    display: grid;
    gap: 14px;
    min-width: 0;
    container-type: inline-size;
  }

  /* Portrait, identity, armory and numbers side by side; narrower, the armory keeps its own width. */
  .top {
    display: grid;
    grid-template-columns: 150px minmax(170px, 230px) auto minmax(200px, 1fr);
    grid-template-areas: 'portrait identity doll numbers';
    gap: 16px;
    align-items: start;
  }

  .portrait { grid-area: portrait; }
  .identity { grid-area: identity; }
  .doll { grid-area: doll; }
  .numbers { grid-area: numbers; min-width: 0; }

  @container (max-width: 900px) {
    .top {
      grid-template-columns: auto minmax(0, 1fr);
      grid-template-areas: 'portrait identity' 'doll numbers';
    }
  }

  @container (max-width: 560px) {
    .top {
      grid-template-columns: minmax(0, 1fr);
      grid-template-areas: 'portrait' 'identity' 'doll' 'numbers';
    }
  }

  .portrait {
    display: grid;
    justify-items: center;
    gap: 4px;
    padding-top: 4px;
    border-radius: 12px;
    background: radial-gradient(circle at 50% 70%, var(--app-surface-raised), transparent 70%);
  }

  .outfit {
    color: var(--app-text-muted);
    font-size: 11.5px;
  }

  .identity {
    display: grid;
    gap: 6px;
    align-content: start;
  }

  h2 {
    margin: 0;
    font-size: 17px;
    font-weight: 600;
  }

  .sub {
    margin: 0;
    color: var(--app-text-muted);
    font-size: 12px;
  }

  .inspired {
    color: var(--app-accent);
  }

  .guild {
    margin: 0 0 4px;
    padding: 0 8px;
    color: var(--app-text-muted);
    font-size: 11.5px;
    font-weight: 600;
  }

  .agent {
    color: var(--app-text-muted);
    font-size: 11.5px;
  }

  .agent.resting {
    font-style: italic;
  }

  .level {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .xp {
    position: relative;
    flex: 1;
    height: 5px;
    border-radius: 3px;
    background: var(--app-hover);
    overflow: hidden;
  }

  .xp > span {
    position: absolute;
    inset: 0 auto 0 0;
    background: linear-gradient(90deg, #b98a2e, var(--app-accent));
  }

  .pick {
    display: grid;
    gap: 3px;
    color: var(--app-text-muted);
    font-size: 11.5px;
  }

  /* The armory, read like a body: main and off hand, then head to feet, then jewelry. */
  .doll {
    display: grid;
    grid-template-columns: repeat(4, 56px);
    gap: 8px 6px;
    align-content: start;
  }

  .numbers {
    display: grid;
    gap: 12px;
    align-content: start;
  }

  .powers {
    display: grid;
    gap: 4px;
    padding: 8px 10px;
    border-radius: 8px;
    background: var(--app-surface-subtle);
    font-size: 12px;
  }

  .powers h3 {
    margin: 0;
    font-size: 12px;
    font-weight: 600;
  }

  .powers ul {
    display: grid;
    gap: 3px;
    margin: 0;
    padding-left: 16px;
    color: var(--adventure-ink-unique);
  }

  .powers .set-line {
    margin: 0;
    color: var(--adventure-ink-set);
  }

  .powers .none {
    margin: 0;
    color: var(--app-text-muted);
  }

  .cell {
    display: grid;
    justify-items: center;
    gap: 3px;
  }

  .cell > span {
    color: var(--app-text-muted);
    font-size: 11px;
  }

  .stats {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 3px 14px;
    margin: 0;
    font-size: 12px;
  }

  .stats div {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    padding: 2px 0;
    border-bottom: 1px solid var(--app-border);
  }

  .stats dt { color: var(--app-text-muted); }
  .stats dd { margin: 0; font-variant-numeric: tabular-nums; }

  .picker {
    display: grid;
    gap: 8px;
    padding: 10px 12px;
    border-radius: 10px;
    background: var(--app-surface);
    box-shadow: inset 0 0 0 1px var(--app-border);
  }

  .picker header,
  .skills header {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .picker header b { flex: 1; font-size: 13px; }

  .grid {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .none {
    margin: 0;
    color: var(--app-text-muted);
    font-size: 12px;
  }

  .skills {
    display: grid;
    gap: 10px;
  }

  h3 {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
  }

  .points {
    color: var(--app-text-muted);
    font-size: 12px;
  }

  .points.has { color: var(--app-accent); font-weight: 600; }

  .auto {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin-left: auto;
    color: var(--app-text-soft);
    font-size: 12px;
  }

  .actives {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    color: var(--app-text-muted);
    font-size: 12px;
  }

  .tree {
    display: grid;
    gap: 6px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .tier {
    display: grid;
    grid-template-columns: 92px minmax(0, 1fr);
    gap: 10px;
    align-items: center;
  }

  .tier.locked .nodes { opacity: 0.45; }

  .tier-label {
    display: grid;
    color: var(--app-text-soft);
    font-size: 12px;
    font-weight: 600;
  }

  .tier-label small {
    color: var(--app-text-muted);
    font-weight: 400;
    font-size: 11px;
  }

  .nodes {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 6px;
  }

  .node {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 0 6px;
    padding: 6px 9px;
    border: 0;
    border-radius: 8px;
    background: var(--app-surface);
    box-shadow: inset 0 0 0 1px var(--app-border);
    color: var(--app-text);
    text-align: left;
    cursor: pointer;
  }

  .node:disabled { cursor: default; }
  .node.learned { box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--app-accent) 55%, transparent); }
  .node.ready:hover { background: var(--app-surface-raised); box-shadow: inset 0 0 0 1px var(--app-accent); }
  .node:focus-visible { outline: 2px solid var(--app-ring); outline-offset: 1px; }

  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12.5px;
    font-weight: 500;
  }

  .rank {
    color: var(--app-text-soft);
    font-size: 11.5px;
    font-variant-numeric: tabular-nums;
  }

  .kind {
    grid-column: 1 / -1;
    color: var(--app-text-muted);
    font-size: 11px;
  }

  .node.active .kind { color: var(--adventure-ink-active); }
  .node.aura .kind { color: var(--adventure-ink-aura); }
</style>
