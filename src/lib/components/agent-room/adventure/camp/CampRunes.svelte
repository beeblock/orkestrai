<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import type { AdventureCatalog } from '$lib/i18n/adventure/index.js';
  import { RUNES, RUNE_BRANCHES, canBuyRune, runeCost, type Rune, type RuneBranch } from '$lib/modules/agent-room/domain/adventure/runes.js';
  import { hasAtlas } from '../atlas.js';
  import * as m from '$lib/paraglide/messages.js';
  import type { AdventureAction, AdventureOutcome, AdventureSnapshot } from '../adventure-client.js';
  import { formatNumber, runeDescription } from '../adventure-text.js';
  import ItemIcon from './ItemIcon.svelte';

  let { snapshot, catalog, act, busy }: {
    snapshot: AdventureSnapshot;
    catalog: AdventureCatalog;
    act: (action: AdventureAction) => Promise<AdventureOutcome | null>;
    busy: boolean;
  } = $props();

  const ranks = $derived(snapshot.account.runes);
  // Each branch is one row of the rune sheet, in its own color; a rune's column is its place in the branch.
  const BRANCH_ROW: Record<RuneBranch, number> = { gold: 0, storage: 1, chests: 2, combat: 3, wisdom: 4, command: 5 };
  const BRANCH_TONE: Record<RuneBranch, string> = { gold: '#e8b84b', storage: '#4fd1c1', chests: '#e08a4a', combat: '#e8574b', wisdom: '#6fb6ff', command: '#b07cff' };

  function runeIcon(rune: Rune) {
    const place = RUNES.filter((entry) => entry.branch === rune.branch).indexOf(rune);
    return hasAtlas('icons-runes') ? { atlas: 'icons-runes', frame: BRANCH_ROW[rune.branch] * 5 + Math.min(4, place) } : { atlas: 'icons-misc', frame: 10 };
  }

  function state(rune: Rune) {
    return canBuyRune(rune.id, ranks, snapshot.account.gold);
  }
</script>

<div class="runes">
  <p class="intro camp-soft">{m['adventure.camp_runes_intro']()}</p>
  <div class="branches">
    {#each RUNE_BRANCHES as branch (branch)}
      {@const first = RUNES.find((rune) => rune.branch === branch)}
      <section class="branch camp-panel" aria-label={catalog.runeBranches[branch]} style:--tone={BRANCH_TONE[branch]}>
        <h3 class="camp-heading">{#if first}{@const icon = runeIcon(first)}<ItemIcon atlasId={icon.atlas} frame={icon.frame} size={26} />{/if}{catalog.runeBranches[branch]}</h3>
        {#each RUNES.filter((rune) => rune.branch === branch) as rune (rune.id)}
          {@const rank = ranks[rune.id] ?? 0}
          {@const verdict = state(rune)}
          {@const cost = runeCost(rune.id, ranks)}
          {@const icon = runeIcon(rune)}
          <article class="rune" class:owned={rank > 0} class:locked={verdict === 'locked'} class:complete={verdict === 'max'}>
            <span class="stone"><ItemIcon atlasId={icon.atlas} frame={icon.frame} size={42} dim={verdict === 'locked'} /></span>
            <div class="text">
              <header>
                <b>{catalog.runes[rune.id]}</b>
                <span class="pips" aria-label={m['adventure.camp_rank']({ rank, max: rune.costs.length })}>
                  {#each rune.costs as _, index (index)}<i class:on={index < rank}></i>{/each}
                </span>
              </header>
              <p>{runeDescription(catalog, rune, rank || 1)}{#if rank > 0 && rank < rune.costs.length}<span class="next">{` → ${runeDescription(catalog, rune, rank + 1)}`}</span>{/if}</p>
              {#if rune.requires && verdict === 'locked'}
                <small>{m['adventure.camp_rune_requires']({ rune: catalog.runes[rune.requires[0]], rank: rune.requires[1] })}</small>
              {/if}
              {#if cost !== null}
                <Button size="sm" class={verdict === 'ok' ? 'camp-gold-button w-fit' : 'w-fit'} variant={verdict === 'ok' ? 'default' : 'outline'} disabled={busy || verdict !== 'ok'} onclick={() => void act({ type: 'buy-rune', runeId: rune.id })} data-testid="camp-buy-rune">
                  {rank ? m['adventure.camp_rune_upgrade']({ gold: formatNumber(cost) }) : m['adventure.camp_rune_buy']({ gold: formatNumber(cost) })}
                </Button>
              {:else}
                <small class="done">{m['adventure.camp_rune_complete']()}</small>
              {/if}
            </div>
          </article>
        {/each}
      </section>
    {/each}
  </div>
</div>

<style>
  .runes {
    display: grid;
    gap: 14px;
  }

  .intro {
    margin: 0;
    font-size: 12.5px;
  }

  .branches {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
    gap: 14px;
  }

  /* A page of the grimoire per branch, edged in its color. */
  .branch {
    display: grid;
    align-content: start;
    gap: 8px;
    padding: 12px 12px 14px;
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--tone) 35%, var(--camp-edge)), inset 0 3px 0 color-mix(in srgb, var(--tone) 70%, transparent), var(--camp-shadow);
  }

  .rune {
    display: grid;
    grid-template-columns: 50px minmax(0, 1fr);
    gap: 10px;
    padding: 8px;
    border-radius: 9px;
    background: color-mix(in srgb, var(--camp-inset) 60%, transparent);
    box-shadow: inset 0 0 0 1px var(--camp-edge);
  }

  .rune.owned {
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--tone) 60%, transparent), 0 0 16px -8px var(--tone);
  }

  .rune.complete {
    background: color-mix(in srgb, var(--tone) 9%, var(--camp-inset));
  }

  .rune.locked {
    opacity: 0.62;
  }

  .stone {
    display: grid;
    place-items: center;
    width: 50px;
    height: 50px;
  }

  .rune.owned .stone {
    filter: drop-shadow(0 0 6px color-mix(in srgb, var(--tone) 70%, transparent));
  }

  .text {
    display: grid;
    gap: 5px;
    min-width: 0;
  }

  .text header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
  }

  .text b {
    font-size: 12.5px;
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
    background: var(--tone);
    box-shadow: 0 0 5px var(--tone);
  }

  .text p {
    margin: 0;
    color: var(--camp-ink-soft);
    font-size: 11.5px;
    line-height: 1.4;
  }

  .next {
    color: var(--camp-ink-muted);
  }

  .text small {
    color: var(--camp-ink-muted);
    font-size: 11px;
  }

  .done {
    font-weight: 600;
  }
</style>
