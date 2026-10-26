import type { HeroClassId } from './catalog.js';
import { MATERIAL_IDS, MATERIALS, RARITIES, rollItem, type ItemData, type MaterialId, type Rarity, type Rng } from './items.js';
import { DIFFICULTY_RULES, MAX_REGION_LEVEL, power, type Difficulty } from './world.js';

/**
 * Chests are where gear comes from. White ones drop from any monster, blue
 * ones from the elite closing a stage, red ones from act bosses (opening a
 * red chest after the first costs a soulstone of that difficulty), and a
 * golden quest chest arrives for every Kanban card the team finishes.
 */

export type ChestTier = 'white' | 'blue' | 'red' | 'quest';
export const CHEST_TIERS: ChestTier[] = ['white', 'blue', 'red', 'quest'];

/** Base chance per monster kill of a white chest. */
export const WHITE_CHEST_CHANCE = 0.015;
/** Base chance the elite at the end of a stage leaves a blue chest. */
export const BLUE_CHEST_CHANCE = 0.3;
/** Unopened chests kept before new ones are lost. */
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
};

export type ChestContents = {
  items: ItemData[];
  gold: number;
  materials: Partial<Record<MaterialId, number>>;
  soulstones: number;
  coins: number;
};

function pickMaterial(rng: Rng, kinds: Array<'decoration' | 'engraving' | 'inscription'>): MaterialId {
  const pool = MATERIAL_IDS.filter((id) => kinds.includes(MATERIALS[id].socket));
  return pool[Math.floor(rng() * pool.length)];
}

export function openChest(rng: Rng, context: ChestContext): ChestContents {
  const contents: ChestContents = { items: [], gold: 0, materials: {}, soulstones: 0, coins: 0 };
  const extra = context.tier === 'red' && (context.difficulty === 'hell' || context.difficulty === 'torment') ? 1 : 0;
  for (let index = 0; index < ITEMS_PER_CHEST[context.tier] + extra; index += 1) {
    const rarity = rollRarity(rng, context.tier, context.magicFind, context.difficulty);
    const level = Math.max(1, Math.min(MAX_REGION_LEVEL, context.level + Math.floor(rng() * 4) - 2));
    contents.items.push(rollItem(rng, { level, rarity, partyClasses: context.partyClasses }));
  }
  const goldBase = { white: 25, blue: 90, quest: 120, red: 400 }[context.tier];
  if (context.tier !== 'white' || rng() < 0.35) {
    contents.gold = Math.round(goldBase * power(context.level) ** 0.7 * DIFFICULTY_RULES[context.difficulty].gold * context.goldMultiplier * (0.7 + rng() * 0.6));
  }
  const addMaterial = (id: MaterialId) => { contents.materials[id] = (contents.materials[id] ?? 0) + 1; };
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
