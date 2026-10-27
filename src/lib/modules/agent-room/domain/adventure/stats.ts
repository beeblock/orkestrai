import { HERO_CLASSES, type HeroClassId } from './catalog.js';

/**
 * Hero statistics. Flat stats add (attack, armor, maxHp, hpRegen); every
 * other stat is a percentage (12 = +12%). Items, sockets, skills, runes and
 * pets all produce stat blocks that simply add up.
 */
export type StatId =
  | 'attack' | 'attackPct'
  | 'armor' | 'armorPct'
  | 'maxHp' | 'maxHpPct'
  | 'attackSpeed'
  | 'critChance' | 'critDamage'
  | 'cooldownReduction' | 'skillDamage' | 'bossDamage'
  | 'damageReduction' | 'hpRegen' | 'lifeSteal'
  | 'goldFind' | 'magicFind' | 'xpBonus' | 'chestChance';

export const STAT_IDS: StatId[] = [
  'attack', 'attackPct', 'armor', 'armorPct', 'maxHp', 'maxHpPct', 'attackSpeed', 'critChance', 'critDamage',
  'cooldownReduction', 'skillDamage', 'bossDamage', 'damageReduction', 'hpRegen', 'lifeSteal',
  'goldFind', 'magicFind', 'xpBonus', 'chestChance',
];

/** Stats shown as a plain number; all others are percentages. */
export const FLAT_STATS = new Set<StatId>(['attack', 'armor', 'maxHp', 'hpRegen']);

export type StatBlock = Partial<Record<StatId, number>>;

export function addStats(...blocks: StatBlock[]): StatBlock {
  const total: StatBlock = {};
  for (const block of blocks) {
    for (const [stat, value] of Object.entries(block) as Array<[StatId, number]>) {
      if (!value) continue;
      total[stat] = (total[stat] ?? 0) + value;
    }
  }
  return total;
}

export function scaleStats(block: StatBlock, factor: number): StatBlock {
  const scaled: StatBlock = {};
  for (const [stat, value] of Object.entries(block) as Array<[StatId, number]>) scaled[stat] = value * factor;
  return scaled;
}

type ClassBase = { hp: number; armor: number; critChance: number };

const CLASS_BASE: Record<HeroClassId, ClassBase> = {
  knight: { hp: 170, armor: 12, critChance: 5 },
  artificer: { hp: 115, armor: 7, critChance: 6 },
  ranger: { hp: 105, armor: 6, critChance: 9 },
  sorceress: { hp: 95, armor: 4, critChance: 7 },
  cleric: { hp: 125, armor: 8, critChance: 5 },
  maestro: { hp: 115, armor: 7, critChance: 6 },
};

/** What a naked hero of a class and level has before gear, skills and runes. */
export function heroBaseStats(classId: HeroClassId, level: number): StatBlock {
  const base = CLASS_BASE[classId];
  const steps = Math.max(0, level - 1);
  return {
    attack: HERO_CLASSES[classId].damage * (1 + 0.035 * steps),
    maxHp: base.hp * (1 + 0.06 * steps),
    armor: base.armor + 1.2 * steps,
    critChance: base.critChance,
    critDamage: 50,
  };
}

/**
 * What the battle needs from a hero, already resolved: damage per hit, swing
 * time, survival numbers and the account-wide finds it brings along.
 */
export type CombatProfile = {
  attack: number;
  attackMs: number;
  critChance: number;
  critMultiplier: number;
  maxHp: number;
  armor: number;
  damageReduction: number;
  hpRegen: number;
  lifeSteal: number;
  cooldownMultiplier: number;
  skillMultiplier: number;
  bossMultiplier: number;
  goldMultiplier: number;
  magicFind: number;
  xpMultiplier: number;
  chestMultiplier: number;
};

export function combatProfile(classId: HeroClassId, stats: StatBlock): CombatProfile {
  const value = (stat: StatId) => stats[stat] ?? 0;
  return {
    attack: Math.max(1, value('attack') * (1 + value('attackPct') / 100)),
    attackMs: Math.max(250, HERO_CLASSES[classId].attackMs / (1 + value('attackSpeed') / 100)),
    critChance: Math.min(0.75, value('critChance') / 100),
    critMultiplier: 1 + value('critDamage') / 100,
    maxHp: Math.max(1, value('maxHp') * (1 + value('maxHpPct') / 100)),
    armor: Math.max(0, value('armor') * (1 + value('armorPct') / 100)),
    damageReduction: Math.min(0.6, value('damageReduction') / 100),
    hpRegen: value('hpRegen'),
    lifeSteal: Math.min(0.25, value('lifeSteal') / 100),
    cooldownMultiplier: Math.max(0.4, 1 - value('cooldownReduction') / 100),
    skillMultiplier: 1 + value('skillDamage') / 100,
    bossMultiplier: 1 + value('bossDamage') / 100,
    goldMultiplier: 1 + value('goldFind') / 100,
    magicFind: value('magicFind'),
    xpMultiplier: 1 + value('xpBonus') / 100,
    chestMultiplier: 1 + value('chestChance') / 100,
  };
}

/** Share of a monster's hit that armor stops, against a monster of `level`. */
export function armorMitigation(armor: number, monsterPower: number): number {
  return Math.min(0.75, armor / (armor + 30 * monsterPower + 60));
}

/** One number to compare heroes: damage per second times how long they last. */
export function heroRating(profile: CombatProfile): number {
  const dps = (profile.attack * (1 + profile.critChance * (profile.critMultiplier - 1))) / (profile.attackMs / 1000);
  const toughness = profile.maxHp / (1 - Math.min(0.9, profile.damageReduction + armorMitigation(profile.armor, 1) * 0.5));
  return Math.round(Math.sqrt(dps * toughness));
}
