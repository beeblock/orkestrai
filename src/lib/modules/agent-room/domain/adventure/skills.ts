import type { HeroClassId } from './catalog.js';
import { addStats, scaleStats, type StatBlock } from './stats.js';
import { MAX_HERO_LEVEL } from './world.js';

/**
 * Skill trees: eight tiers per class. A tier opens once ten points per
 * previous tier are spent in the tree (the eighth needs 70). Passives raise
 * the hero's own stats, auras raise the whole formation's, and actives are
 * cast in battle from the hero's skill slots. Respec is free.
 */

export type ActiveAction =
  | 'bash' | 'whirlwind' | 'bulwark' | 'earthshatter'
  | 'volley' | 'pierce' | 'arrow-rain'
  | 'meteor' | 'frost-nova' | 'arcane-storm'
  | 'sanctuary' | 'heal' | 'judgment'
  | 'turret' | 'overclock' | 'barrage'
  | 'anthem' | 'crescendo' | 'finale';

export type ActiveSpec = { action: ActiveAction; cooldownMs: number; power: number; powerPerRank: number };

export type SkillNode = {
  id: string;
  classId: HeroClassId;
  tier: number;
  kind: 'passive' | 'aura' | 'active';
  maxRank: number;
  /** Per rank: for the hero (passive) or for every hero in the formation (aura). */
  stats?: StatBlock;
  active?: ActiveSpec;
};

type Spec = [name: string, kind: SkillNode['kind'], maxRank: number, effect: StatBlock | ActiveSpec];
const P = (stats: StatBlock): StatBlock => stats;
const A = (action: ActiveAction, cooldownMs: number, power: number, powerPerRank: number): ActiveSpec => ({ action, cooldownMs, power, powerPerRank });

const TREES: Record<HeroClassId, Spec[][]> = {
  knight: [
    [['drill', 'passive', 5, P({ attackPct: 4 })], ['shield-bash', 'active', 5, A('bash', 7_000, 1.5, 0.25)]],
    [['iron-skin', 'passive', 5, P({ armorPct: 6 })], ['vitality', 'passive', 5, P({ maxHpPct: 5 })], ['rally', 'aura', 5, P({ armorPct: 2 })]],
    [['whirlwind', 'active', 5, A('whirlwind', 9_000, 1.1, 0.2)], ['riposte', 'passive', 5, P({ critChance: 2 })], ['resolve', 'passive', 5, P({ damageReduction: 1.5 })]],
    [['heavy-strikes', 'passive', 5, P({ critDamage: 8 })], ['lionheart', 'passive', 5, P({ lifeSteal: 0.6 })], ['vanguard', 'aura', 5, P({ attackPct: 2.5 })]],
    [['bulwark', 'active', 5, A('bulwark', 18_000, 0.25, 0.04)], ['relentless', 'passive', 5, P({ attackSpeed: 3 })], ['headsman', 'passive', 5, P({ bossDamage: 7 })]],
    [['fortress', 'passive', 5, P({ armorPct: 8 })], ['warlord', 'aura', 5, P({ maxHpPct: 3 })], ['battle-trance', 'passive', 5, P({ skillDamage: 8 })]],
    [['champion', 'passive', 5, P({ attackPct: 7 })], ['indomitable', 'passive', 5, P({ damageReduction: 2 })], ['commander', 'aura', 5, P({ critChance: 1.5 })]],
    [['earthshatter', 'active', 3, A('earthshatter', 20_000, 2.2, 0.6)], ['legend', 'passive', 3, P({ attackPct: 6, maxHpPct: 6 })]],
  ],
  ranger: [
    [['marksmanship', 'passive', 5, P({ attackPct: 4 })], ['volley', 'active', 5, A('volley', 8_000, 1, 0.15)]],
    [['eagle-eye', 'passive', 5, P({ critChance: 2.5 })], ['quick-draw', 'passive', 5, P({ attackSpeed: 3 })], ['hunters-mark', 'aura', 5, P({ critDamage: 4 })]],
    [['pierce', 'active', 5, A('pierce', 7_000, 2.5, 0.4)], ['fleet-foot', 'passive', 5, P({ damageReduction: 1.5 })], ['scavenger', 'passive', 5, P({ goldFind: 6 })]],
    [['deadly-aim', 'passive', 5, P({ critDamage: 10 })], ['wind-runner', 'passive', 5, P({ attackSpeed: 3 })], ['pack-tactics', 'aura', 5, P({ attackSpeed: 2 })]],
    [['trophy-hunter', 'passive', 5, P({ bossDamage: 8 })], ['keen-senses', 'passive', 5, P({ magicFind: 5 })], ['survivalist', 'passive', 5, P({ maxHpPct: 6 })]],
    [['sharpshooter', 'passive', 5, P({ critChance: 2 })], ['tracker', 'aura', 5, P({ xpBonus: 3 })], ['hail', 'passive', 5, P({ skillDamage: 10 })]],
    [['lethality', 'passive', 5, P({ attackPct: 7 })], ['evasion', 'passive', 5, P({ damageReduction: 2 })], ['wild-heart', 'aura', 5, P({ attackPct: 2.5 })]],
    [['arrow-rain', 'active', 3, A('arrow-rain', 16_000, 1.6, 0.4)], ['legend', 'passive', 3, P({ critChance: 3, critDamage: 15 })]],
  ],
  sorceress: [
    [['arcane-focus', 'passive', 5, P({ attackPct: 4 })], ['meteor', 'active', 5, A('meteor', 11_000, 1.4, 0.25)]],
    [['spell-weaving', 'passive', 5, P({ skillDamage: 6 })], ['mana-shield', 'passive', 5, P({ damageReduction: 1.5 })], ['insight', 'aura', 5, P({ cooldownReduction: 1.5 })]],
    [['frost-nova', 'active', 5, A('frost-nova', 10_000, 0.9, 0.15)], ['elemental', 'passive', 5, P({ critDamage: 8 })], ['focus', 'passive', 5, P({ cooldownReduction: 2 })]],
    [['overload', 'passive', 5, P({ skillDamage: 8 })], ['ice-armor', 'passive', 5, P({ armorPct: 8 })], ['wisdom', 'aura', 5, P({ xpBonus: 3 })]],
    [['pyromancy', 'passive', 5, P({ attackPct: 6 })], ['channeling', 'passive', 5, P({ attackSpeed: 3 })], ['arcane-luck', 'passive', 5, P({ magicFind: 6 })]],
    [['spellblade', 'passive', 5, P({ critChance: 2.5 })], ['sage', 'aura', 5, P({ skillDamage: 4 })], ['barrier', 'passive', 5, P({ maxHpPct: 6 })]],
    [['archmage', 'passive', 5, P({ skillDamage: 10 })], ['time-warp', 'passive', 5, P({ cooldownReduction: 2.5 })], ['conflux', 'aura', 5, P({ attackPct: 2.5 })]],
    [['arcane-storm', 'active', 3, A('arcane-storm', 15_000, 0.8, 0.25)], ['legend', 'passive', 3, P({ skillDamage: 15, attackPct: 6 })]],
  ],
  cleric: [
    [['devotion', 'passive', 5, P({ attackPct: 4 })], ['sanctuary', 'active', 5, A('sanctuary', 10_000, 2, 0.4)]],
    [['blessing-of-might', 'aura', 5, P({ attackPct: 2.5 })], ['faith', 'passive', 5, P({ maxHpPct: 5 })], ['grace', 'aura', 5, P({ maxHpPct: 2.5 })]],
    [['healing-light', 'active', 5, A('heal', 9_000, 0.2, 0.04)], ['purity', 'passive', 5, P({ damageReduction: 1.5 })], ['alms', 'passive', 5, P({ goldFind: 6 })]],
    [['blessing-of-iron', 'aura', 5, P({ armorPct: 3 })], ['zeal', 'passive', 5, P({ attackSpeed: 3 })], ['smiting', 'passive', 5, P({ critDamage: 8 })]],
    [['halo', 'aura', 5, P({ critChance: 1 })], ['martyr', 'passive', 5, P({ maxHpPct: 7 })], ['providence', 'passive', 5, P({ magicFind: 6 })]],
    [['sanctity', 'passive', 5, P({ damageReduction: 2 })], ['choir', 'aura', 5, P({ xpBonus: 3 })], ['radiance', 'passive', 5, P({ skillDamage: 8 })]],
    [['divine-favor', 'aura', 5, P({ cooldownReduction: 2 })], ['absolution', 'passive', 5, P({ lifeSteal: 0.8 })], ['crusade', 'aura', 5, P({ attackPct: 2 })]],
    [['judgment', 'active', 3, A('judgment', 20_000, 2, 0.5)], ['legend', 'passive', 3, P({ maxHpPct: 8, damageReduction: 3 })]],
  ],
  artificer: [
    [['tinkering', 'passive', 5, P({ attackPct: 4 })], ['turret', 'active', 5, A('turret', 12_000, 0.6, 0.1)]],
    [['calibration', 'passive', 5, P({ critChance: 2.5 })], ['reinforced', 'passive', 5, P({ armorPct: 6 })], ['maintenance', 'aura', 5, P({ armorPct: 2 })]],
    [['overclock', 'active', 5, A('overclock', 14_000, 0.25, 0.04)], ['gearhead', 'passive', 5, P({ attackSpeed: 3 })], ['salvager', 'passive', 5, P({ goldFind: 8 })]],
    [['precision-tools', 'passive', 5, P({ critDamage: 10 })], ['plating', 'passive', 5, P({ maxHpPct: 6 })], ['logistics', 'aura', 5, P({ chestChance: 4 })]],
    [['automation', 'passive', 5, P({ cooldownReduction: 2.5 })], ['demolition', 'passive', 5, P({ bossDamage: 8 })], ['prospector', 'passive', 5, P({ magicFind: 6 })]],
    [['upgrades', 'passive', 5, P({ skillDamage: 8 })], ['supply-lines', 'aura', 5, P({ goldFind: 4 })], ['overdrive', 'passive', 5, P({ attackSpeed: 3 })]],
    [['masterwork', 'passive', 5, P({ attackPct: 7 })], ['shielding', 'passive', 5, P({ damageReduction: 2 })], ['engineering', 'aura', 5, P({ critDamage: 5 })]],
    [['barrage', 'active', 3, A('barrage', 16_000, 0.7, 0.2)], ['legend', 'passive', 3, P({ attackPct: 8, cooldownReduction: 4 })]],
  ],
  maestro: [
    [['conducting', 'passive', 5, P({ attackPct: 4 })], ['anthem', 'active', 5, A('anthem', 9_000, 0.3, 0.05)]],
    [['tempo', 'aura', 5, P({ attackSpeed: 1.5 })], ['harmony', 'passive', 5, P({ maxHpPct: 5 })], ['resonance', 'passive', 5, P({ critChance: 2 })]],
    [['crescendo', 'active', 5, A('crescendo', 12_000, 0.25, 0.05)], ['composer', 'passive', 5, P({ skillDamage: 6 })], ['patronage', 'passive', 5, P({ goldFind: 8 })]],
    [['virtuoso', 'passive', 5, P({ critDamage: 10 })], ['forte', 'aura', 5, P({ attackPct: 2.5 })], ['encore', 'passive', 5, P({ cooldownReduction: 2.5 })]],
    [['overture', 'aura', 5, P({ xpBonus: 3 })], ['dynamics', 'passive', 5, P({ attackSpeed: 3 })], ['libretto', 'passive', 5, P({ magicFind: 6 })]],
    [['symphony', 'aura', 5, P({ critChance: 1 })], ['cadence', 'passive', 5, P({ damageReduction: 2 })], ['ovation', 'aura', 5, P({ goldFind: 4 })]],
    [['grandeur', 'passive', 5, P({ attackPct: 7 })], ['fortissimo', 'aura', 5, P({ skillDamage: 4 })], ['aria', 'passive', 5, P({ maxHpPct: 7 })]],
    [['finale', 'active', 3, A('finale', 20_000, 2.5, 0.6)], ['legend', 'passive', 3, P({ attackPct: 6, cooldownReduction: 5 })]],
  ],
};

export const SKILL_TREES: Record<HeroClassId, SkillNode[]> = Object.fromEntries(
  (Object.entries(TREES) as Array<[HeroClassId, Spec[][]]>).map(([classId, tiers]) => [
    classId,
    tiers.flatMap((tier, index) => tier.map(([name, kind, maxRank, effect]): SkillNode => ({
      id: `${classId}.${name}`,
      classId,
      tier: index + 1,
      kind,
      maxRank,
      ...(kind === 'active' ? { active: effect as ActiveSpec } : { stats: effect as StatBlock }),
    }))),
  ]),
) as Record<HeroClassId, SkillNode[]>;

export const SKILL_NODES: Record<string, SkillNode> = Object.fromEntries(Object.values(SKILL_TREES).flat().map((node) => [node.id, node]));

/** Points spent in a tree needed to open a tier. */
export function tierRequirement(tier: number): number {
  return (tier - 1) * 10;
}

/** One skill point per level. */
export function skillPointsAt(level: number): number {
  return Math.max(1, Math.min(MAX_HERO_LEVEL, level));
}

export type SkillRanks = Record<string, number>;

export function pointsSpent(ranks: SkillRanks): number {
  return Object.values(ranks).reduce((sum, rank) => sum + Math.max(0, rank), 0);
}

/** Points spent below a tier, which is what gates that tier. */
function pointsBelow(classId: HeroClassId, ranks: SkillRanks, tier: number): number {
  return SKILL_TREES[classId].filter((node) => node.tier < tier).reduce((sum, node) => sum + (ranks[node.id] ?? 0), 0);
}

/** Whether one more rank can go into a node. */
export function canRaise(classId: HeroClassId, level: number, ranks: SkillRanks, nodeId: string): 'ok' | 'unknown' | 'max' | 'points' | 'tier' {
  const node = SKILL_NODES[nodeId];
  if (!node || node.classId !== classId) return 'unknown';
  if ((ranks[nodeId] ?? 0) >= node.maxRank) return 'max';
  if (pointsSpent(ranks) >= skillPointsAt(level)) return 'points';
  if (pointsBelow(classId, ranks, node.tier) < tierRequirement(node.tier)) return 'tier';
  return 'ok';
}

/** Ranks of a class kept valid after a level or class change: anything unreachable is refunded. */
export function sanitizeRanks(classId: HeroClassId, level: number, ranks: SkillRanks): SkillRanks {
  const clean: SkillRanks = {};
  for (const node of [...SKILL_TREES[classId]].sort((a, b) => a.tier - b.tier)) {
    const wanted = Math.max(0, Math.min(node.maxRank, Math.floor(ranks[node.id] ?? 0)));
    for (let rank = 0; rank < wanted; rank += 1) {
      if (canRaise(classId, level, clean, node.id) !== 'ok') break;
      clean[node.id] = (clean[node.id] ?? 0) + 1;
    }
  }
  return clean;
}

/**
 * The automatic build for heroes the owner does not manage by hand: the first
 * active, then each tier's nodes in order, filling ranks before moving up.
 */
export function autoAllocate(classId: HeroClassId, level: number, ranks: SkillRanks): SkillRanks {
  const next = sanitizeRanks(classId, level, ranks);
  const order = [...SKILL_TREES[classId]].sort((a, b) => a.tier - b.tier || Number(b.kind === 'active') - Number(a.kind === 'active'));
  let progressed = true;
  while (progressed && pointsSpent(next) < skillPointsAt(level)) {
    progressed = false;
    for (const node of order) {
      if (canRaise(classId, level, next, node.id) === 'ok') {
        next[node.id] = (next[node.id] ?? 0) + 1;
        progressed = true;
        break;
      }
    }
  }
  return next;
}

export function passiveStats(classId: HeroClassId, ranks: SkillRanks): StatBlock {
  return addStats(...SKILL_TREES[classId].filter((node) => node.kind === 'passive' && node.stats && ranks[node.id]).map((node) => scaleStats(node.stats!, ranks[node.id])));
}

export function auraStats(classId: HeroClassId, ranks: SkillRanks): StatBlock {
  return addStats(...SKILL_TREES[classId].filter((node) => node.kind === 'aura' && node.stats && ranks[node.id]).map((node) => scaleStats(node.stats!, ranks[node.id])));
}

export type LearnedActive = { id: string; action: ActiveAction; cooldownMs: number; power: number; rank: number };

export function learnedActives(classId: HeroClassId, ranks: SkillRanks): LearnedActive[] {
  return SKILL_TREES[classId]
    .filter((node) => node.kind === 'active' && node.active && (ranks[node.id] ?? 0) > 0)
    .map((node) => ({ id: node.id, action: node.active!.action, cooldownMs: node.active!.cooldownMs, power: node.active!.power + node.active!.powerPerRank * (ranks[node.id] - 1), rank: ranks[node.id] }));
}

/** The actives a hero casts: the chosen ones still learned, else the strongest it knows. */
export function slottedActives(classId: HeroClassId, ranks: SkillRanks, chosen: string[], slots: number): LearnedActive[] {
  const learned = learnedActives(classId, ranks);
  const picked = chosen.map((id) => learned.find((active) => active.id === id)).filter((active): active is LearnedActive => Boolean(active));
  const byTier = [...learned].sort((a, b) => SKILL_NODES[b.id].tier - SKILL_NODES[a.id].tier);
  for (const active of byTier) if (picked.length < slots && !picked.includes(active)) picked.push(active);
  return picked.slice(0, slots);
}
