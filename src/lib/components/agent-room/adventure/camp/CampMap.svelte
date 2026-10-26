<script lang="ts">
  import { ArrowDown, ArrowUp, Check, Pin, PinOff } from '@lucide/svelte';
  import { Button } from '$lib/components/ui/button';
  import { Switch } from '$lib/components/ui/switch';
  import { SegmentedControl } from '$lib/components/ui/segmented';
  import type { AdventureCatalog } from '$lib/i18n/adventure/index.js';
  import { BIOMES, type BiomeId, type HeroClassId } from '$lib/modules/agent-room/domain/adventure/catalog.js';
  import { runeRule } from '$lib/modules/agent-room/domain/adventure/runes.js';
  import { ACT_COUNT, DIFFICULTIES, STAGES_PER_ACT, difficultyUnlocked, regionLevel, stageIndex, stageUnlocked, type Difficulty } from '$lib/modules/agent-room/domain/adventure/world.js';
  import * as m from '$lib/paraglide/messages.js';
  import type { AdventureAction, AdventureOutcome, AdventureSnapshot } from '../adventure-client.js';
  import type { HeroView } from '../adventure-party.js';
  import { heroLevelText } from '../adventure-text.js';

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

  const account = $derived(snapshot.account);
  const cleared = $derived(account.cleared[difficulty]);
  const formation = $derived(account.formation);
  const canAutoOpen = $derived(runeRule(account.runes, 'auto-white') > 0 || runeRule(account.runes, 'auto-blue') > 0);

  const biomeName = (id: BiomeId) => (m as unknown as Record<string, () => string>)[`adventure.biome_${id.replace(/-/g, '_')}`]?.() ?? id;
  const className = (id: HeroClassId) => (m as unknown as Record<string, () => string>)[`adventure.class_${id}`]?.() ?? id;

  function setting(key: 'autoAdvance' | 'autoRetry' | 'autoOpen', value: boolean) {
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
  <section class="road">
    <header>
      <SegmentedControl
        label={m['adventure.camp_difficulty']()}
        value={difficulty}
        onValueChange={(value: string) => (difficulty = value as Difficulty)}
        options={DIFFICULTIES.map((entry) => ({ value: entry, label: catalog.difficulties[entry], disabled: !difficultyUnlocked(account.cleared, entry) }))}
      />
      <span class="hint">{difficultyUnlocked(account.cleared, difficulty) ? m['adventure.camp_map_hint']() : m['adventure.camp_difficulty_locked']()}</span>
    </header>
    <ol class="acts">
      {#each Array.from({ length: ACT_COUNT }, (_, index) => index + 1) as act_ (act_)}
        <li class="act">
          <span class="act-name">{m['adventure.camp_act']({ act: act_ })} · {biomeName(BIOMES[act_ - 1].id)}</span>
          <div class="stages">
            {#each Array.from({ length: STAGES_PER_ACT }, (_, index) => index + 1) as stage (stage)}
              {@const position = { difficulty, act: act_, stage }}
              {@const open = stageUnlocked(account.cleared, position)}
              {@const done = stageIndex(position) <= cleared}
              {@const here = account.position.difficulty === difficulty && account.position.act === act_ && account.position.stage === stage}
              <button
                type="button"
                class="stage"
                class:done
                class:here
                class:boss={stage === STAGES_PER_ACT}
                disabled={busy || !open || here}
                title={m['adventure.camp_stage_title']({ stage: `${act_}-${stage}`, level: regionLevel(position) })}
                onclick={() => void act({ type: 'travel', difficulty, act: act_, stage })}
                data-testid="camp-stage"
              >
                <span>{act_}-{stage}</span>
                <small>{regionLevel(position)}</small>
                {#if done}<Check size={10} class="check" aria-hidden="true" />{/if}
              </button>
            {/each}
          </div>
        </li>
      {/each}
    </ol>
  </section>

  <aside class="side">
    <section>
      <h3>{m['adventure.camp_settings']()}</h3>
      <label class="toggle"><Switch checked={account.settings.autoAdvance} disabled={busy} onCheckedChange={(value: boolean) => setting('autoAdvance', value)} aria-label={m['adventure.camp_auto_advance']()} /><span><b>{m['adventure.camp_auto_advance']()}</b><small>{m['adventure.camp_auto_advance_hint']()}</small></span></label>
      <label class="toggle"><Switch checked={account.settings.autoRetry} disabled={busy} onCheckedChange={(value: boolean) => setting('autoRetry', value)} aria-label={m['adventure.camp_auto_retry']()} /><span><b>{m['adventure.camp_auto_retry']()}</b><small>{m['adventure.camp_auto_retry_hint']()}</small></span></label>
      <label class="toggle"><Switch checked={account.settings.autoOpen} disabled={busy || !canAutoOpen} onCheckedChange={(value: boolean) => setting('autoOpen', value)} aria-label={m['adventure.camp_auto_open']()} /><span><b>{m['adventure.camp_auto_open']()}</b><small>{canAutoOpen ? m['adventure.camp_auto_open_hint']() : m['adventure.camp_auto_open_locked']()}</small></span></label>
    </section>

    <section>
      <h3>{m['adventure.camp_formation']({ slots: snapshot.limits.formation })}</h3>
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

  @media (max-width: 980px) {
    .map { grid-template-columns: 1fr; }
  }

  .road {
    display: grid;
    gap: 12px;
  }

  .road header {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px;
  }

  .hint,
  small {
    color: var(--app-text-muted);
    font-size: 11.5px;
  }

  .acts {
    display: grid;
    gap: 10px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .act {
    display: grid;
    gap: 6px;
  }

  .act-name {
    color: var(--app-text-soft);
    font-size: 12.5px;
    font-weight: 600;
  }

  .stages {
    display: grid;
    grid-template-columns: repeat(10, minmax(52px, 1fr));
    gap: 5px;
  }

  .stage {
    position: relative;
    display: grid;
    gap: 1px;
    padding: 6px 4px;
    border: 0;
    border-radius: 8px;
    background: var(--app-surface);
    box-shadow: inset 0 0 0 1px var(--app-border);
    color: var(--app-text);
    font-size: 12px;
    font-weight: 600;
    text-align: center;
    cursor: pointer;
  }

  .stage small {
    font-weight: 400;
  }

  .stage:disabled {
    cursor: default;
  }

  .stage:disabled:not(.here) {
    opacity: 0.4;
  }

  .stage:not(:disabled):hover {
    background: var(--app-surface-raised);
    box-shadow: inset 0 0 0 1px var(--app-accent);
  }

  .stage:focus-visible {
    outline: 2px solid var(--app-ring);
    outline-offset: 1px;
  }

  .stage.done {
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--app-success) 45%, transparent);
  }

  .stage.boss {
    color: var(--adventure-ink-boss);
  }

  .stage.here {
    background: color-mix(in srgb, var(--app-accent) 18%, var(--app-surface));
    box-shadow: inset 0 0 0 2px var(--app-accent);
  }

  .stage :global(.check) {
    position: absolute;
    top: 3px;
    right: 3px;
    color: var(--app-success);
  }

  .side {
    display: grid;
    gap: 12px;
  }

  .side section {
    display: grid;
    gap: 8px;
    padding: 12px;
    border-radius: 10px;
    background: var(--app-surface);
    box-shadow: inset 0 0 0 1px var(--app-border);
  }

  h3 {
    margin: 0;
    font-size: 13.5px;
    font-weight: 600;
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
</style>
