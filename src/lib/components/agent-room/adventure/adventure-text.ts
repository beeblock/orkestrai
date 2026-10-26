import { fill, type AdventureCatalog } from '$lib/i18n/adventure/index.js';
import { itemBaseKey, type ItemData } from '$lib/modules/agent-room/domain/adventure/items.js';
import type { Rune } from '$lib/modules/agent-room/domain/adventure/runes.js';
import type { ActiveAction, SkillNode } from '$lib/modules/agent-room/domain/adventure/skills.js';
import { FLAT_STATS, scaleStats, type StatBlock, type StatId } from '$lib/modules/agent-room/domain/adventure/stats.js';

/** Words for the Adventure's numbers, in the catalog's language. */

export function formatNumber(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${(value / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (abs >= 1e4) return `${(value / 1e3).toFixed(1)}k`;
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function itemName(catalog: AdventureCatalog, item: Pick<ItemData, 'slot' | 'classId' | 'level'>): string {
  return catalog.bases[itemBaseKey(item)] ?? catalog.slots[item.slot];
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
