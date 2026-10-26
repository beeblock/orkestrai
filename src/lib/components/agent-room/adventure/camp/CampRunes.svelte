<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import type { AdventureCatalog } from '$lib/i18n/adventure/index.js';
  import { RUNES, RUNES_BY_ID, RUNE_BRANCHES, canBuyRune, runeCost, type Rune } from '$lib/modules/agent-room/domain/adventure/runes.js';
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

  function state(rune: Rune) {
    return canBuyRune(rune.id, ranks, snapshot.account.gold);
  }
</script>

<div class="runes">
  <p class="intro">{m['adventure.camp_runes_intro']()}</p>
  <div class="branches">
    {#each RUNE_BRANCHES as branch (branch)}
      <section class="branch" aria-label={catalog.runeBranches[branch]}>
        <h3><ItemIcon atlasId="icons-misc" frame={10} size={20} />{catalog.runeBranches[branch]}</h3>
        {#each RUNES.filter((rune) => rune.branch === branch) as rune (rune.id)}
          {@const rank = ranks[rune.id] ?? 0}
          {@const verdict = state(rune)}
          {@const cost = runeCost(rune.id, ranks)}
          <article class="rune" class:owned={rank > 0} class:locked={verdict === 'locked'} class:complete={verdict === 'max'}>
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
              <Button size="sm" variant={verdict === 'ok' ? 'default' : 'outline'} disabled={busy || verdict !== 'ok'} onclick={() => void act({ type: 'buy-rune', runeId: rune.id })} data-testid="camp-buy-rune">
                {rank ? m['adventure.camp_rune_upgrade']({ gold: formatNumber(cost) }) : m['adventure.camp_rune_buy']({ gold: formatNumber(cost) })}
              </Button>
            {:else}
              <small class="done">{m['adventure.camp_rune_complete']()}</small>
            {/if}
          </article>
        {/each}
      </section>
    {/each}
  </div>
</div>

<style>
  .runes {
    display: grid;
    gap: 12px;
  }

  .intro {
    margin: 0;
    color: var(--app-text-soft);
    font-size: 12.5px;
  }

  .branches {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(215px, 1fr));
    gap: 12px;
  }

  .branch {
    display: grid;
    align-content: start;
    gap: 8px;
  }

  h3 {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0;
    font-size: 13.5px;
    font-weight: 600;
  }

  .rune {
    display: grid;
    gap: 6px;
    padding: 10px;
    border-radius: 10px;
    background: var(--app-surface);
    box-shadow: inset 0 0 0 1px var(--app-border);
  }

  .rune.owned {
    box-shadow: inset 0 0 0 1px color-mix(in srgb, #b46cff 50%, transparent);
  }

  .rune.locked {
    opacity: 0.55;
  }

  .rune header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .rune b {
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
    box-shadow: inset 0 0 0 1px var(--app-border-strong);
  }

  .pips i.on {
    background: #b46cff;
    box-shadow: none;
  }

  .rune p {
    margin: 0;
    color: var(--app-text-soft);
    font-size: 12px;
  }

  .next {
    color: var(--app-success);
  }

  small {
    color: var(--app-text-muted);
    font-size: 11.5px;
  }

  .done {
    color: #b46cff;
  }

  .rune :global(button) {
    width: fit-content;
  }

</style>
