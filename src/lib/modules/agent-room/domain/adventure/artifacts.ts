import type { HeroClassId } from './catalog.js';
import type { Slot } from './items.js';
import { addStats, scaleStats, type StatBlock } from './stats.js';

/**
 * Gear beyond random drops: unique items with a power of their own, class
 * sets whose pieces add up to bonuses, and elixirs drunk at the camp.
 *
 * Each unique comes from one act boss (or, for a few, from any red chest on
 * Hell and Torment), keeps its look and name and carries a power the battle
 * knows how to play. Sets belong to a class: two, four and six pieces worn
 * by the same hero unlock growing bonuses, the sixth a power.
 */

export type PowerId =
  // Unique powers.
  | 'cleave' | 'chain' | 'phoenix' | 'echo' | 'overflow' | 'first-strike'
  | 'frostbite' | 'thorns' | 'executioner' | 'overdrive' | 'last-stand' | 'momentum'
  | 'encore' | 'midas' | 'aegis' | 'starfall' | 'bounty' | 'feast'
  // Set powers (six pieces).
  | 'bastion' | 'gale' | 'arcane-surge' | 'dawn' | 'automaton' | 'harmony';

export const POWER_IDS: PowerId[] = [
  'cleave', 'chain', 'phoenix', 'echo', 'overflow', 'first-strike',
  'frostbite', 'thorns', 'executioner', 'overdrive', 'last-stand', 'momentum',
  'encore', 'midas', 'aegis', 'starfall', 'bounty', 'feast',
  'bastion', 'gale', 'arcane-surge', 'dawn', 'automaton', 'harmony',
];

// ---------------------------------------------------------------------------
// Uniques.

export type UniqueId =
  | 'hydra-merge' | 'canopy-whisper' | 'rootbound-cowl'
  | 'infinite-loop' | 'mirage-censer' | 'scorpion-grips'
  | 'frostbite-locket' | 'glacier-plate' | 'executioner-band'
  | 'overclocked-spanner' | 'anvilheart-mail' | 'forgefire-treads'
  | 'last-chorus' | 'midas-signet' | 'aegis-striders'
  | 'starfall-pendant' | 'crown-of-bounties' | 'vampire-grasp';

export type UniqueItem = {
  id: UniqueId;
  slot: Slot;
  /** Weapons belong to one class. */
  classId: HeroClassId | null;
  power: PowerId;
  /** The act whose boss drops it; null for the uniques any red chest can hold on Hell and Torment. */
  act: number | null;
  /** On top of the base item; grows with rarity from Legendary up. */
  stats: StatBlock;
  icon: { atlas: string; frame: number };
};

export const UNIQUES: Record<UniqueId, UniqueItem> = {
  'hydra-merge': { id: 'hydra-merge', slot: 'weapon', classId: 'knight', power: 'cleave', act: 1, stats: { attackPct: 15, critDamage: 20 }, icon: { atlas: 'icons-uniques-1', frame: 0 } },
  'canopy-whisper': { id: 'canopy-whisper', slot: 'weapon', classId: 'ranger', power: 'chain', act: 1, stats: { attackSpeed: 10, critChance: 4 }, icon: { atlas: 'icons-uniques-1', frame: 1 } },
  'rootbound-cowl': { id: 'rootbound-cowl', slot: 'helmet', classId: null, power: 'phoenix', act: 1, stats: { maxHpPct: 12, damageReduction: 3 }, icon: { atlas: 'icons-uniques-1', frame: 2 } },
  'infinite-loop': { id: 'infinite-loop', slot: 'weapon', classId: 'sorceress', power: 'echo', act: 2, stats: { skillDamage: 20, cooldownReduction: 6 }, icon: { atlas: 'icons-uniques-1', frame: 3 } },
  'mirage-censer': { id: 'mirage-censer', slot: 'weapon', classId: 'cleric', power: 'overflow', act: 2, stats: { skillDamage: 15, maxHpPct: 10 }, icon: { atlas: 'icons-uniques-1', frame: 4 } },
  'scorpion-grips': { id: 'scorpion-grips', slot: 'gloves', classId: null, power: 'first-strike', act: 2, stats: { critDamage: 25, attackSpeed: 5 }, icon: { atlas: 'icons-uniques-1', frame: 5 } },
  'frostbite-locket': { id: 'frostbite-locket', slot: 'amulet', classId: null, power: 'frostbite', act: 3, stats: { skillDamage: 12, critChance: 3 }, icon: { atlas: 'icons-uniques-1', frame: 6 } },
  'glacier-plate': { id: 'glacier-plate', slot: 'armor', classId: null, power: 'thorns', act: 3, stats: { armorPct: 20, maxHpPct: 10 }, icon: { atlas: 'icons-uniques-1', frame: 7 } },
  'executioner-band': { id: 'executioner-band', slot: 'ring', classId: null, power: 'executioner', act: 3, stats: { critDamage: 20, bossDamage: 15 }, icon: { atlas: 'icons-uniques-1', frame: 8 } },
  'overclocked-spanner': { id: 'overclocked-spanner', slot: 'weapon', classId: 'artificer', power: 'overdrive', act: 4, stats: { attackPct: 12, cooldownReduction: 8 }, icon: { atlas: 'icons-uniques-1', frame: 9 } },
  'anvilheart-mail': { id: 'anvilheart-mail', slot: 'armor', classId: null, power: 'last-stand', act: 4, stats: { maxHpPct: 18, damageReduction: 4 }, icon: { atlas: 'icons-uniques-1', frame: 10 } },
  'forgefire-treads': { id: 'forgefire-treads', slot: 'boots', classId: null, power: 'momentum', act: 4, stats: { attackSpeed: 8, goldFind: 15 }, icon: { atlas: 'icons-uniques-1', frame: 11 } },
  'last-chorus': { id: 'last-chorus', slot: 'weapon', classId: 'maestro', power: 'encore', act: 5, stats: { cooldownReduction: 10, xpBonus: 10 }, icon: { atlas: 'icons-uniques-2', frame: 0 } },
  'midas-signet': { id: 'midas-signet', slot: 'ring', classId: null, power: 'midas', act: 5, stats: { goldFind: 40, magicFind: 15 }, icon: { atlas: 'icons-uniques-2', frame: 1 } },
  'aegis-striders': { id: 'aegis-striders', slot: 'boots', classId: null, power: 'aegis', act: 5, stats: { armorPct: 15, maxHpPct: 10 }, icon: { atlas: 'icons-uniques-2', frame: 2 } },
  'starfall-pendant': { id: 'starfall-pendant', slot: 'amulet', classId: null, power: 'starfall', act: null, stats: { attackPct: 10, critChance: 4 }, icon: { atlas: 'icons-uniques-2', frame: 3 } },
  'crown-of-bounties': { id: 'crown-of-bounties', slot: 'helmet', classId: null, power: 'bounty', act: null, stats: { magicFind: 25, chestChance: 25 }, icon: { atlas: 'icons-uniques-2', frame: 4 } },
  'vampire-grasp': { id: 'vampire-grasp', slot: 'gloves', classId: null, power: 'feast', act: null, stats: { lifeSteal: 2, attackPct: 8 }, icon: { atlas: 'icons-uniques-2', frame: 5 } },
};

export const UNIQUE_IDS = Object.keys(UNIQUES) as UniqueId[];

/** A unique's own stats at a rarity index: Legendary (4) is the base, every tier above adds 20%. */
export function uniqueStats(uniqueId: UniqueId, rarity: number): StatBlock {
  return scaleStats(UNIQUES[uniqueId].stats, 1 + 0.2 * Math.max(0, rarity - 4));
}

// ---------------------------------------------------------------------------
// Class sets.

export type SetId = 'oathkeeper' | 'windrunner' | 'starweaver' | 'dawnbringer' | 'clockwork' | 'symphony';
export const SET_IDS: SetId[] = ['oathkeeper', 'windrunner', 'starweaver', 'dawnbringer', 'clockwork', 'symphony'];

/** Every set is a full suit of armor: these six pieces, in this order (also the order of its icons). */
export const SET_PIECES: Slot[] = ['helmet', 'shoulders', 'armor', 'gloves', 'legs', 'boots'];

export type ItemSet = {
  id: SetId;
  classId: HeroClassId;
  /** Bonuses worn with two and four pieces; six pieces add the power. */
  bonuses: { 2: StatBlock; 4: StatBlock };
  power: PowerId;
  icon: { atlas: string; row: number };
};

export const SETS: Record<SetId, ItemSet> = {
  oathkeeper: { id: 'oathkeeper', classId: 'knight', bonuses: { 2: { armorPct: 20 }, 4: { maxHpPct: 20, damageReduction: 5 } }, power: 'bastion', icon: { atlas: 'icons-sets-1', row: 0 } },
  windrunner: { id: 'windrunner', classId: 'ranger', bonuses: { 2: { attackSpeed: 10 }, 4: { critChance: 8, critDamage: 20 } }, power: 'gale', icon: { atlas: 'icons-sets-1', row: 1 } },
  starweaver: { id: 'starweaver', classId: 'sorceress', bonuses: { 2: { skillDamage: 20 }, 4: { cooldownReduction: 10, critChance: 4 } }, power: 'arcane-surge', icon: { atlas: 'icons-sets-2', row: 0 } },
  dawnbringer: { id: 'dawnbringer', classId: 'cleric', bonuses: { 2: { maxHpPct: 15 }, 4: { skillDamage: 20, armorPct: 10 } }, power: 'dawn', icon: { atlas: 'icons-sets-2', row: 1 } },
  clockwork: { id: 'clockwork', classId: 'artificer', bonuses: { 2: { attackPct: 15 }, 4: { cooldownReduction: 10, attackSpeed: 6 } }, power: 'automaton', icon: { atlas: 'icons-sets-3', row: 0 } },
  symphony: { id: 'symphony', classId: 'maestro', bonuses: { 2: { xpBonus: 15 }, 4: { goldFind: 20, cooldownReduction: 8 } }, power: 'harmony', icon: { atlas: 'icons-sets-3', row: 1 } },
};

/** Sets a hero wears and how many pieces of each. */
export function setCounts(equipped: Array<{ setId?: SetId | null }>): Partial<Record<SetId, number>> {
  const counts: Partial<Record<SetId, number>> = {};
  for (const item of equipped) if (item.setId) counts[item.setId] = (counts[item.setId] ?? 0) + 1;
  return counts;
}

/** The stats and powers a hero's set pieces unlock. */
export function setBonuses(counts: Partial<Record<SetId, number>>): { stats: StatBlock; powers: PowerId[] } {
  const blocks: StatBlock[] = [];
  const powers: PowerId[] = [];
  for (const [setId, count] of Object.entries(counts) as Array<[SetId, number]>) {
    const set = SETS[setId];
    if (count >= 2) blocks.push(set.bonuses[2]);
    if (count >= 4) blocks.push(set.bonuses[4]);
    if (count >= 6) powers.push(set.power);
  }
  return { stats: addStats(...blocks), powers };
}

// ---------------------------------------------------------------------------
// Elixirs: drunk at the camp, they help every hero for half an hour.

export type ElixirId = 'wisdom' | 'greed' | 'fortune' | 'might' | 'vigor' | 'discovery';
export const ELIXIR_IDS: ElixirId[] = ['wisdom', 'greed', 'fortune', 'might', 'vigor', 'discovery'];

export const ELIXIRS: Record<ElixirId, { stats: StatBlock; frame: number }> = {
  wisdom: { stats: { xpBonus: 50 }, frame: 6 },
  greed: { stats: { goldFind: 50 }, frame: 7 },
  fortune: { stats: { magicFind: 40 }, frame: 8 },
  might: { stats: { attackPct: 25 }, frame: 9 },
  vigor: { stats: { maxHpPct: 25 }, frame: 10 },
  discovery: { stats: { chestChance: 50 }, frame: 11 },
};

export const ELIXIR_ATLAS = 'icons-uniques-2';
/** One drink lasts this long; more drinks of the same elixir add up to the cap. */
export const ELIXIR_MS = 30 * 60_000;
export const ELIXIR_MAX_MS = 4 * 3_600_000;

/** Stats of the elixirs still active at `now`. */
export function elixirStats(active: Partial<Record<ElixirId, string>> | undefined, now: number): StatBlock {
  return addStats(...(Object.entries(active ?? {}) as Array<[ElixirId, string]>)
    .filter(([elixirId, until]) => ELIXIRS[elixirId] && Date.parse(until) > now)
    .map(([elixirId]) => ELIXIRS[elixirId].stats));
}

/** When an elixir drunk now runs out, given when the same elixir was due to run out. */
export function elixirUntil(current: string | undefined, now: number): string {
  const from = Math.max(now, current ? Date.parse(current) || 0 : 0);
  return new Date(Math.min(from + ELIXIR_MS, now + ELIXIR_MAX_MS)).toISOString();
}
