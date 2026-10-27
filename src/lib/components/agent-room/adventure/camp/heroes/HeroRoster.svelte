<script lang="ts">
  import type { HeroClassId } from '$lib/modules/agent-room/domain/adventure/catalog.js';
  import * as m from '$lib/paraglide/messages.js';
  import type { HeroView } from '../../adventure-party.js';
  import { formatNumber, heroLevelText } from '../../adventure-text.js';
  import { statIcon } from '../../skill-icons.js';
  import ItemIcon from '../ItemIcon.svelte';
  import SpriteView from '../SpriteView.svelte';

  /** The guild as a column of character cards; the open hero's card is gilded. */
  let { heroes, selected, onSelect }: { heroes: HeroView[]; selected: string | null; onSelect: (heroId: string) => void } = $props();

  const POWER_ICON = statIcon('attack');

  function className(id: HeroClassId): string {
    return (m as unknown as Record<string, () => string>)[`adventure.class_${id}`]?.() ?? id;
  }

  function status(hero: HeroView): { tone: string; label: string } {
    if (!hero.deployed) return { tone: 'reserve', label: m['adventure.reserve']() };
    if (hero.activity === 'working') return { tone: 'fighting', label: m['adventure.camp_fighting']() };
    return { tone: 'deployed', label: m['adventure.camp_deployed']() };
  }
</script>

<nav class="roster" aria-label={m['adventure.camp_tab_heroes']()}>
  <h3 class="camp-heading">{m['adventure.camp_guild']({ count: heroes.length })}</h3>
  {#each heroes as hero (hero.id)}
    {@const state = status(hero)}
    <button type="button" class="card" class:active={hero.id === selected} aria-current={hero.id === selected ? 'true' : undefined} onclick={() => onSelect(hero.id)} data-testid="camp-hero">
      <span class="portrait camp-well">
        <SpriteView atlasId={hero.build.visualTier === 2 ? `hero-${hero.classId}` : `hero-${hero.classId}-t${hero.build.visualTier}`} fallbackId={`hero-${hero.classId}`} animation="idle" width={44} height={50} />
      </span>
      <span class="who">
        <b>{hero.name}</b>
        <span class="class">{className(hero.classId)} · {heroLevelText(hero.level, hero.paragon)}</span>
        <span class="agent" class:resting={!hero.agent}>{hero.agent?.title ?? m['adventure.resting']()}</span>
      </span>
      <span class="side">
        <span class="power" title={m['adventure.power']({ rating: formatNumber(hero.build.rating) })}><ItemIcon atlasId={POWER_ICON.atlas} frame={POWER_ICON.frame} size={16} />{formatNumber(hero.build.rating)}</span>
        <span class={`state ${state.tone}`}><i aria-hidden="true"></i>{state.label}</span>
      </span>
    </button>
  {/each}
</nav>

<style>
  .roster {
    display: grid;
    align-content: start;
    gap: 6px;
  }

  .roster .camp-heading {
    margin-bottom: 2px;
  }

  .card {
    display: grid;
    grid-template-columns: 52px minmax(0, 1fr) auto;
    gap: 10px;
    align-items: center;
    padding: 6px 10px 6px 6px;
    border: 0;
    border-radius: 10px;
    background: linear-gradient(180deg, var(--camp-raised), var(--camp-panel));
    box-shadow: inset 0 0 0 1px var(--camp-edge);
    color: var(--camp-ink);
    text-align: left;
    cursor: pointer;
    transition: box-shadow 150ms ease, transform 150ms ease;
  }

  .card:hover {
    box-shadow: inset 0 0 0 1px var(--camp-edge-strong);
  }

  .card.active {
    box-shadow: inset 0 0 0 1px var(--camp-gold), inset 3px 0 0 var(--camp-gold), 0 0 16px -6px var(--camp-gold);
  }

  .portrait {
    display: grid;
    place-items: end center;
    width: 52px;
    height: 56px;
    overflow: hidden;
  }

  .who {
    display: grid;
    gap: 1px;
    min-width: 0;
  }

  .who b {
    overflow: hidden;
    font-family: var(--camp-title-font);
    font-size: 13.5px;
    letter-spacing: 0.02em;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .card.active .who b {
    color: var(--camp-gold-strong);
  }

  .class,
  .agent {
    overflow: hidden;
    color: var(--camp-ink-muted);
    font-size: 11.5px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .agent.resting {
    font-style: italic;
  }

  .side {
    display: grid;
    justify-items: end;
    gap: 4px;
  }

  .power {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    color: var(--camp-gold);
    font-size: 12.5px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }

  .state {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    color: var(--camp-ink-muted);
    font-size: 11px;
    white-space: nowrap;
  }

  .state i {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--camp-ink-muted);
  }

  .state.fighting i { background: var(--camp-gold); box-shadow: 0 0 6px var(--camp-gold); }
  .state.deployed i { background: var(--camp-teal); }

  @media (prefers-reduced-motion: reduce) {
    .card { transition: none; }
  }
</style>
