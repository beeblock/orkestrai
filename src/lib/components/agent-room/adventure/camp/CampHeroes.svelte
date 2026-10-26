<script lang="ts">
  import { Scale, Sparkles } from '@lucide/svelte';
  import { toast } from '@beeblock/svelar/ui';
  import * as AlertDialog from '$lib/components/ui/alert-dialog';
  import { Button } from '$lib/components/ui/button';
  import { Switch } from '$lib/components/ui/switch';
  import * as NativeSelect from '$lib/components/ui/native-select';
  import type { AdventureCatalog } from '$lib/i18n/adventure/index.js';
  import { TEAMMATE_CLASS_IDS, type HeroClassId } from '$lib/modules/agent-room/domain/adventure/catalog.js';
  import { planBalance } from '$lib/modules/agent-room/domain/adventure/engine.js';
  import * as m from '$lib/paraglide/messages.js';
  import type { AdventureAction, AdventureOutcome, AdventureSnapshot } from '../adventure-client.js';
  import type { HeroView } from '../adventure-party.js';
  import { formatNumber, heroLevelText } from '../adventure-text.js';
  import HeroArmory from './heroes/HeroArmory.svelte';
  import HeroRoster from './heroes/HeroRoster.svelte';
  import HeroStats from './heroes/HeroStats.svelte';
  import SkillTree from './heroes/SkillTree.svelte';

  let { snapshot, catalog, heroes, act, busy, selected = $bindable() }: {
    snapshot: AdventureSnapshot;
    catalog: AdventureCatalog;
    heroes: HeroView[];
    act: (action: AdventureAction) => Promise<AdventureOutcome | null>;
    busy: boolean;
    selected: string | null;
  } = $props();

  let balancing = $state(false);

  const hero = $derived(heroes.find((entry) => entry.id === selected) ?? heroes[0]);
  const plan = $derived(planBalance(snapshot.heroes));
  const names = $derived(Object.fromEntries(snapshot.heroes.map((entry) => [entry.id, entry.name])));
  const xpShare = $derived(hero ? Math.min(100, (hero.xp / Math.max(1, hero.build.xpToNext)) * 100) : 0);

  function className(id: HeroClassId): string {
    return (m as unknown as Record<string, () => string>)[`adventure.class_${id}`]?.() ?? id;
  }

  async function balance() {
    balancing = false;
    const outcome = await act({ type: 'balance-guild' });
    const changes = (outcome?.result as { changes?: unknown[] } | undefined)?.changes;
    if (changes?.length) toast.success(m['adventure.camp_balance_done']({ count: changes.length }));
  }
</script>

<div class="heroes">
  <aside class="side">
    <HeroRoster {heroes} selected={hero?.id ?? null} onSelect={(heroId) => (selected = heroId)} />
    <Button size="sm" variant="outline" class="w-full" disabled={busy} onclick={() => (balancing = true)} data-testid="camp-balance">
      <Scale size={14} aria-hidden="true" />{m['adventure.camp_balance']()}
    </Button>
  </aside>

  {#if hero}
    <section class="detail" aria-label={hero.name}>
      <header class="nameplate camp-panel ornate">
        <div class="identity">
          <h2 class="camp-title">{hero.name}</h2>
          <p class="sub">{hero.leader ? `${className('maestro')} · ${m['adventure.leader']()}` : className(hero.classId)} · {heroLevelText(hero.level, hero.paragon)}</p>
          <p class="sub camp-muted">{hero.agent ? m['adventure.played_by']({ agent: hero.agent.role ? `${hero.agent.title} · ${hero.agent.role}` : hero.agent.title }) : m['adventure.resting_in_guild']()}</p>
        </div>
        <div class="progress">
          <div class="level">
            <span class="badge" aria-label={m['adventure.level']({ level: hero.level })}>{hero.level}</span>
            <div class="xp">
              <span class="camp-bar" role="progressbar" aria-label={m['adventure.xp']({ into: formatNumber(hero.xp), next: formatNumber(hero.build.xpToNext) })} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(xpShare)}><span style:width={`${xpShare}%`}></span></span>
              <small class="camp-muted">{m['adventure.camp_xp_short']({ into: formatNumber(hero.xp), next: formatNumber(hero.build.xpToNext) })}</small>
            </div>
          </div>
          <p class="status">
            <b class="power">{m['adventure.power']({ rating: formatNumber(hero.build.rating) })}</b>
            <span class="camp-muted">· {hero.deployed ? m['adventure.camp_deployed']() : m['adventure.reserve']()}</span>
            {#if hero.activity === 'working'}<span class="inspired">· {m['adventure.inspired']()}</span>{/if}
          </p>
        </div>
        <div class="controls">
          {#if !hero.leader}
            <label class="pick">
              <span class="camp-muted">{m['adventure.class_pick']()}</span>
              <NativeSelect.Root size="sm" class="w-[180px]" value={hero.chosenClass ?? ''} disabled={busy} onchange={(event: Event) => void act({ type: 'set-class', heroId: hero.id, classId: ((event.currentTarget as HTMLSelectElement).value || null) as HeroClassId | null })} aria-label={m['adventure.class_pick']()}>
                <NativeSelect.Option value="">{m['adventure.class_auto']()}</NativeSelect.Option>
                {#each TEAMMATE_CLASS_IDS as classId (classId)}<NativeSelect.Option value={classId}>{className(classId)}</NativeSelect.Option>{/each}
              </NativeSelect.Root>
            </label>
          {/if}
          <Button size="sm" class="camp-gold-button w-fit" disabled={busy} onclick={() => void act({ type: 'auto-equip', heroId: hero.id })}>
            <Sparkles size={14} aria-hidden="true" />{m['adventure.camp_equip_best']()}
          </Button>
          <label class="auto-gear" title={m['adventure.camp_auto_gear_hint']()}>
            <Switch checked={hero.autoGear ?? true} disabled={busy} onCheckedChange={(checked: boolean) => void act({ type: 'auto-gear', heroId: hero.id, enabled: checked })} aria-label={m['adventure.camp_auto_gear']()} data-testid="camp-auto-gear" />
            <span>{m['adventure.camp_auto_gear']()}</span>
          </label>
        </div>
      </header>

      <div class="sheet">
        <div class="armory-column"><HeroArmory {hero} {snapshot} {catalog} {act} {busy} /></div>
        <HeroStats {hero} {catalog} />
      </div>

      <SkillTree {hero} {catalog} {act} {busy} activeSlots={snapshot.limits.activeSlots} />
    </section>
  {/if}
</div>

<AlertDialog.Root open={balancing} onOpenChange={(open) => (balancing = open)}>
  <AlertDialog.Content class="camp-popover">
    <AlertDialog.Header>
      <AlertDialog.Title>{m['adventure.camp_balance_title']()}</AlertDialog.Title>
      <AlertDialog.Description>{plan.length ? m['adventure.camp_balance_body']() : m['adventure.camp_balance_none']()}</AlertDialog.Description>
    </AlertDialog.Header>
    {#if plan.length}
      <ul class="plan">
        {#each plan as change (change.heroId)}<li>{m['adventure.camp_balance_change']({ hero: names[change.heroId] ?? '—', from: className(change.from), to: className(change.to) })}</li>{/each}
      </ul>
    {/if}
    <AlertDialog.Footer>
      <AlertDialog.Cancel>{m['adventure.camp_balance_cancel']()}</AlertDialog.Cancel>
      {#if plan.length}<AlertDialog.Action class="camp-gold-button" onclick={() => void balance()}>{m['adventure.camp_balance_confirm']()}</AlertDialog.Action>{/if}
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>

<style>
  .heroes {
    display: grid;
    grid-template-columns: 260px minmax(0, 1fr);
    gap: 18px;
    min-height: 0;
  }

  @media (max-width: 900px) {
    .heroes { grid-template-columns: 1fr; }
  }

  .side {
    display: grid;
    align-content: start;
    gap: 10px;
  }

  .detail {
    display: grid;
    gap: 16px;
    min-width: 0;
    container-type: inline-size;
  }

  /* The nameplate: who the hero is, how far it has come, what to do. */
  .nameplate {
    display: grid;
    grid-template-columns: minmax(180px, 1.1fr) minmax(220px, 1fr) auto;
    gap: 12px 24px;
    align-items: center;
    padding: 14px 18px;
  }

  @container (max-width: 860px) {
    .nameplate { grid-template-columns: 1fr 1fr; }
    .controls { grid-column: 1 / -1; }
  }

  @container (max-width: 520px) {
    .nameplate { grid-template-columns: 1fr; }
  }

  .identity {
    display: grid;
    gap: 2px;
    min-width: 0;
  }

  h2 {
    font-size: 24px;
    line-height: 1.15;
  }

  .sub {
    margin: 0;
    font-size: 12.5px;
  }

  .progress {
    display: grid;
    gap: 6px;
  }

  .level {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  /* The level as a gold seal. */
  .badge {
    display: grid;
    place-items: center;
    flex: none;
    width: 40px;
    height: 40px;
    border-radius: 50%;
    background: radial-gradient(circle at 50% 35%, #f6d684, #b8862c 70%);
    box-shadow: 0 0 0 2px var(--camp-panel), 0 0 0 3px var(--camp-edge-strong), 0 0 14px -3px var(--camp-gold);
    color: #2a1a05;
    font-family: var(--camp-title-font);
    font-size: 14px;
    font-weight: 800;
  }

  .xp {
    display: grid;
    flex: 1;
    gap: 3px;
  }

  .xp small {
    font-size: 11px;
    font-variant-numeric: tabular-nums;
  }

  .status {
    margin: 0;
    font-size: 12.5px;
  }

  .power {
    color: var(--camp-gold-strong);
  }

  .inspired {
    color: var(--camp-gold);
  }

  .controls {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: 8px 12px;
  }

  .pick {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
  }

  .auto-gear {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--camp-ink-soft);
    font-size: 12px;
    cursor: pointer;
  }

  .sheet {
    display: grid;
    grid-template-columns: minmax(430px, 1.15fr) minmax(260px, 1fr);
    gap: 16px;
    align-items: start;
  }

  @container (max-width: 760px) {
    .sheet { grid-template-columns: 1fr; }
  }

  .armory-column {
    container-type: inline-size;
    min-width: 0;
  }

  .plan {
    display: grid;
    gap: 4px;
    margin: 0;
    padding-left: 18px;
    font-size: 13px;
  }
</style>
