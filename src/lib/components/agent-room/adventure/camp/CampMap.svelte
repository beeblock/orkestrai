<script lang="ts">
  import { ArrowDown, ArrowUp, Check, Lock, MapPin, Pin, PinOff } from '@lucide/svelte';
  import { Button } from '$lib/components/ui/button';
  import { Switch } from '$lib/components/ui/switch';
  import { SegmentedControl } from '$lib/components/ui/segmented';
  import type { AdventureCatalog } from '$lib/i18n/adventure/index.js';
  import { BIOMES, type BiomeId, type HeroClassId } from '$lib/modules/agent-room/domain/adventure/catalog.js';
  import { ACT_COUNT, DIFFICULTIES, STAGES_PER_ACT, difficultyUnlocked, regionLevel, stageIndex, stageUnlocked, type Difficulty } from '$lib/modules/agent-room/domain/adventure/world.js';
  import * as m from '$lib/paraglide/messages.js';
  import type { AdventureAction, AdventureOutcome, AdventureSnapshot } from '../adventure-client.js';
  import type { HeroView } from '../adventure-party.js';
  import { heroLevelText } from '../adventure-text.js';
  import { campArt } from '../camp-art.js';
  import ItemIcon from './ItemIcon.svelte';

  let { snapshot, catalog, heroes, act, busy }: {
    snapshot: AdventureSnapshot;
    catalog: AdventureCatalog;
    heroes: HeroView[];
    act: (action: AdventureAction) => Promise<AdventureOutcome | null>;
    busy: boolean;
  } = $props();

  // Starts where the party is; the owner moves it from here.
  // svelte-ignore state_referenced_locally
  let difficulty = $state<Difficulty>(snapshot.account.position.difficulty);

  // The act shown on the road under the map: where the party is, until the owner picks another.
  // svelte-ignore state_referenced_locally
  let shownAct = $state(snapshot.account.position.act);
  const worldMap = campArt('world-map');
  const ACTS = Array.from({ length: ACT_COUNT }, (_, index) => index + 1);

  const account = $derived(snapshot.account);
  const cleared = $derived(account.cleared[difficulty]);
  const formation = $derived(account.formation);

  const biomeName = (id: BiomeId) => (m as unknown as Record<string, () => string>)[`adventure.biome_${id.replace(/-/g, '_')}`]?.() ?? id;
  const className = (id: HeroClassId) => (m as unknown as Record<string, () => string>)[`adventure.class_${id}`]?.() ?? id;

  /** Stages cleared in an act on the chosen difficulty. */
  function clearedIn(act_: number): number {
    return Array.from({ length: STAGES_PER_ACT }, (_, index) => index + 1).filter((stage) => stageIndex({ act: act_, stage }) <= cleared).length;
  }

  function actOpen(act_: number): boolean {
    return stageUnlocked(account.cleared, { difficulty, act: act_, stage: 1 });
  }

  function setting(key: 'autoAdvance' | 'autoRetry', value: boolean) {
    void act({ type: 'settings', settings: { [key]: value } });
  }

  function pin(heroId: string) {
    const next = formation.includes(heroId) ? formation.filter((id) => id !== heroId) : [...formation, heroId];
    void act({ type: 'formation', order: next });
  }

  function move(heroId: string, step: number) {
    const index = formation.indexOf(heroId);
    const target = index + step;
    if (index < 0 || target < 0 || target >= formation.length) return;
    const next = [...formation];
    [next[index], next[target]] = [next[target], next[index]];
    void act({ type: 'formation', order: next });
  }
</script>

<div class="map">
  <section class="road camp-panel ornate">
    <header>
      <SegmentedControl
        label={m['adventure.camp_difficulty']()}
        value={difficulty}
        onValueChange={(value: string) => (difficulty = value as Difficulty)}
        options={DIFFICULTIES.map((entry) => ({ value: entry, label: catalog.difficulties[entry], disabled: !difficultyUnlocked(account.cleared, entry) }))}
      />
      <span class="hint">{difficultyUnlocked(account.cleared, difficulty) ? m['adventure.camp_map_hint']() : m['adventure.camp_difficulty_locked']()}</span>
    </header>

    <!-- The realm: five regions from left to right, one per act. -->
    <div class="world" class:painted={Boolean(worldMap)} style:--map={worldMap ? `url(${worldMap})` : undefined}>
      {#each ACTS as act_ (act_)}
        {@const open = actOpen(act_)}
        {@const partyHere = account.position.difficulty === difficulty && account.position.act === act_}
        <button type="button" class="region" class:shown={shownAct === act_} class:locked={!open} aria-pressed={shownAct === act_} onclick={() => (shownAct = act_)} data-testid="camp-act">
          <span class="banner">
            <b>{m['adventure.camp_act']({ act: act_ })}</b>
            <small>{biomeName(BIOMES[act_ - 1].id)}</small>
            <small class="tally">{clearedIn(act_)}/{STAGES_PER_ACT}</small>
          </span>
          {#if !open}<span class="lock"><Lock size={16} aria-hidden="true" /></span>{/if}
          {#if partyHere}<span class="party" title={m['adventure.camp_party_here']()}><ItemIcon atlasId="icons-camp-tabs" frame={0} size={44} /></span>{/if}
        </button>
      {/each}
    </div>

    <!-- The road through the shown act: nine stages and its boss. -->
    <ol class="trail" aria-label={`${m['adventure.camp_act']({ act: shownAct })} · ${biomeName(BIOMES[shownAct - 1].id)}`}>
      {#each Array.from({ length: STAGES_PER_ACT }, (_, index) => index + 1) as stage (stage)}
        {@const position = { difficulty, act: shownAct, stage }}
        {@const open = stageUnlocked(account.cleared, position)}
        {@const done = stageIndex(position) <= cleared}
        {@const here = account.position.difficulty === difficulty && account.position.act === shownAct && account.position.stage === stage}
        <li>
          <button
            type="button"
            class="stage"
            class:done
            class:here
            class:boss={stage === STAGES_PER_ACT}
            disabled={busy || !open || here}
            title={m['adventure.camp_stage_title']({ stage: `${shownAct}-${stage}`, level: regionLevel(position) })}
            onclick={() => void act({ type: 'travel', difficulty, act: shownAct, stage })}
            data-testid="camp-stage"
          >
            {#if stage === STAGES_PER_ACT}<ItemIcon atlasId="icons-skills-stats" frame={8} size={30} dim={!open} />{:else}<span class="number">{stage}</span>{/if}
            {#if done}<span class="check"><Check size={10} strokeWidth={3} aria-hidden="true" /></span>{/if}
            {#if here}<span class="here-pin"><MapPin size={16} aria-hidden="true" /></span>{/if}
          </button>
          <small>{shownAct}-{stage} · {m['adventure.camp_region_level']({ level: regionLevel(position) })}</small>
        </li>
      {/each}
    </ol>
  </section>

  <aside class="side">
    <section class="camp-panel">
      <h3 class="camp-heading">{m['adventure.camp_settings']()}</h3>
      <label class="toggle"><Switch checked={account.settings.autoAdvance} disabled={busy} onCheckedChange={(value: boolean) => setting('autoAdvance', value)} aria-label={m['adventure.camp_auto_advance']()} /><span><b>{m['adventure.camp_auto_advance']()}</b><small>{m['adventure.camp_auto_advance_hint']()}</small></span></label>
      <label class="toggle"><Switch checked={account.settings.autoRetry} disabled={busy} onCheckedChange={(value: boolean) => setting('autoRetry', value)} aria-label={m['adventure.camp_auto_retry']()} /><span><b>{m['adventure.camp_auto_retry']()}</b><small>{m['adventure.camp_auto_retry_hint']()}</small></span></label>
    </section>

    <section class="camp-panel">
      <h3 class="camp-heading">{m['adventure.camp_formation']({ slots: snapshot.limits.formation })}</h3>
      <p class="hint">{m['adventure.camp_formation_hint']()}</p>
      <ul class="formation">
        {#each heroes as hero (hero.id)}
          {@const pinned = formation.includes(hero.id)}
          <li class:deployed={hero.deployed}>
            <span class="who"><b>{hero.name}</b><small>{className(hero.classId)} · {heroLevelText(hero.level, hero.paragon)} · {hero.agent?.title ?? m['adventure.resting']()} · {hero.deployed ? m['adventure.camp_deployed']() : m['adventure.reserve']()}</small></span>
            {#if pinned}
              <Button size="icon-sm" variant="ghost" disabled={busy} aria-label={m['adventure.camp_move_up']()} onclick={() => move(hero.id, -1)}><ArrowUp size={13} /></Button>
              <Button size="icon-sm" variant="ghost" disabled={busy} aria-label={m['adventure.camp_move_down']()} onclick={() => move(hero.id, 1)}><ArrowDown size={13} /></Button>
            {/if}
            <Button size="icon-sm" variant={pinned ? 'default' : 'ghost'} disabled={busy || (!pinned && formation.length >= snapshot.limits.formation)} aria-label={pinned ? m['adventure.camp_unpin']() : m['adventure.camp_pin']()} aria-pressed={pinned} onclick={() => pin(hero.id)}>
              {#if pinned}<PinOff size={13} />{:else}<Pin size={13} />{/if}
            </Button>
          </li>
        {/each}
      </ul>
    </section>
  </aside>
</div>

<style>
  .map {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 320px;
    gap: 16px;
    align-items: start;
  }

  @media (max-width: 1100px) {
    .map { grid-template-columns: 1fr; }
  }

  .road {
    display: grid;
    gap: 14px;
    padding: 14px 16px 18px;
    min-width: 0;
  }

  .road header {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 14px;
  }

  .hint {
    color: var(--camp-ink-muted);
    font-size: 12px;
  }

  /* The painted realm with a clickable region per act. */
  .world {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    aspect-ratio: 2 / 1;
    border-radius: 10px;
    overflow: hidden;
    background: var(--map, linear-gradient(90deg, #2f5d2a, #b89a4b 25%, #9fb7c9 50%, #7a2f1d 75%, #d9e6f2)) center / cover no-repeat;
    box-shadow: inset 0 0 0 1px var(--camp-edge-strong), 0 10px 26px rgba(0, 0, 0, 0.35);
  }

  .region {
    position: relative;
    display: grid;
    align-content: start;
    justify-items: center;
    padding: 10px 6px;
    border: 0;
    background: transparent;
    color: #fff4d6;
    cursor: pointer;
    transition: background-color 180ms ease, box-shadow 180ms ease;
  }

  .region:hover {
    background: rgba(255, 236, 190, 0.08);
  }

  .region.shown {
    background: rgba(255, 236, 190, 0.12);
    box-shadow: inset 0 0 0 2px rgba(245, 208, 122, 0.85), inset 0 0 30px rgba(245, 208, 122, 0.25);
  }

  .region.locked {
    background: rgba(10, 8, 6, 0.55);
    cursor: default;
  }

  /* Each act's name on a hanging banner. */
  .banner {
    display: grid;
    justify-items: center;
    gap: 1px;
    padding: 5px 10px 7px;
    border-radius: 4px 4px 10px 10px;
    background: linear-gradient(180deg, rgba(40, 24, 10, 0.88), rgba(24, 14, 6, 0.88));
    box-shadow: inset 0 0 0 1px rgba(232, 184, 75, 0.7), 0 4px 10px rgba(0, 0, 0, 0.4);
    text-align: center;
  }

  .banner b {
    color: #f5d07a;
    font-family: var(--camp-title-font);
    font-size: 12.5px;
    letter-spacing: 0.06em;
  }

  .banner small {
    color: #f3e7c9;
    font-size: 11px;
  }

  .banner .tally {
    color: #b8e8df;
    font-variant-numeric: tabular-nums;
  }

  .lock {
    position: absolute;
    inset: 50% auto auto 50%;
    transform: translate(-50%, -50%);
    color: #d9c8a2;
  }

  .party {
    position: absolute;
    bottom: 16%;
    left: 50%;
    filter: drop-shadow(0 0 6px rgba(245, 208, 122, 0.9)) drop-shadow(0 3px 4px rgba(0, 0, 0, 0.7));
    transform: translateX(-50%);
    animation: bounce 1.6s ease-in-out infinite;
  }

  @keyframes bounce {
    50% { transform: translate(-50%, -5px); }
  }

  /* The road: stones on a dashed path, the boss at its end. */
  .trail {
    position: relative;
    display: grid;
    grid-template-columns: repeat(10, minmax(0, 1fr));
    gap: 4px;
    margin: 0;
    padding: 4px 0 0;
    list-style: none;
  }

  .trail::before {
    content: '';
    position: absolute;
    top: 26px;
    left: 5%;
    right: 5%;
    border-top: 2px dashed color-mix(in srgb, var(--camp-edge-strong) 70%, transparent);
  }

  .trail li {
    position: relative;
    display: grid;
    justify-items: center;
    gap: 4px;
  }

  .trail small {
    color: var(--camp-ink-muted);
    font-size: 10.5px;
    font-variant-numeric: tabular-nums;
    text-align: center;
  }

  .stage {
    position: relative;
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    border: 0;
    border-radius: 50%;
    background: radial-gradient(circle at 50% 35%, var(--camp-raised), var(--camp-inset) 78%);
    box-shadow: inset 0 0 0 2px var(--camp-edge), 0 2px 6px rgba(0, 0, 0, 0.3);
    color: var(--camp-ink);
    cursor: pointer;
    transition: transform 140ms ease, box-shadow 140ms ease;
  }

  .stage.boss {
    width: 52px;
    height: 52px;
    margin-top: -4px;
    box-shadow: inset 0 0 0 2px #c4372b, 0 0 14px -4px #c4372b, 0 2px 6px rgba(0, 0, 0, 0.3);
  }

  .stage:not(:disabled):hover {
    transform: translateY(-2px);
    box-shadow: inset 0 0 0 2px var(--camp-gold), 0 0 12px -3px var(--camp-gold);
  }

  .stage:disabled {
    cursor: default;
  }

  .stage:disabled:not(.here):not(.done) {
    opacity: 0.45;
  }

  .stage.done {
    box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--camp-gold) 80%, transparent), 0 2px 6px rgba(0, 0, 0, 0.3);
  }

  .stage.here {
    box-shadow: inset 0 0 0 2px var(--camp-teal), 0 0 0 4px color-mix(in srgb, var(--camp-teal) 25%, transparent), 0 0 18px -4px var(--camp-teal);
  }

  .number {
    font-family: var(--camp-title-font);
    font-size: 14px;
    font-weight: 700;
  }

  .check {
    position: absolute;
    top: -3px;
    right: -3px;
    display: grid;
    place-items: center;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: linear-gradient(180deg, #f2cd72, #d39a32);
    color: #2a1a05;
  }

  .here-pin {
    position: absolute;
    top: -18px;
    color: var(--camp-teal);
    animation: bounce-pin 1.6s ease-in-out infinite;
  }

  @keyframes bounce-pin {
    50% { transform: translateY(-3px); }
  }

  .side {
    display: grid;
    gap: 12px;
  }

  .side section {
    display: grid;
    gap: 8px;
    padding: 12px 14px;
  }

  .toggle {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    cursor: pointer;
  }

  .toggle span {
    display: grid;
    gap: 1px;
    font-size: 12.5px;
  }

  .formation {
    display: grid;
    gap: 4px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .formation li {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 6px;
    border-radius: 8px;
  }

  .formation li.deployed {
    background: var(--app-hover);
  }

  .who {
    display: grid;
    flex: 1;
    min-width: 0;
    font-size: 12.5px;
  }

  .who b,
  .who small {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  @media (prefers-reduced-motion: reduce) {
    .party, .here-pin { animation: none; }
    .stage { transition: none; }
  }
</style>
