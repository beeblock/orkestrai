import type { MonsterId } from './catalog.js';
import { addStats, type StatBlock } from './stats.js';

/**
 * Pets: tamed versions of the software bugs. Slaying enough of a kind of
 * monster tames its pet. Every tamed pet's bonus applies to all heroes
 * whether it walks with the party or not; one of them follows the party.
 */

export type PetId = 'blip' | 'scarab' | 'flicker' | 'tinker' | 'cinder' | 'drip' | 'webby' | 'gust';

export type Pet = {
  id: PetId;
  monster: MonsterId;
  kills: number;
  stats: StatBlock;
  /** Sprite sheet and row of its walk cycle. */
  sprite: { atlas: string; row: number };
};

export const PETS: Pet[] = [
  { id: 'blip', monster: 'glitch-slime', kills: 800, stats: { goldFind: 10 }, sprite: { atlas: 'pets-1', row: 0 } },
  { id: 'scarab', monster: 'bug-beetle', kills: 800, stats: { armorPct: 6 }, sprite: { atlas: 'pets-1', row: 1 } },
  { id: 'flicker', monster: 'null-wisp', kills: 1_200, stats: { magicFind: 8 }, sprite: { atlas: 'pets-1', row: 2 } },
  { id: 'tinker', monster: 'flaky-gremlin', kills: 1_200, stats: { critDamage: 10 }, sprite: { atlas: 'pets-1', row: 3 } },
  { id: 'cinder', monster: 'stale-imp', kills: 1_600, stats: { xpBonus: 10 }, sprite: { atlas: 'pets-2', row: 0 } },
  { id: 'drip', monster: 'leak-ooze', kills: 1_600, stats: { maxHpPct: 8 }, sprite: { atlas: 'pets-2', row: 1 } },
  { id: 'webby', monster: 'dependency-spider', kills: 2_000, stats: { chestChance: 12 }, sprite: { atlas: 'pets-2', row: 2 } },
  { id: 'gust', monster: 'timeout-harpy', kills: 2_500, stats: { attackSpeed: 4 }, sprite: { atlas: 'pets-2', row: 3 } },
];

export const PETS_BY_ID = Object.fromEntries(PETS.map((pet) => [pet.id, pet])) as Record<PetId, Pet>;

export type KillCounts = Partial<Record<MonsterId, number>>;

export function tamedPets(kills: KillCounts): PetId[] {
  return PETS.filter((pet) => (kills[pet.monster] ?? 0) >= pet.kills).map((pet) => pet.id);
}

export function petStats(kills: KillCounts): StatBlock {
  return addStats(...PETS.filter((pet) => (kills[pet.monster] ?? 0) >= pet.kills).map((pet) => pet.stats));
}
