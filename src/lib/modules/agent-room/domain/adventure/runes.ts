import { addStats, scaleStats, type StatBlock } from './stats.js';

/**
 * The rune tree: account-wide upgrades bought with gold, in six branches
 * (gold, storage, chests, combat, wisdom and command). Some runes add stats
 * to every hero; others change the rules (more formation slots, a second
 * active skill, richer chests, a bigger inventory...).
 */

export type RuneBranch = 'gold' | 'storage' | 'chests' | 'combat' | 'wisdom' | 'command';
export const RUNE_BRANCHES: RuneBranch[] = ['gold', 'storage', 'chests', 'combat', 'wisdom', 'command'];

export type RuneRule =
  | 'alchemy' | 'inventory' | 'stash' | 'white-bonus' | 'blue-bonus' | 'blue-chance' | 'chest-capacity'
  | 'mentorship' | 'offline' | 'formation' | 'active-slot' | 'revive';

export type Rune = {
  id: string;
  branch: RuneBranch;
  costs: number[];
  requires?: [runeId: string, rank: number];
  /** Per rank, for every hero. */
  stats?: StatBlock;
  /** Per rank, a rule change. */
  rule?: [RuneRule, number];
};

export const RUNES: Rune[] = [
  { id: 'greed', branch: 'gold', costs: [2_000, 6_000, 15_000, 40_000, 100_000], stats: { goldFind: 10 } },
  { id: 'alchemy', branch: 'gold', costs: [20_000, 80_000, 300_000], requires: ['greed', 2], rule: ['alchemy', 20] },
  { id: 'fortune', branch: 'gold', costs: [250_000, 600_000, 1_200_000, 2_500_000, 5_000_000], requires: ['greed', 5], stats: { goldFind: 15 } },
  { id: 'pockets', branch: 'storage', costs: [3_000, 10_000, 30_000, 90_000, 250_000], rule: ['inventory', 10] },
  { id: 'vaults', branch: 'storage', costs: [20_000, 150_000, 1_000_000, 5_000_000, 20_000_000], requires: ['pockets', 1], rule: ['stash', 1] },
  { id: 'unsealing', branch: 'storage', costs: [25_000], requires: ['pockets', 2], rule: ['white-bonus', 1] },
  { id: 'locksmith', branch: 'storage', costs: [200_000], requires: ['unsealing', 1], rule: ['blue-bonus', 1] },
  { id: 'haste', branch: 'storage', costs: [40_000, 150_000, 500_000, 1_500_000], requires: ['pockets', 3], stats: { cooldownReduction: 4 } },
  { id: 'discovery', branch: 'chests', costs: [4_000, 12_000, 35_000, 100_000, 300_000], stats: { chestChance: 15 } },
  { id: 'hoarding', branch: 'chests', costs: [10_000, 40_000, 120_000, 400_000, 1_200_000], requires: ['discovery', 1], rule: ['chest-capacity', 10] },
  { id: 'plunder', branch: 'chests', costs: [30_000, 90_000, 250_000, 700_000, 2_000_000], requires: ['discovery', 2], rule: ['blue-chance', 10] },
  { id: 'insight', branch: 'chests', costs: [60_000, 180_000, 500_000, 1_500_000, 4_000_000], requires: ['plunder', 1], stats: { magicFind: 8 } },
  { id: 'might', branch: 'combat', costs: [3_000, 9_000, 25_000, 70_000, 200_000], stats: { attackPct: 5 } },
  { id: 'iron', branch: 'combat', costs: [3_000, 9_000, 25_000, 70_000, 200_000], stats: { armorPct: 6 } },
  { id: 'vigor', branch: 'combat', costs: [8_000, 24_000, 70_000, 200_000, 600_000], requires: ['iron', 1], stats: { maxHpPct: 6 } },
  { id: 'swiftness', branch: 'combat', costs: [20_000, 60_000, 180_000, 500_000, 1_500_000], requires: ['might', 2], stats: { attackSpeed: 3 } },
  { id: 'precision', branch: 'combat', costs: [30_000, 90_000, 270_000, 800_000, 2_400_000], requires: ['might', 3], stats: { critChance: 2 } },
  { id: 'learning', branch: 'wisdom', costs: [3_000, 9_000, 25_000, 70_000, 200_000], stats: { xpBonus: 8 } },
  { id: 'respite', branch: 'wisdom', costs: [15_000, 50_000, 150_000, 450_000, 1_300_000], requires: ['learning', 1], rule: ['offline', 10] },
  { id: 'mentorship', branch: 'wisdom', costs: [40_000, 160_000, 600_000], requires: ['learning', 2], rule: ['mentorship', 20] },
  { id: 'command', branch: 'command', costs: [20_000, 150_000, 1_500_000, 5_000_000, 15_000_000], rule: ['formation', 1] },
  { id: 'mastery', branch: 'command', costs: [50_000], requires: ['command', 1], rule: ['active-slot', 1] },
  { id: 'rebirth', branch: 'command', costs: [15_000, 75_000, 300_000], requires: ['command', 1], rule: ['revive', 15] },
];

export const RUNES_BY_ID: Record<string, Rune> = Object.fromEntries(RUNES.map((rune) => [rune.id, rune]));

export type RuneRanks = Record<string, number>;

export function runeCost(runeId: string, ranks: RuneRanks): number | null {
  const rune = RUNES_BY_ID[runeId];
  if (!rune) return null;
  const rank = ranks[runeId] ?? 0;
  return rank < rune.costs.length ? rune.costs[rank] : null;
}

export function canBuyRune(runeId: string, ranks: RuneRanks, gold: number): 'ok' | 'unknown' | 'max' | 'locked' | 'gold' {
  const rune = RUNES_BY_ID[runeId];
  if (!rune) return 'unknown';
  const cost = runeCost(runeId, ranks);
  if (cost === null) return 'max';
  if (rune.requires && (ranks[rune.requires[0]] ?? 0) < rune.requires[1]) return 'locked';
  if (gold < cost) return 'gold';
  return 'ok';
}

export function runeStats(ranks: RuneRanks): StatBlock {
  return addStats(...RUNES.filter((rune) => rune.stats && ranks[rune.id]).map((rune) => scaleStats(rune.stats!, ranks[rune.id])));
}

/** Sum of a rule's value over the owned ranks. */
export function runeRule(ranks: RuneRanks, rule: RuneRule): number {
  return RUNES.filter((rune) => rune.rule?.[0] === rule).reduce((sum, rune) => sum + (ranks[rune.id] ?? 0) * rune.rule![1], 0);
}

export const BASE_FORMATION_SLOTS = 3;
export const BASE_INVENTORY_SLOTS = 40;
export const STASH_TAB_SLOTS = 50;

export function formationSlots(ranks: RuneRanks): number {
  return BASE_FORMATION_SLOTS + runeRule(ranks, 'formation');
}

export function activeSlots(ranks: RuneRanks): number {
  return 1 + runeRule(ranks, 'active-slot');
}

export function inventorySlots(ranks: RuneRanks): number {
  return BASE_INVENTORY_SLOTS + runeRule(ranks, 'inventory');
}

export function stashSlots(ranks: RuneRanks): number {
  return STASH_TAB_SLOTS * (1 + runeRule(ranks, 'stash'));
}
