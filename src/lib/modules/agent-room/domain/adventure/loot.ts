import type { HeroClassId } from './catalog.js';
import { ELIXIR_IDS, SET_IDS, SETS, UNIQUE_IDS, UNIQUES, type ElixirId, type SetId, type UniqueId } from './artifacts.js';
import { MATERIAL_IDS, MATERIALS, RARITIES, gemQualityFor, isGem, materialKey, rarityIndex, rollItem, type ItemData, type MaterialId, type Rarity, type Rng } from './items.js';
import { DIFFICULTIES, DIFFICULTY_RULES, MAX_REGION_LEVEL, power, type Difficulty } from './world.js';

/**
 * Chests are where gear comes from. White ones drop from any monster, blue
 * ones from the elite closing a stage, red ones from act bosses (opening a
 * red chest after the first costs a soulstone of that difficulty or a harder
 * one), and a golden quest chest arrives for every Kanban card the team
 * finishes.
 */

export type ChestTier = 'white' | 'blue' | 'red' | 'quest';
export const CHEST_TIERS: ChestTier[] = ['white', 'blue', 'red', 'quest'];

/** Base chance per monster kill of a white chest. */
export const WHITE_CHEST_CHANCE = 0.015;
/** Base chance the elite at the end of a stage leaves a blue chest. */
export const BLUE_CHEST_CHANCE = 0.3;
/** Unopened chests kept before new ones are lost: red ones apart, up to as many as the rest. */
export const BASE_CHEST_CAPACITY = 20;
export const COINS_PER_OFFERING = 5;

const RARITY_WEIGHTS: Record<ChestTier, number[]> = {
  //          common uncommon rare epic legendary immortal arcana mythic cosmic
  white: [600, 280, 90, 25, 4.5, 0.4, 0.08, 0.015, 0.003],
  blue: [250, 330, 260, 110, 38, 9, 2, 0.5, 0.1],
  quest: [200, 320, 280, 130, 50, 12, 3, 0.7, 0.15],
  red: [0, 0, 300, 380, 220, 70, 22, 6, 1.5],
};

const ITEMS_PER_CHEST: Record<ChestTier, number> = { white: 1, blue: 2, quest: 2, red: 3 };

/**
 * Rarity of one drop. Magic find and harder difficulties tilt the odds
 * towards the rarer tiers; the commonest tiers never disappear entirely.
 */
export function rollRarity(rng: Rng, tier: ChestTier, magicFind: number, difficulty: Difficulty): Rarity {
  const boost = DIFFICULTY_RULES[difficulty].rarityBoost;
  const luck = 1 + Math.max(0, magicFind) / 100;
  const weights = RARITY_WEIGHTS[tier].map((weight, index) => (index >= 2 ? weight * luck ** (index * 0.35) * (1 + 0.6 * boost) ** (index / 2) : weight));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let pick = rng() * total;
  for (let index = 0; index < weights.length; index += 1) {
    pick -= weights[index];
    if (pick <= 0) return RARITIES[index];
  }
  return RARITIES[0];
}

export type ChestContext = {
  tier: ChestTier;
  /** Region level where the chest dropped. */
  level: number;
  difficulty: Difficulty;
  act: number;
  magicFind: number;
  goldMultiplier: number;
  partyClasses: HeroClassId[];
  /** Items added by runes (Unsealing for white chests, Locksmith for blue ones). */
  bonusItems?: number;
};

export type ChestContents = {
  items: ItemData[];
  gold: number;
  /** By material key (see `materialKey`): gems carry their quality. */
  materials: Record<string, number>;
  elixirs: Partial<Record<ElixirId, number>>;
  soulstones: number;
  coins: number;
};

/** Chance a red chest holds its act boss's unique (one of three), by difficulty. */
export const UNIQUE_CHANCE: Record<Difficulty, number> = { normal: 0.06, nightmare: 0.09, hell: 0.12, torment: 0.16 };
/** Chance a red chest on Hell or Torment holds one of the wandering uniques. */
export const WORLD_UNIQUE_CHANCE = 0.04;
/** Chance per item of a set piece, by chest, from region level 25. */
export const SET_CHANCE: Record<ChestTier, number> = { white: 0, blue: 0.015, quest: 0.03, red: 0.05 };
export const SET_MIN_LEVEL = 25;

function pick<T>(rng: Rng, list: readonly T[]): T {
  return list[Math.floor(rng() * list.length)];
}

/** Uniques and set pieces are at least Legendary and Epic. */
function atLeast(rarity: Rarity, floor: Rarity): Rarity {
  return rarityIndex(rarity) >= rarityIndex(floor) ? rarity : floor;
}

/** The unique a red chest holds, if any: the act boss's own, or on Hell and Torment a wandering one. */
export function rollUnique(rng: Rng, context: Pick<ChestContext, 'act' | 'difficulty' | 'magicFind'>): UniqueId | null {
  const luck = 1 + Math.max(0, context.magicFind) / 400;
  if (rng() < UNIQUE_CHANCE[context.difficulty] * luck) {
    const own = UNIQUE_IDS.filter((uniqueId) => UNIQUES[uniqueId].act === context.act);
    if (own.length) return pick(rng, own);
  }
  const late = DIFFICULTIES.indexOf(context.difficulty) >= DIFFICULTIES.indexOf('hell');
  if (late && rng() < WORLD_UNIQUE_CHANCE * luck) return pick(rng, UNIQUE_IDS.filter((uniqueId) => UNIQUES[uniqueId].act === null));
  return null;
}

/** A set for a drop: three times in four one of the party's classes. */
function pickSet(rng: Rng, partyClasses: HeroClassId[]): SetId {
  const own = SET_IDS.filter((setId) => partyClasses.includes(SETS[setId].classId));
  return own.length && rng() < 0.75 ? pick(rng, own) : pick(rng, SET_IDS);
}

function pickMaterial(rng: Rng, kinds: Array<'decoration' | 'engraving' | 'inscription'>): MaterialId {
  const pool = MATERIAL_IDS.filter((id) => kinds.includes(MATERIALS[id].socket));
  return pool[Math.floor(rng() * pool.length)];
}

export function openChest(rng: Rng, context: ChestContext): ChestContents {
  const contents: ChestContents = { items: [], gold: 0, materials: {}, elixirs: {}, soulstones: 0, coins: 0 };
  const extra = (context.tier === 'red' && (context.difficulty === 'hell' || context.difficulty === 'torment') ? 1 : 0) + (context.bonusItems ?? 0);
  const itemLevel = () => Math.max(1, Math.min(MAX_REGION_LEVEL, context.level + Math.floor(rng() * 4) - 2));
  for (let index = 0; index < ITEMS_PER_CHEST[context.tier] + extra; index += 1) {
    const rarity = rollRarity(rng, context.tier, context.magicFind, context.difficulty);
    const level = itemLevel();
    if (context.level >= SET_MIN_LEVEL && rng() < SET_CHANCE[context.tier]) {
      contents.items.push(rollItem(rng, { level, rarity: atLeast(rarity, 'epic'), setId: pickSet(rng, context.partyClasses), partyClasses: context.partyClasses }));
    } else {
      contents.items.push(rollItem(rng, { level, rarity, partyClasses: context.partyClasses }));
    }
  }
  if (context.tier === 'red') {
    const uniqueId = rollUnique(rng, context);
    if (uniqueId) contents.items.push(rollItem(rng, { level: itemLevel(), rarity: atLeast(rollRarity(rng, 'red', context.magicFind, context.difficulty), 'legendary'), uniqueId }));
  }
  const goldBase = { white: 25, blue: 90, quest: 120, red: 400 }[context.tier];
  if (context.tier !== 'white' || rng() < 0.35) {
    contents.gold = Math.round(goldBase * power(context.level) ** 0.7 * DIFFICULTY_RULES[context.difficulty].gold * context.goldMultiplier * (0.7 + rng() * 0.6));
  }
  const addMaterial = (id: MaterialId) => {
    const key = isGem(id) ? materialKey(id, gemQualityFor(rng, context.level)) : materialKey(id);
    contents.materials[key] = (contents.materials[key] ?? 0) + 1;
  };
  const addElixir = () => { const elixirId = pick(rng, ELIXIR_IDS); contents.elixirs[elixirId] = (contents.elixirs[elixirId] ?? 0) + 1; };
  // Elixirs: one in every quest chest, often in red ones, now and then elsewhere.
  if (context.tier === 'quest' || (context.tier === 'red' && rng() < 0.6) || (context.tier === 'blue' && rng() < 0.12) || (context.tier === 'white' && rng() < 0.01)) addElixir();
  if (context.tier === 'white' && rng() < 0.08) addMaterial(pickMaterial(rng, ['decoration']));
  if (context.tier === 'blue' || context.tier === 'quest') {
    if (rng() < 0.45) addMaterial(pickMaterial(rng, ['decoration']));
    if (rng() < 0.06) addMaterial(pickMaterial(rng, ['engraving', 'inscription']));
    if (context.act >= 2 && rng() < 0.05) contents.soulstones += 1;
  }
  if (context.tier === 'red') {
    addMaterial(pickMaterial(rng, ['decoration']));
    if (rng() < 0.5) addMaterial(pickMaterial(rng, ['decoration']));
    if (rng() < 0.3) addMaterial(pickMaterial(rng, ['engraving']));
    if (rng() < 0.15) addMaterial(pickMaterial(rng, ['inscription']));
    if (rng() < (context.act >= 2 ? 0.35 : 0.2)) contents.soulstones += 1;
    contents.coins += 1;
  }
  if (context.tier === 'quest') contents.coins += 1;
  return contents;
}
