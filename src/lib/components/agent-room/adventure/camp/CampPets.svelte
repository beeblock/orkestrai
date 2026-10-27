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
  <p class="intro camp-soft">{m['adventure.camp_pets_intro']()}</p>
  <div class="grid">
    {#each PETS as pet (pet.id)}
      {@const kills = snapshot.account.killsByMonster[pet.monster] ?? 0}
      {@const tamed = snapshot.tamedPets.includes(pet.id)}
      {@const active = snapshot.account.activePet === pet.id}
      {@const share = Math.min(100, (kills / pet.kills) * 100)}
      <article class="pet camp-panel" class:tamed class:active class:ornate={active}>
        <div class="den camp-well" class:shadow={!tamed}>
          <SpriteView atlasId={pet.sprite.atlas} frames={Array.from({ length: 6 }, (_, index) => pet.sprite.row * 6 + index)} width={110} height={84} />
          {#if !tamed}<span class="mystery" aria-hidden="true">?</span>{/if}
        </div>
        <div class="text">
          <b class:unknown={!tamed}>{tamed ? catalog.pets[pet.id] : '???'}</b>
          <span class="bonus">{statLines(catalog, pet.stats).join(' · ')}</span>
          {#if !tamed}
            <span class="camp-bar" role="progressbar" aria-label={m['adventure.camp_pet_progress']({ monster: monsterName(pet.monster), kills: formatNumber(kills), needed: formatNumber(pet.kills) })} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(share)}><span style:width={`${share}%`}></span></span>
            <small class="camp-muted">{m['adventure.camp_pet_progress']({ monster: monsterName(pet.monster), kills: formatNumber(Math.min(kills, pet.kills)), needed: formatNumber(pet.kills) })}</small>
          {:else}
            <Button size="sm" class={active ? 'camp-gold-button w-fit' : 'w-fit'} variant={active ? 'default' : 'outline'} disabled={busy} onclick={() => void act({ type: 'pet', petId: active ? null : pet.id })}>
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
    gap: 14px;
  }

  .intro {
    margin: 0;
    font-size: 12.5px;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
    gap: 14px;
  }

  .pet {
    display: grid;
    grid-template-columns: 124px minmax(0, 1fr);
    gap: 14px;
    align-items: center;
    padding: 12px;
  }

  .pet.active {
    box-shadow: inset 0 0 0 1px var(--camp-gold), 0 0 22px -8px var(--camp-gold), var(--camp-shadow);
  }

  /* The pet's den: a lit hollow; untamed pets are a silhouette with a question mark. */
  .den {
    position: relative;
    display: grid;
    place-items: end center;
    width: 124px;
    height: 96px;
    overflow: hidden;
    background:
      radial-gradient(ellipse 60% 18% at 50% 92%, rgba(0, 0, 0, 0.35), transparent 70%),
      radial-gradient(circle at 50% 45%, var(--camp-raised), var(--camp-inset) 78%);
  }

  .pet.tamed .den {
    background:
      radial-gradient(ellipse 60% 18% at 50% 92%, rgba(0, 0, 0, 0.3), transparent 70%),
      radial-gradient(circle at 50% 45%, color-mix(in srgb, var(--camp-gold) 16%, var(--camp-raised)), var(--camp-inset) 78%);
  }

  .den.shadow :global(canvas) {
    filter: brightness(0) opacity(0.55);
  }

  .mystery {
    position: absolute;
    top: 8px;
    right: 10px;
    color: var(--camp-gold);
    font-family: var(--camp-title-font);
    font-size: 20px;
    font-weight: 800;
  }

  .text {
    display: grid;
    gap: 6px;
    min-width: 0;
  }

  .text b {
    font-family: var(--camp-title-font);
    font-size: 15px;
    letter-spacing: 0.03em;
    color: var(--camp-gold-strong);
  }

  .text b.unknown {
    color: var(--camp-ink-muted);
  }

  .bonus {
    color: var(--adventure-ink-uncommon);
    font-size: 12px;
    font-weight: 600;
  }

  .text small {
    font-size: 11.5px;
  }
</style>
