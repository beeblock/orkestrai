import { BIOMES, MONSTERS, type Biome, type MonsterId } from './catalog.js';

/**
 * The Adventure's map: five acts (one per biome) of ten stages, played on four
 * difficulties. Every stage has a region level that sets how strong its
 * monsters are and how good the loot that drops there is.
 */

export type Difficulty = 'normal' | 'nightmare' | 'hell' | 'torment';

export const DIFFICULTIES: Difficulty[] = ['normal', 'nightmare', 'hell', 'torment'];

export type DifficultyRules = {
  /** Added to the region level of every stage. */
  levelOffset: number;
  hp: number;
  damage: number;
  /** Shifts loot rarity upwards (tiers of luck). */
  rarityBoost: number;
  gold: number;
};

export const DIFFICULTY_RULES: Record<Difficulty, DifficultyRules> = {
  normal: { levelOffset: 0, hp: 1, damage: 1, rarityBoost: 0, gold: 1 },
  nightmare: { levelOffset: 25, hp: 1.2, damage: 1.15, rarityBoost: 1, gold: 1.5 },
  hell: { levelOffset: 50, hp: 1.45, damage: 1.3, rarityBoost: 2, gold: 2.2 },
  torment: { levelOffset: 60, hp: 1.8, damage: 1.5, rarityBoost: 3, gold: 3.2 },
};

export const ACT_COUNT = BIOMES.length;
export const STAGES_PER_ACT = 10;
export const WAVES_PER_STAGE = 5;
/** Stages of one difficulty, from 0 (act 1, stage 1) to 49 (act 5, stage 10). */
export const STAGE_COUNT = ACT_COUNT * STAGES_PER_ACT;
export const MAX_HERO_LEVEL = 100;
/** Highest region (and item) level: the last stage of Torment. */
export const MAX_REGION_LEVEL = DIFFICULTY_RULES.torment.levelOffset + STAGE_COUNT;

export type StagePosition = { difficulty: Difficulty; act: number; stage: number };

/** Highest stage cleared on each difficulty (index 0..49), -1 when none. */
export type ClearedStages = Record<Difficulty, number>;

export const NO_CLEARS: ClearedStages = { normal: -1, nightmare: -1, hell: -1, torment: -1 };

export const START_POSITION: StagePosition = { difficulty: 'normal', act: 1, stage: 1 };

export function stageIndex(position: Pick<StagePosition, 'act' | 'stage'>): number {
  return (position.act - 1) * STAGES_PER_ACT + (position.stage - 1);
}

export function positionAt(difficulty: Difficulty, index: number): StagePosition {
  const clamped = Math.max(0, Math.min(STAGE_COUNT - 1, Math.floor(index)));
  return { difficulty, act: Math.floor(clamped / STAGES_PER_ACT) + 1, stage: (clamped % STAGES_PER_ACT) + 1 };
}

export function biomeOf(position: Pick<StagePosition, 'act'>): Biome {
  return BIOMES[Math.max(0, Math.min(ACT_COUNT - 1, position.act - 1))];
}

export function regionLevel(position: StagePosition): number {
  return DIFFICULTY_RULES[position.difficulty].levelOffset + stageIndex(position) + 1;
}

/** The act's boss waits on the last stage; every other stage ends with an elite. */
export function isActBossStage(position: Pick<StagePosition, 'stage'>): boolean {
  return position.stage === STAGES_PER_ACT;
}

/** A difficulty opens once the previous one is beaten to the last boss. */
export function difficultyUnlocked(cleared: ClearedStages, difficulty: Difficulty): boolean {
  const index = DIFFICULTIES.indexOf(difficulty);
  return index <= 0 || cleared[DIFFICULTIES[index - 1]] >= STAGE_COUNT - 1;
}

/** Stages open one after another; the portal reaches any of them. */
export function stageUnlocked(cleared: ClearedStages, position: StagePosition): boolean {
  if (!difficultyUnlocked(cleared, position.difficulty)) return false;
  return stageIndex(position) <= cleared[position.difficulty] + 1;
}

/** The stage after this one, or null at the end of a difficulty. */
export function nextPosition(position: StagePosition): StagePosition | null {
  const index = stageIndex(position);
  return index + 1 < STAGE_COUNT ? positionAt(position.difficulty, index + 1) : null;
}

/** Where an advancing party goes: the next stage, past the last boss the next difficulty's first stage, null after Torment. */
export function advancePosition(position: StagePosition): StagePosition | null {
  const following = DIFFICULTIES[DIFFICULTIES.indexOf(position.difficulty) + 1];
  return nextPosition(position) ?? (following ? positionAt(following, 0) : null);
}

export function previousPosition(position: StagePosition): StagePosition {
  return positionAt(position.difficulty, stageIndex(position) - 1);
}

/** The farthest stage reached on any difficulty, as a region level (drives crafting and offerings). */
export function highestRegionLevel(cleared: ClearedStages): number {
  let best = 1;
  for (const difficulty of DIFFICULTIES) {
    if (cleared[difficulty] < 0) continue;
    best = Math.max(best, regionLevel(positionAt(difficulty, Math.min(STAGE_COUNT - 1, cleared[difficulty] + 1))));
  }
  return best;
}

/**
 * The power curve everything scales on: monsters' health, gear's numbers and
 * the experience a kill gives grow ~5.5% per level (×200 at level 100).
 */
export function power(level: number): number {
  return 1.055 ** (Math.max(1, level) - 1);
}

export type MonsterStats = { hp: number; damage: number; xp: number; gold: number };

// The bestiary's numbers are relative; these bring them to the heroes' scale.
const MONSTER_HP = 3.5;
const MONSTER_DAMAGE = 4;

/** A monster at a region level; elites (the end of a stage) are much tougher. */
export function monsterStats(monsterId: MonsterId, level: number, difficulty: Difficulty, elite = false): MonsterStats {
  const monster = MONSTERS[monsterId];
  const rules = DIFFICULTY_RULES[difficulty];
  const scale = power(level);
  // The first levels are gentler, so a new hero in starter gear finds its feet.
  const early = Math.min(1, 0.45 + level * 0.05);
  const eliteHp = elite ? 3.2 : 1;
  const eliteReward = elite ? 4 : 1;
  return {
    hp: Math.round(monster.hp * MONSTER_HP * scale * rules.hp * eliteHp * early),
    damage: Math.max(1, Math.round(monster.damage * MONSTER_DAMAGE * scale ** 0.9 * rules.damage * (elite ? 1.4 : 1) * early)),
    xp: Math.max(1, Math.round(monster.xp * xpUnit(level) * eliteReward)),
    gold: Math.max(1, Math.round(monster.gold * scale ** 0.7 * rules.gold * eliteReward)),
  };
}

/** Experience scale of a level: what an average monster of that level gives. */
export function xpUnit(level: number): number {
  return power(level) ** 0.8;
}

/** Experience from `level` to the next: about 40 + 6L + 0.12L² average kills. */
export function xpToNext(level: number): number {
  if (level >= MAX_HERO_LEVEL) return Infinity;
  return Math.round(8 * xpUnit(level) * (40 + 6 * level + 0.12 * level * level));
}

/**
 * Heroes learn best from monsters near their own level: a few levels above
 * pays a bonus, far above or below pays little.
 */
export function xpGapFactor(heroLevel: number, monsterLevel: number): number {
  const gap = monsterLevel - heroLevel;
  if (gap >= 0) return gap <= 5 ? 1 + gap * 0.06 : Math.max(0.1, 1.3 - (gap - 5) * 0.1);
  return Math.max(0.05, 1 + gap * 0.09);
}

/**
 * Past the max level experience keeps counting as Paragon levels: endless,
 * each a little longer than the last, each worth +1% attack and +1% life.
 */
export function paragonXpToNext(paragon: number): number {
  return Math.round(xpToNext(MAX_HERO_LEVEL - 1) * (1 + 0.04 * Math.max(0, paragon)));
}

/** Level, Paragon and progress after adding experience. */
export function addXp(level: number, xp: number, gained: number, paragon = 0): { level: number; xp: number; paragon: number; levelsGained: number; paragonGained: number } {
  let currentLevel = Math.max(1, Math.min(MAX_HERO_LEVEL, Math.floor(level)));
  let currentParagon = Math.max(0, Math.floor(paragon));
  let current = Math.max(0, xp) + Math.max(0, gained);
  let levelsGained = 0;
  let paragonGained = 0;
  while (currentLevel < MAX_HERO_LEVEL && current >= xpToNext(currentLevel)) {
    current -= xpToNext(currentLevel);
    currentLevel += 1;
    levelsGained += 1;
  }
  while (currentLevel >= MAX_HERO_LEVEL && current >= paragonXpToNext(currentParagon)) {
    current -= paragonXpToNext(currentParagon);
    currentParagon += 1;
    paragonGained += 1;
  }
  return { level: currentLevel, xp: Math.floor(current), paragon: currentParagon, levelsGained, paragonGained };
}
