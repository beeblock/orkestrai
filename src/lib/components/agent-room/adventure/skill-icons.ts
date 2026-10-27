import type { ActiveAction, SkillNode } from '$lib/modules/agent-room/domain/adventure/skills.js';
import type { StatId } from '$lib/modules/agent-room/domain/adventure/stats.js';

export type Icon = { atlas: string; frame: number };

const ACTIVES_ATLAS = 'icons-skills-actives';
const STATS_ATLAS = 'icons-skills-stats';

/** Frames of the active skill sheet, in its order. */
const ACTIVE_FRAMES: Record<ActiveAction, number> = {
  bash: 0, whirlwind: 1, bulwark: 2, earthshatter: 3, volley: 4,
  pierce: 5, 'arrow-rain': 6, meteor: 7, 'frost-nova': 8, 'arcane-storm': 9,
  sanctuary: 10, heal: 11, judgment: 12, turret: 13, overclock: 14,
  barrage: 15, anthem: 16, crescendo: 17, finale: 18,
};

/** Frames of the stat sheet: a flat stat and its percent share one picture. */
const STAT_FRAMES: Record<StatId, number> = {
  attack: 0, attackPct: 0, armor: 1, armorPct: 1, maxHp: 2, maxHpPct: 2, attackSpeed: 3, critChance: 4, critDamage: 5,
  cooldownReduction: 6, skillDamage: 7, bossDamage: 8, damageReduction: 9, hpRegen: 10, lifeSteal: 11,
  goldFind: 12, magicFind: 13, xpBonus: 14, chestChance: 15,
};

/** The party banner (auras) and the skill point crystal. */
export const AURA_ICON: Icon = { atlas: STATS_ATLAS, frame: 16 };
export const SKILL_POINT_ICON: Icon = { atlas: STATS_ATLAS, frame: 17 };

export function statIcon(stat: StatId): Icon {
  return { atlas: STATS_ATLAS, frame: STAT_FRAMES[stat] };
}

export function activeIcon(action: ActiveAction): Icon {
  return { atlas: ACTIVES_ATLAS, frame: ACTIVE_FRAMES[action] };
}

/** A skill's picture: its own for an active, its main stat's for a passive or an aura. */
export function skillIcon(node: SkillNode): Icon {
  if (node.active) return activeIcon(node.active.action);
  const stat = Object.keys(node.stats ?? {})[0] as StatId | undefined;
  return stat ? statIcon(stat) : AURA_ICON;
}
