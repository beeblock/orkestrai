<script lang="ts">
  import type { AdventureCatalog } from '$lib/i18n/adventure/index.js';
  import { SET_PIECES, type SetId } from '$lib/modules/agent-room/domain/adventure/artifacts.js';
  import type { StatId } from '$lib/modules/agent-room/domain/adventure/stats.js';
  import * as m from '$lib/paraglide/messages.js';
  import type { HeroView } from '../../adventure-party.js';
  import { formatNumber } from '../../adventure-text.js';
  import { statIcon } from '../../skill-icons.js';
  import ItemIcon from '../ItemIcon.svelte';

  /** The hero's numbers in three groups (attack, defense, fortune), then its powers. */
  let { hero, catalog }: { hero: HeroView; catalog: AdventureCatalog } = $props();

  type Row = { stat: StatId; label: string; value: string };

  const groups = $derived.by(() => {
    const profile = hero.build.profile;
    const pct = (value: number) => `${formatNumber(Math.round(value * 10) / 10)}%`;
    const row = (stat: StatId, label: string, value: string): Row => ({ stat, label, value });
    return [
      { title: m['adventure.camp_stats_attack'](), rows: [
        row('attack', m['adventure.stat_damage'](), formatNumber(Math.round(profile.attack))),
        row('attackSpeed', m['adventure.stat_attacks'](), (1000 / profile.attackMs).toFixed(2)),
        row('critChance', catalog.stats.critChance, pct(profile.critChance * 100)),
        row('critDamage', catalog.stats.critDamage, pct((profile.critMultiplier - 1) * 100)),
        row('skillDamage', catalog.stats.skillDamage, pct((profile.skillMultiplier - 1) * 100)),
        row('bossDamage', catalog.stats.bossDamage, pct((profile.bossMultiplier - 1) * 100)),
        row('cooldownReduction', catalog.stats.cooldownReduction, pct((1 - profile.cooldownMultiplier) * 100)),
      ] },
      { title: m['adventure.camp_stats_defense'](), rows: [
        row('maxHp', catalog.stats.maxHp, formatNumber(Math.round(profile.maxHp))),
        row('armor', catalog.stats.armor, formatNumber(Math.round(profile.armor))),
        row('damageReduction', catalog.stats.damageReduction, pct(profile.damageReduction * 100)),
        row('hpRegen', catalog.stats.hpRegen, formatNumber(Math.round(profile.hpRegen * 10) / 10)),
        row('lifeSteal', catalog.stats.lifeSteal, pct(profile.lifeSteal * 100)),
      ] },
      { title: m['adventure.camp_stats_fortune'](), rows: [
        row('goldFind', catalog.stats.goldFind, pct((profile.goldMultiplier - 1) * 100)),
        row('magicFind', catalog.stats.magicFind, pct(profile.magicFind)),
        row('xpBonus', catalog.stats.xpBonus, pct((profile.xpMultiplier - 1) * 100)),
        row('chestChance', catalog.stats.chestChance, pct((profile.chestMultiplier - 1) * 100)),
      ] },
    ];
  });
  const sets = $derived(Object.entries(hero.build.sets ?? {}) as Array<[SetId, number]>);
</script>

<section class="stats camp-panel" aria-label={m['adventure.camp_stats']()}>
  {#each groups as group (group.title)}
    <div class="group">
      <h3 class="camp-heading">{group.title}</h3>
      <dl>
        {#each group.rows as entry (entry.stat)}
          {@const icon = statIcon(entry.stat)}
          <div><dt><ItemIcon atlasId={icon.atlas} frame={icon.frame} size={18} />{entry.label}</dt><dd>{entry.value}</dd></div>
        {/each}
      </dl>
    </div>
  {/each}

  <div class="group">
    <h3 class="camp-heading">{m['adventure.camp_powers']()}</h3>
    {#if sets.length || hero.build.powers.length}
      {#each sets as [setId, count] (setId)}
        <p class="set-line">{m['adventure.item_set']({ set: catalog.sets[setId], count, total: SET_PIECES.length })}</p>
      {/each}
      {#each hero.build.powers as power (power)}<p class="power">{catalog.powers[power]}</p>{/each}
    {:else}
      <p class="camp-muted none">{m['adventure.camp_powers_none']()}</p>
    {/if}
  </div>
</section>

<style>
  .stats {
    display: grid;
    gap: 14px;
    align-content: start;
    padding: 14px 16px;
    min-width: 0;
  }

  .group {
    display: grid;
    gap: 6px;
  }

  dl {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
    gap: 2px 16px;
    margin: 0;
  }

  dl div {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    min-height: 26px;
    border-bottom: 1px dashed color-mix(in srgb, var(--camp-edge) 70%, transparent);
    font-size: 12.5px;
  }

  dt {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    color: var(--camp-ink-soft);
  }

  dd {
    margin: 0;
    color: var(--camp-ink);
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }

  .set-line,
  .power,
  .none {
    margin: 0;
    font-size: 12px;
    line-height: 1.45;
  }

  .set-line {
    color: var(--adventure-ink-set);
    font-weight: 600;
  }

  .power {
    padding: 6px 9px;
    border-radius: 6px;
    background: color-mix(in srgb, #ff9b30 9%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, #ff9b30 35%, transparent);
    color: var(--adventure-ink-unique);
  }
</style>
