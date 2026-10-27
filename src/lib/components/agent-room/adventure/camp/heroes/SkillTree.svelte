<script lang="ts">
  import { Lock, Plus, RotateCcw } from '@lucide/svelte';
  import { Button } from '$lib/components/ui/button';
  import { Switch } from '$lib/components/ui/switch';
  import * as NativeSelect from '$lib/components/ui/native-select';
  import * as Tooltip from '$lib/components/ui/tooltip';
  import type { AdventureCatalog } from '$lib/i18n/adventure/index.js';
  import { SKILL_TREES, canRaise, tierRequirement, type SkillNode } from '$lib/modules/agent-room/domain/adventure/skills.js';
  import * as m from '$lib/paraglide/messages.js';
  import type { AdventureAction, AdventureOutcome } from '../../adventure-client.js';
  import type { HeroView } from '../../adventure-party.js';
  import { skillDescription } from '../../adventure-text.js';
  import { AURA_ICON, SKILL_POINT_ICON, activeIcon, skillIcon } from '../../skill-icons.js';
  import ItemIcon from '../ItemIcon.svelte';

  /**
   * The class's skill tree: eight tiers joined by a spine that lights up as
   * they open, each skill a framed icon (round for actives, a hexagon for
   * auras, square for passives) with its ranks; above it, the combat bar of
   * slotted actives.
   */
  let { hero, catalog, act, busy, activeSlots }: {
    hero: HeroView;
    catalog: AdventureCatalog;
    act: (action: AdventureAction) => Promise<AdventureOutcome | null>;
    busy: boolean;
    activeSlots: number;
  } = $props();

  const KIND_LABEL: Record<SkillNode['kind'], () => string> = {
    passive: m['adventure.skill_kind_passive'],
    aura: m['adventure.skill_kind_aura'],
    active: m['adventure.skill_kind_active'],
  };
  const NUMERALS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];
  const TIERS = [1, 2, 3, 4, 5, 6, 7, 8];

  const tree = $derived(SKILL_TREES[hero.classId]);
  const free = $derived(hero.build.skillPoints - hero.build.pointsSpent);
  const open = $derived(TIERS.map((tier) => pointsBelow(tier) >= tierRequirement(tier)));
  const reached = $derived(open.lastIndexOf(true) + 1);

  function pointsBelow(tier: number): number {
    return tree.filter((node) => node.tier < tier).reduce((sum, node) => sum + (hero.skills[node.id] ?? 0), 0);
  }

  function raise(node: SkillNode) {
    if (canRaise(hero.classId, hero.level, hero.skills, node.id) !== 'ok') return;
    void act({ type: 'raise-skill', heroId: hero.id, skillId: node.id });
  }

  function setActive(index: number, value: string) {
    const next = hero.build.actives.map((active) => active.id);
    next[index] = value;
    void act({ type: 'set-actives', heroId: hero.id, actives: next.filter(Boolean) });
  }
</script>

<section class="skills camp-panel ornate" aria-label={m['adventure.camp_skills']()}>
  <header class="top">
    <h3 class="camp-heading plain">{m['adventure.camp_skills']()}</h3>
    <span class="points camp-chip" class:has={free > 0}><ItemIcon atlasId={SKILL_POINT_ICON.atlas} frame={SKILL_POINT_ICON.frame} size={20} />{m['adventure.camp_points']({ count: free })}</span>
    <label class="auto"><Switch checked={hero.autoSkills} disabled={busy} onCheckedChange={(checked: boolean) => void act({ type: 'auto-skills', heroId: hero.id, enabled: checked })} aria-label={m['adventure.camp_auto_skills']()} />{m['adventure.camp_auto_skills']()}</label>
    <Button size="sm" variant="ghost" disabled={busy || hero.build.pointsSpent === 0} onclick={() => void act({ type: 'reset-skills', heroId: hero.id })}><RotateCcw size={13} aria-hidden="true" />{m['adventure.camp_respec']()}</Button>
  </header>

  <div class="bar" role="group" aria-label={m['adventure.camp_active_slots']()}>
    <span class="bar-title">{m['adventure.camp_active_slots']()}</span>
    {#each Array.from({ length: activeSlots }, (_, index) => index) as index (index)}
      {@const slotted = hero.build.actives[index]}
      {@const node = slotted ? tree.find((entry) => entry.id === slotted.id) : null}
      <div class="bar-slot">
        <span class="orb" class:filled={Boolean(node)}>
          {#if node?.active}{@const icon = activeIcon(node.active.action)}<ItemIcon atlasId={icon.atlas} frame={icon.frame} size={40} />{:else}<span class="orb-number">{index + 1}</span>{/if}
        </span>
        <NativeSelect.Root size="sm" class="w-[170px]" disabled={busy || !hero.build.learned.length} value={slotted?.id ?? ''} onchange={(event: Event) => setActive(index, (event.currentTarget as HTMLSelectElement).value)} aria-label={m['adventure.camp_active_slot']({ index: index + 1 })}>
          {#if !slotted}<NativeSelect.Option value="">{m['adventure.camp_active_empty']()}</NativeSelect.Option>{/if}
          {#each hero.build.learned as active (active.id)}<NativeSelect.Option value={active.id}>{catalog.skills[active.id]}</NativeSelect.Option>{/each}
        </NativeSelect.Root>
      </div>
    {/each}
  </div>

  <ol class="tree" style:--reached={reached}>
    {#each TIERS as tier, row (tier)}
      <li class="tier" class:locked={!open[row]}>
        <span class="medallion" title={open[row] ? m['adventure.camp_tier']({ tier }) : m['adventure.camp_tier_needs']({ points: tierRequirement(tier) })}>
          {#if open[row]}{NUMERALS[row]}{:else}<Lock size={13} aria-hidden="true" />{/if}
        </span>
        <div class="row">
          {#if !open[row]}<p class="needs">{m['adventure.camp_tier_needs']({ points: tierRequirement(tier) })}</p>{/if}
          <div class="nodes">
            {#each tree.filter((node) => node.tier === tier) as node (node.id)}
              {@const rank = hero.skills[node.id] ?? 0}
              {@const verdict = canRaise(hero.classId, hero.level, hero.skills, node.id)}
              {@const icon = skillIcon(node)}
              <Tooltip.Root>
                <Tooltip.Trigger>
                  {#snippet child({ props })}
                    <button {...props} type="button" class={`node ${node.kind}`} class:learned={rank > 0} class:maxed={rank >= node.maxRank} class:ready={verdict === 'ok'} disabled={busy || verdict !== 'ok'} onclick={() => raise(node)} aria-label={`${catalog.skills[node.id]} · ${rank}/${node.maxRank}`} data-testid="camp-skill">
                      <span class="frame-wrap">
                        <span class="frame"><ItemIcon atlasId={icon.atlas} frame={icon.frame} size={44} dim={rank === 0} /></span>
                        {#if node.kind === 'aura'}<span class="badge"><ItemIcon atlasId={AURA_ICON.atlas} frame={AURA_ICON.frame} size={18} /></span>{/if}
                        {#if verdict === 'ok'}<span class="plus" aria-hidden="true"><Plus size={11} strokeWidth={3} /></span>{/if}
                      </span>
                      <span class="pips" aria-hidden="true">{#each Array.from({ length: node.maxRank }, (_, index) => index) as pip (pip)}<i class:on={pip < rank}></i>{/each}</span>
                      <span class="name">{catalog.skills[node.id]}</span>
                    </button>
                  {/snippet}
                </Tooltip.Trigger>
                <Tooltip.Content side="top" class="camp-popover max-w-[280px] p-3">
                  <div class="tip">
                    <b>{catalog.skills[node.id]}</b>
                    <span class={`kind ${node.kind}`}>{KIND_LABEL[node.kind]()} · {rank}/{node.maxRank}</span>
                    {#if rank > 0}<p>{m['adventure.camp_now']({ text: skillDescription(catalog, node, rank) })}</p>{/if}
                    {#if rank < node.maxRank}<p>{m['adventure.camp_next']({ text: skillDescription(catalog, node, rank + 1) })}</p>{/if}
                    {#if node.active}<p class="cool">{m['adventure.camp_cooldown']({ seconds: Math.round(node.active.cooldownMs / 1000) })}</p>{/if}
                  </div>
                </Tooltip.Content>
              </Tooltip.Root>
            {/each}
          </div>
        </div>
      </li>
    {/each}
  </ol>
</section>

<style>
  .skills {
    display: grid;
    gap: 14px;
    padding: 14px 16px 18px;
  }

  .top {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 14px;
  }

  .points {
    color: var(--camp-ink-soft);
  }

  .points.has {
    color: var(--camp-teal);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--camp-teal) 60%, transparent), 0 0 12px -4px var(--camp-teal);
    font-weight: 700;
  }

  .auto {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin-left: auto;
    color: var(--camp-ink-soft);
    font-size: 12px;
    cursor: pointer;
  }

  /* The combat bar: slotted actives as glowing orbs. */
  .bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px 18px;
    padding: 10px 12px;
    border-radius: 10px;
    background: var(--camp-inset);
    box-shadow: inset 0 0 0 1px var(--camp-edge);
  }

  .bar-title {
    color: var(--camp-ink-muted);
    font-size: 12px;
    font-weight: 600;
  }

  .bar-slot {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .orb {
    display: grid;
    place-items: center;
    width: 52px;
    height: 52px;
    border-radius: 50%;
    background: radial-gradient(circle at 50% 40%, var(--camp-raised), var(--camp-inset) 75%);
    box-shadow: inset 0 0 0 2px var(--camp-edge), inset 0 2px 8px rgba(0, 0, 0, 0.45);
  }

  .orb.filled {
    box-shadow: inset 0 0 0 2px var(--camp-gold), 0 0 14px -3px var(--camp-gold), inset 0 2px 8px rgba(0, 0, 0, 0.45);
  }

  .orb-number {
    color: var(--camp-ink-muted);
    font-family: var(--camp-title-font);
    font-weight: 700;
  }

  /* Tiers on a spine that is gold up to the highest open tier. */
  .tree {
    position: relative;
    display: grid;
    gap: 10px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .tree::before,
  .tree::after {
    content: '';
    position: absolute;
    top: 18px;
    left: 17px;
    width: 3px;
    border-radius: 2px;
  }

  .tree::before {
    bottom: 18px;
    background: var(--camp-edge);
  }

  .tree::after {
    height: calc((100% - 36px) * (var(--reached) - 1) / 7);
    background: linear-gradient(180deg, var(--camp-gold-strong), var(--camp-gold));
    box-shadow: 0 0 8px var(--camp-glow);
    transition: height 500ms cubic-bezier(0.2, 0.8, 0.2, 1);
  }

  .tier {
    position: relative;
    display: grid;
    grid-template-columns: 37px minmax(0, 1fr);
    gap: 12px;
    align-items: center;
  }

  .medallion {
    position: relative;
    z-index: 1;
    display: grid;
    place-items: center;
    width: 37px;
    height: 37px;
    border-radius: 50%;
    background: radial-gradient(circle at 50% 35%, #f6d684, #b8862c 70%);
    box-shadow: 0 0 0 2px var(--camp-panel), 0 0 0 3px var(--camp-edge-strong), 0 0 12px -2px var(--camp-gold);
    color: #2a1a05;
    font-family: var(--camp-title-font);
    font-size: 12px;
    font-weight: 800;
  }

  .tier.locked .medallion {
    background: radial-gradient(circle at 50% 35%, var(--camp-raised), var(--camp-inset) 75%);
    box-shadow: 0 0 0 2px var(--camp-panel), 0 0 0 3px var(--camp-edge);
    color: var(--camp-ink-muted);
  }

  .row {
    display: grid;
    gap: 4px;
  }

  .needs {
    margin: 0;
    color: var(--camp-ink-muted);
    font-size: 11.5px;
  }

  /* Each tier branches off the spine: a bronze line, gold once the tier is open. */
  .nodes {
    position: relative;
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 8px 28px;
  }

  .nodes::before {
    content: '';
    position: absolute;
    top: 33px;
    left: -12px;
    right: 8%;
    height: 2px;
    background: linear-gradient(90deg, var(--camp-gold), color-mix(in srgb, var(--camp-gold) 25%, transparent));
    opacity: 0.55;
  }

  .tier.locked .nodes::before {
    background: linear-gradient(90deg, var(--camp-edge), transparent);
  }

  .nodes > :global(*) {
    position: relative;
  }

  .tier.locked .nodes {
    opacity: 0.5;
    filter: saturate(0.6);
  }

  .node {
    display: grid;
    justify-items: center;
    gap: 4px;
    width: 104px;
    padding: 6px 4px 7px;
    border: 0;
    border-radius: 10px;
    background: transparent;
    color: var(--camp-ink);
    cursor: pointer;
    transition: background-color 150ms ease;
  }

  .node:disabled {
    cursor: default;
  }

  .node.ready:hover {
    background: color-mix(in srgb, var(--camp-gold) 9%, transparent);
  }

  .frame-wrap {
    position: relative;
    display: grid;
  }

  .frame {
    position: relative;
    display: grid;
    place-items: center;
    width: 56px;
    height: 56px;
    background: radial-gradient(circle at 50% 40%, var(--camp-raised), var(--camp-inset) 78%);
    box-shadow: inset 0 0 0 2px var(--camp-edge), inset 0 2px 8px rgba(0, 0, 0, 0.45);
  }

  .node.passive .frame { border-radius: 10px; }
  .node.active .frame { border-radius: 50%; }
  /* Auras are hexagons: the edge color shows around an inner hexagon. */
  .node.aura .frame {
    clip-path: polygon(25% 2%, 75% 2%, 100% 50%, 75% 98%, 25% 98%, 0 50%);
    background: var(--camp-edge);
    box-shadow: none;
  }

  .node.aura .frame::before {
    content: '';
    position: absolute;
    inset: 2px;
    clip-path: polygon(25% 2%, 75% 2%, 100% 50%, 75% 98%, 25% 98%, 0 50%);
    background: radial-gradient(circle at 50% 40%, color-mix(in srgb, #b6f07a 18%, var(--camp-raised)), var(--camp-inset) 78%);
  }

  .node.aura .frame > :global(*) {
    position: relative;
  }

  .node.aura.learned .frame,
  .node.aura.maxed .frame {
    background: var(--adventure-ink-aura);
    box-shadow: none;
  }

  .node.learned .frame {
    box-shadow: inset 0 0 0 2px var(--camp-edge-strong), inset 0 2px 8px rgba(0, 0, 0, 0.4);
  }

  .node.active.learned .frame {
    box-shadow: inset 0 0 0 2px var(--camp-gold), 0 0 12px -3px var(--camp-gold), inset 0 2px 8px rgba(0, 0, 0, 0.4);
  }

  .node.maxed .frame {
    box-shadow: inset 0 0 0 2px var(--camp-gold-strong), 0 0 14px -2px var(--camp-gold), inset 0 2px 8px rgba(0, 0, 0, 0.35);
  }

  /* A skill a point can go into breathes gold. */
  .node.ready .frame {
    animation: ready 2.4s ease-in-out infinite;
  }

  @keyframes ready {
    50% { filter: drop-shadow(0 0 6px var(--camp-glow)) brightness(1.08); }
  }

  .badge {
    position: absolute;
    right: -4px;
    bottom: -3px;
  }

  .plus {
    position: absolute;
    top: -3px;
    right: -3px;
    display: grid;
    place-items: center;
    width: 17px;
    height: 17px;
    border-radius: 50%;
    background: linear-gradient(180deg, #f2cd72, #d39a32);
    box-shadow: 0 0 0 1px #8a5d14;
    color: #2a1a05;
  }

  .pips {
    display: flex;
    gap: 3px;
  }

  .pips i {
    width: 7px;
    height: 7px;
    border-radius: 2px;
    background: var(--camp-inset);
    box-shadow: inset 0 0 0 1px var(--camp-edge-strong);
    transform: rotate(45deg);
  }

  .pips i.on {
    background: var(--camp-gold);
    box-shadow: 0 0 5px var(--camp-glow);
  }

  .name {
    max-width: 100%;
    overflow: hidden;
    font-size: 11.5px;
    font-weight: 600;
    line-height: 1.2;
    text-align: center;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tip {
    display: grid;
    gap: 4px;
    font-size: 12px;
  }

  .tip b {
    font-family: var(--camp-title-font);
    color: var(--camp-gold-strong);
  }

  .tip p {
    margin: 0;
    line-height: 1.4;
  }

  .kind {
    color: var(--camp-ink-muted);
    font-size: 11px;
  }

  .kind.active { color: var(--adventure-ink-active); }
  .kind.aura { color: var(--adventure-ink-aura); }

  .cool {
    color: var(--camp-ink-muted);
  }

  @media (prefers-reduced-motion: reduce) {
    .node.ready .frame { animation: none; }
    .tree::after { transition: none; }
  }
</style>
