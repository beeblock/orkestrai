import { fill, type AdventureCatalog } from '$lib/i18n/adventure/index.js';
import { SETS, UNIQUES } from '$lib/modules/agent-room/domain/adventure/artifacts.js';
import { NORMAL_GEM_QUALITY, isGem, itemBaseKey, type GemQuality, type ItemData, type MaterialId } from '$lib/modules/agent-room/domain/adventure/items.js';
import type { Rune } from '$lib/modules/agent-room/domain/adventure/runes.js';
import type { ActiveAction, SkillNode } from '$lib/modules/agent-room/domain/adventure/skills.js';
import { FLAT_STATS, scaleStats, type StatBlock, type StatId } from '$lib/modules/agent-room/domain/adventure/stats.js';
import * as m from '$lib/paraglide/messages.js';

/** Words for the Adventure's numbers, in the catalog's language. */

export function formatNumber(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${(value / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (abs >= 1e4) return `${(value / 1e3).toFixed(1)}k`;
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/** "Lv 42", or "Paragon 7" past the level cap. */
export function heroLevelText(level: number, paragon: number): string {
  return paragon > 0 ? m['adventure.paragon_level']({ level: paragon }) : m['adventure.level']({ level });
}

/** An item's name: a unique's own, a set piece's, or its base's (variant included). */
export function itemName(catalog: AdventureCatalog, item: Pick<ItemData, 'slot' | 'classId' | 'level' | 'variant' | 'uniqueId' | 'setId'>): string {
  if (item.uniqueId && UNIQUES[item.uniqueId]) return catalog.uniques[item.uniqueId];
  if (item.setId && SETS[item.setId]) return catalog.setPieces[`${item.setId}.${item.slot}`] ?? catalog.sets[item.setId];
  return catalog.bases[itemBaseKey(item)] ?? catalog.slots[item.slot];
}

/** A material's name, with a gem's cut. */
export function materialName(catalog: AdventureCatalog, material: MaterialId, quality: GemQuality = NORMAL_GEM_QUALITY): string {
  const name = catalog.materials[material];
  return isGem(material) ? fill(catalog.gemQualities[String(quality) as '3'], { gem: name }) : name;
}

export function statText(catalog: AdventureCatalog, stat: StatId, value: number): string {
  const sign = value >= 0 ? '+' : '';
  return FLAT_STATS.has(stat) ? `${sign}${formatNumber(Math.round(value * 10) / 10)} ${catalog.stats[stat]}` : `${sign}${formatNumber(Math.round(value * 10) / 10)}% ${catalog.stats[stat]}`;
}

export function statLines(catalog: AdventureCatalog, block: StatBlock): string[] {
  return (Object.entries(block) as Array<[StatId, number]>).filter(([, value]) => value).map(([stat, value]) => statText(catalog, stat, value));
}

/** The number an active's sentence shows for its power. */
export function activeValue(action: ActiveAction, power: number): number {
  return action === 'sanctuary' ? Math.round(power) : Math.round(power * 100);
}

/** What a skill does at a rank (the next rank when it has none yet). */
export function skillDescription(catalog: AdventureCatalog, node: SkillNode, rank: number): string {
  const shown = Math.max(1, rank);
  if (node.active) return fill(catalog.actives[node.active.action], { value: activeValue(node.active.action, node.active.power + node.active.powerPerRank * (shown - 1)) });
  return statLines(catalog, scaleStats(node.stats ?? {}, shown)).join(' · ');
}

export function runeDescription(catalog: AdventureCatalog, rune: Rune, rank: number): string {
  const shown = Math.max(1, rank);
  if (rune.stats) return statLines(catalog, scaleStats(rune.stats, shown)).join(' · ');
  if (rune.rule) return fill(catalog.runeRules[rune.rule[0]], { value: rune.rule[1] * shown });
  return '';
}

export function errorText(catalog: AdventureCatalog, code: string, fallback: string): string {
  return catalog.errors[code] ?? fallback;
}
