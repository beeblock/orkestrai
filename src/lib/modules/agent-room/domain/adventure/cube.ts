import type { HeroClassId } from './catalog.js';
import {
  MATERIALS,
  RARITIES,
  RARITY_RULES,
  itemGoldValue,
  rarityIndex,
  rollItem,
  type ItemData,
  type MaterialId,
  type Rarity,
  type Rng,
  type Slot,
  type SocketKind,
} from './items.js';
import { rollRarity, COINS_PER_OFFERING } from './loot.js';
import { power, type Difficulty } from './world.js';

/**
 * The Orchestrion Cube: the party's crafting table. It levels up with use
 * and each level opens another function — synthesis (nine items of one
 * rarity become one of a higher rarity), alchemy (gear into gold), crafting
 * (a new item of a chosen slot), socketing materials, fusing gems into a
 * finer cut, removing them and the offering of commemorative coins.
 */

export type CubeFunction = 'synthesis' | 'alchemy' | 'decoration' | 'fusion' | 'crafting' | 'removal' | 'engraving' | 'offering' | 'inscription';

export const CUBE_UNLOCKS: Record<CubeFunction, number> = {
  synthesis: 1, alchemy: 1, decoration: 1, fusion: 2, crafting: 2, removal: 3, engraving: 4, offering: 5, inscription: 6,
};

export const CUBE_MAX_LEVEL = 10;

export function cubeXpToNext(level: number): number {
  return level >= CUBE_MAX_LEVEL ? Infinity : Math.round(200 * level ** 1.5);
}

export function addCubeXp(cube: { level: number; xp: number }, gained: number): { level: number; xp: number; levelsGained: number } {
  let level = cube.level;
  let xp = cube.xp + gained;
  let levelsGained = 0;
  while (level < CUBE_MAX_LEVEL && xp >= cubeXpToNext(level)) {
    xp -= cubeXpToNext(level);
    level += 1;
    levelsGained += 1;
  }
  return { level, xp: level >= CUBE_MAX_LEVEL ? 0 : xp, levelsGained };
}

export function cubeAllows(level: number, fn: CubeFunction): boolean {
  return level >= CUBE_UNLOCKS[fn];
}

export function socketFunction(kind: SocketKind): CubeFunction {
  return kind === 'decoration' ? 'decoration' : kind === 'engraving' ? 'engraving' : 'inscription';
}

export const SYNTHESIS_INPUTS = 9;

/** Gold the cube charges to synthesize items of a rarity and level. */
export function synthesisCost(rarity: Rarity, level: number): number {
  return Math.round(40 * RARITY_RULES[rarity].worth * power(level) ** 0.3);
}

/** The rarity a synthesis lands on: the next one, sometimes skipping ahead. */
export function synthesisRarity(rng: Rng, input: Rarity, cubeLevel: number): Rarity {
  const index = rarityIndex(input);
  const roll = rng();
  const skipTwo = 0.015 + cubeLevel * 0.002;
  const skipOne = 0.08 + cubeLevel * 0.01;
  const step = roll < skipTwo ? 3 : roll < skipTwo + skipOne ? 2 : 1;
  return RARITIES[Math.min(RARITIES.length - 1, index + step)];
}

export function synthesize(rng: Rng, inputs: ItemData[], cubeLevel: number, partyClasses: HeroClassId[]): ItemData {
  const level = Math.max(...inputs.map((item) => item.level));
  return rollItem(rng, { level, rarity: synthesisRarity(rng, inputs[0].rarity, cubeLevel), partyClasses });
}

export function alchemyGold(items: ItemData[], cubeLevel: number, runeBonus: number): number {
  return items.reduce((sum, item) => sum + itemGoldValue(item, runeBonus + (cubeLevel - 1) * 3), 0);
}

export const CRAFT_GEMS = 2;

export function craftCost(level: number): number {
  return Math.round(150 * power(level) ** 0.6);
}

/** Crafting picks the slot; rarity is rolled like a blue chest, nudged by the cube's level. */
export function craft(rng: Rng, options: { slot: Slot; level: number; classId: HeroClassId | null; cubeLevel: number; magicFind: number; difficulty: Difficulty; partyClasses: HeroClassId[] }): ItemData {
  const rarity = rollRarity(rng, 'blue', options.magicFind + options.cubeLevel * 5, options.difficulty);
  return rollItem(rng, { level: options.level, rarity, slot: options.slot, classId: options.slot === 'weapon' ? options.classId : null, partyClasses: options.partyClasses });
}

export function removalCost(item: Pick<ItemData, 'level'>): number {
  return Math.round(100 * power(item.level) ** 0.4);
}

export function offering(rng: Rng, options: { level: number; magicFind: number; difficulty: Difficulty; partyClasses: HeroClassId[] }): ItemData {
  const rarity = rollRarity(rng, 'red', options.magicFind, options.difficulty);
  return rollItem(rng, { level: options.level, rarity, partyClasses: options.partyClasses });
}

export { COINS_PER_OFFERING };

/** Whether a material can go into a socket of an item. */
export function canSocket(item: ItemData, socketIndex: number, material: MaterialId): 'ok' | 'socket' | 'kind' | 'full' {
  const socket = item.sockets[socketIndex];
  if (!socket) return 'socket';
  if (socket.kind !== MATERIALS[material].socket) return 'kind';
  if (socket.material) return 'full';
  return 'ok';
}

export const CUBE_XP = { synthesis: 40, alchemy: 2, crafting: 35, socket: 15, removal: 10, offering: 60, fusion: 20 } as const;
