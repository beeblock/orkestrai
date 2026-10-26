<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import type { AdventureCatalog } from '$lib/i18n/adventure/index.js';
  import type { MonsterId } from '$lib/modules/agent-room/domain/adventure/catalog.js';
  import { PETS } from '$lib/modules/agent-room/domain/adventure/pets.js';
  import * as m from '$lib/paraglide/messages.js';
  import type { AdventureAction, AdventureOutcome, AdventureSnapshot } from '../adventure-client.js';
  import { formatNumber, statLines } from '../adventure-text.js';
  import SpriteView from './SpriteView.svelte';

  let { snapshot, catalog, act, busy }: {
    snapshot: AdventureSnapshot;
    catalog: AdventureCatalog;
    act: (action: AdventureAction) => Promise<AdventureOutcome | null>;
    busy: boolean;
  } = $props();

  const monsterName = (id: MonsterId) => (m as unknown as Record<string, () => string>)[`adventure.monster_${id.replace(/-/g, '_')}`]?.() ?? id;
</script>

<div class="pets">
  <p class="intro">{m['adventure.camp_pets_intro']()}</p>
  <div class="grid">
    {#each PETS as pet (pet.id)}
      {@const kills = snapshot.account.killsByMonster[pet.monster] ?? 0}
      {@const tamed = snapshot.tamedPets.includes(pet.id)}
      {@const active = snapshot.account.activePet === pet.id}
      <article class="pet" class:tamed class:active>
        <div class="art" class:shadow={!tamed}>
          <SpriteView atlasId={pet.sprite.atlas} frames={Array.from({ length: 6 }, (_, index) => pet.sprite.row * 6 + index)} width={92} height={70} />
        </div>
        <div class="text">
          <b>{tamed ? catalog.pets[pet.id] : '???'}</b>
          <span class="bonus">{statLines(catalog, pet.stats).join(' · ')}</span>
          <span class="progress" title={m['adventure.camp_pet_progress']({ monster: monsterName(pet.monster), kills: formatNumber(kills), needed: formatNumber(pet.kills) })}>
            <span style:width={`${Math.min(100, (kills / pet.kills) * 100)}%`}></span>
          </span>
          <small>{m['adventure.camp_pet_progress']({ monster: monsterName(pet.monster), kills: formatNumber(Math.min(kills, pet.kills)), needed: formatNumber(pet.kills) })}</small>
          {#if tamed}
            <Button size="sm" variant={active ? 'default' : 'outline'} disabled={busy} onclick={() => void act({ type: 'pet', petId: active ? null : pet.id })}>
              {active ? m['adventure.camp_pet_following']() : m['adventure.camp_pet_follow']()}
            </Button>
          {/if}
        </div>
      </article>
    {/each}
  </div>
</div>

<style>
  .pets {
    display: grid;
    gap: 12px;
  }

  .intro {
    margin: 0;
    color: var(--app-text-soft);
    font-size: 12.5px;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 12px;
  }

  .pet {
    display: flex;
    gap: 12px;
    padding: 10px;
    border-radius: 10px;
    background: var(--app-surface);
    box-shadow: inset 0 0 0 1px var(--app-border);
  }

  .pet.active {
    box-shadow: inset 0 0 0 1px var(--app-accent);
  }

  .art {
    display: grid;
    place-items: end center;
    border-radius: 8px;
    background: radial-gradient(circle at 50% 80%, var(--app-surface-raised), transparent 75%);
  }

  .art.shadow {
    filter: brightness(0) opacity(0.45);
  }

  .text {
    display: grid;
    align-content: start;
    gap: 4px;
    min-width: 0;
  }

  b {
    font-size: 13px;
  }

  .bonus {
    color: var(--app-success);
    font-size: 12px;
  }

  .progress {
    position: relative;
    height: 4px;
    border-radius: 2px;
    background: var(--app-hover);
    overflow: hidden;
  }

  .progress > span {
    position: absolute;
    inset: 0 auto 0 0;
    background: var(--app-accent);
  }

  small {
    color: var(--app-text-muted);
    font-size: 11.5px;
  }

  .text :global(button) {
    width: fit-content;
  }
</style>
