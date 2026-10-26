import type { HeroClassId } from './catalog.js';
import { itemStats, rarityIndex, type Item, type Rarity, type Slot } from './items.js';
import { petStats, type KillCounts } from './pets.js';
import { activeSlots, runeStats, type RuneRanks } from './runes.js';
import { auraStats, learnedActives, passiveStats, pointsSpent, skillPointsAt, slottedActives, type LearnedActive, type SkillRanks } from './skills.js';
import { addStats, combatProfile, heroBaseStats, heroRating, type CombatProfile, type StatBlock } from './stats.js';
import { MAX_HERO_LEVEL, paragonXpToNext, xpToNext } from './world.js';

/**
 * A hero's final numbers: its class and level, every equipped item, its own
 * passives, the formation's auras, the account's runes and the tamed pets.
 * Also how it looks: the gear it wears decides its outfit tier on screen.
 */

export type VisualTier = 1 | 2 | 3 | 4;

export type HeroBuild = {
  heroId: string;
  classId: HeroClassId;
  level: number;
  paragon: number;
  xp: number;
  /** Experience to the next level, or to the next Paragon level at the max. */
  xpToNext: number;
  skillPoints: number;
  pointsSpent: number;
  stats: StatBlock;
  profile: CombatProfile;
  rating: number;
  /** Novice, adept, heroic or celestial outfit. */
  visualTier: VisualTier;
  /** Rarity of the weapon, for its glow. */
  weaponRarity: Rarity | null;
  actives: LearnedActive[];
  learned: LearnedActive[];
  deployed: boolean;
};

const OUTFIT_SLOTS: Slot[] = ['weapon', 'helmet', 'armor', 'gloves', 'boots'];

/**
 * The outfit follows the gear: the average rarity over weapon and the four
 * armor pieces (an empty slot counts as common). Commons and uncommons look
 * novice, rares and epics adept, legendaries and immortals heroic, and
 * arcana and beyond celestial.
 */
export function visualTier(equipped: Item[]): VisualTier {
  const average = OUTFIT_SLOTS.reduce((sum, slot) => {
    const item = equipped.find((candidate) => candidate.slot === slot);
    return sum + (item ? rarityIndex(item.rarity) : 0);
  }, 0) / OUTFIT_SLOTS.length;
  if (average >= 5.5) return 4;
  if (average >= 3.5) return 3;
  if (average >= 1.5) return 2;
  return 1;
}

export type BuildInput = {
  heroId: string;
  classId: HeroClassId;
  level: number;
  paragon?: number;
  xp: number;
  skills: SkillRanks;
  actives: string[];
  deployed: boolean;
};

/**
 * Builds every hero at once, since auras from the deployed heroes reach
 * the whole formation.
 */
export function buildHeroes(heroes: BuildInput[], items: Item[], runes: RuneRanks, kills: KillCounts): Record<string, HeroBuild> {
  const account = addStats(runeStats(runes), petStats(kills));
  const auras = addStats(...heroes.filter((hero) => hero.deployed).map((hero) => auraStats(hero.classId, hero.skills)));
  const slots = activeSlots(runes);
  const builds: Record<string, HeroBuild> = {};
  for (const hero of heroes) {
    const equipped = items.filter((item) => item.location === 'equipped' && item.heroId === hero.heroId);
    const stats = addStats(
      heroBaseStats(hero.classId, hero.level),
      { attackPct: hero.paragon ?? 0, maxHpPct: hero.paragon ?? 0 },
      passiveStats(hero.classId, hero.skills),
      ...equipped.map(itemStats),
      account,
      hero.deployed ? auras : auraStats(hero.classId, hero.skills),
    );
    const profile = combatProfile(hero.classId, stats);
    const weapon = equipped.find((item) => item.slot === 'weapon');
    builds[hero.heroId] = {
      heroId: hero.heroId,
      classId: hero.classId,
      level: hero.level,
      paragon: hero.paragon ?? 0,
      xp: hero.xp,
      xpToNext: hero.level >= MAX_HERO_LEVEL ? paragonXpToNext(hero.paragon ?? 0) : xpToNext(hero.level),
      skillPoints: skillPointsAt(hero.level),
      pointsSpent: pointsSpent(hero.skills),
      stats,
      profile,
      rating: heroRating(profile),
      visualTier: visualTier(equipped),
      weaponRarity: weapon?.rarity ?? null,
      actives: slottedActives(hero.classId, hero.skills, hero.actives, slots),
      learned: learnedActives(hero.classId, hero.skills),
      deployed: hero.deployed,
    };
  }
  return builds;
}

export type FormationCandidate = {
  heroId: string;
  leader: boolean;
  /** Its agent is working right now. */
  working: boolean;
  /** An agent plays it (otherwise it rests in the guild). */
  present: boolean;
  level: number;
};

/**
 * Who fights, up to the formation's slots: the heroes the owner pinned, in
 * order, then the ones whose agents are working, the Maestro, the other
 * agents' heroes, and finally the guild's resting heroes, strongest first —
 * so a lone agent still leads a full party and a team of twenty fields the
 * ones at work.
 */
export function deployHeroes(heroes: FormationCandidate[], pinned: string[], slots: number): string[] {
  const known = new Set(heroes.map((hero) => hero.heroId));
  const chosen = pinned.filter((heroId) => known.has(heroId)).slice(0, slots);
  const rank = (hero: FormationCandidate) => (hero.working ? 3 : 0) + (hero.leader ? 2 : 0) + (hero.present ? 1 : 0);
  const rest = heroes
    .filter((hero) => !chosen.includes(hero.heroId))
    .sort((a, b) => rank(b) - rank(a) || b.level - a.level || a.heroId.localeCompare(b.heroId));
  for (const hero of rest) if (chosen.length < slots) chosen.push(hero.heroId);
  return chosen;
}
