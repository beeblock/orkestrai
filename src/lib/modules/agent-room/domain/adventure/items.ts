import { HERO_CLASSES, HERO_CLASS_IDS, type HeroClassId } from './catalog.js';
import { addStats, type StatBlock, type StatId } from './stats.js';
import { MAX_REGION_LEVEL, power } from './world.js';

/**
 * Gear. Seven slots, nine rarities, six base looks per slot (by item level),
 * random affixes and sockets for gems, runestones and glyphs. Everything
 * here is pure: the server rolls items with its own random source.
 */

export type Rng = () => number;

export type Slot = 'weapon' | 'helmet' | 'armor' | 'gloves' | 'boots' | 'amulet' | 'ring';
export const SLOTS: Slot[] = ['weapon', 'helmet', 'armor', 'gloves', 'boots', 'amulet', 'ring'];

export type SlotGroup = 'weapon' | 'armor' | 'jewelry';
export function slotGroup(slot: Slot): SlotGroup {
  if (slot === 'weapon') return 'weapon';
  return slot === 'amulet' || slot === 'ring' ? 'jewelry' : 'armor';
}

export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary' | 'immortal' | 'arcana' | 'mythic' | 'cosmic';
export const RARITIES: Rarity[] = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'immortal', 'arcana', 'mythic', 'cosmic'];

export type SocketKind = 'decoration' | 'engraving' | 'inscription';

export type RarityRules = {
  /** Multiplies every base number of the item. */
  multiplier: number;
  affixes: number;
  sockets: SocketKind[];
  /** Relative worth, for alchemy and synthesis. */
  worth: number;
  color: string;
};

export const RARITY_RULES: Record<Rarity, RarityRules> = {
  common: { multiplier: 1, affixes: 0, sockets: [], worth: 1, color: '#c9c4ba' },
  uncommon: { multiplier: 1.15, affixes: 1, sockets: [], worth: 2, color: '#62d26f' },
  rare: { multiplier: 1.35, affixes: 2, sockets: ['decoration'], worth: 5, color: '#4f9dff' },
  epic: { multiplier: 1.6, affixes: 3, sockets: ['decoration'], worth: 12, color: '#b46cff' },
  legendary: { multiplier: 1.9, affixes: 4, sockets: ['decoration', 'decoration'], worth: 30, color: '#ff9b30' },
  immortal: { multiplier: 2.3, affixes: 4, sockets: ['decoration', 'decoration', 'engraving'], worth: 80, color: '#ff4f4f' },
  arcana: { multiplier: 2.8, affixes: 5, sockets: ['decoration', 'decoration', 'engraving', 'inscription'], worth: 200, color: '#38e2d9' },
  mythic: { multiplier: 3.4, affixes: 5, sockets: ['decoration', 'decoration', 'decoration', 'engraving', 'inscription'], worth: 500, color: '#ff70d6' },
  cosmic: { multiplier: 4.2, affixes: 6, sockets: ['decoration', 'decoration', 'decoration', 'engraving', 'inscription'], worth: 1200, color: '#fff1a6' },
};

export function rarityIndex(rarity: Rarity): number {
  return RARITIES.indexOf(rarity);
}

/** Item level where each of the six base looks starts. */
export const BASE_TIER_LEVELS = [1, 20, 40, 60, 80, 100];

export function baseTier(level: number): number {
  let tier = 0;
  for (let index = 0; index < BASE_TIER_LEVELS.length; index += 1) if (level >= BASE_TIER_LEVELS[index]) tier = index;
  return tier;
}

/** A hero can wear gear up to ten levels above its own. */
export const EQUIP_LEVEL_MARGIN = 10;

export type ItemAffix = { stat: StatId; value: number };
export type ItemSocket = { kind: SocketKind; material: MaterialId | null };

/** What defines an item, independent of where it is kept. */
export type ItemData = {
  slot: Slot;
  /** Weapons belong to one class. */
  classId: HeroClassId | null;
  rarity: Rarity;
  level: number;
  affixes: ItemAffix[];
  sockets: ItemSocket[];
};

export type ItemLocation = 'inventory' | 'stash' | 'equipped';

export type Item = ItemData & {
  id: string;
  location: ItemLocation;
  /** The hero (agent node) wearing it, when equipped. */
  heroNodeId: string | null;
  locked: boolean;
  createdAt: string;
};

// ---------------------------------------------------------------------------
// Base stats every item of a slot has, scaled by level and rarity.

function implicitStats(item: Pick<ItemData, 'slot' | 'classId' | 'rarity' | 'level'>): StatBlock {
  const scale = power(item.level) * RARITY_RULES[item.rarity].multiplier;
  const life = power(item.level) ** 0.9 * RARITY_RULES[item.rarity].multiplier;
  const tier = rarityIndex(item.rarity);
  switch (item.slot) {
    case 'weapon': return { attack: HERO_CLASSES[item.classId ?? 'knight'].damage * 0.9 * scale };
    case 'helmet': return { armor: 4 * scale, maxHp: 12 * life };
    case 'armor': return { armor: 8 * scale, maxHp: 25 * life };
    case 'gloves': return { armor: 3 * scale, attack: 1.2 * scale };
    case 'boots': return { armor: 3 * scale, maxHp: 6 * life };
    case 'amulet': return { attack: 1.5 * scale, maxHpPct: 3 + tier * 0.8 };
    case 'ring': return { critChance: 1.5 + tier * 0.4 };
  }
}

// ---------------------------------------------------------------------------
// Affixes.

type AffixRule = { stat: StatId; slots: Slot[]; weight: number } & (
  | { kind: 'flat'; base: number; exponent: number }
  | { kind: 'pct'; min: number; max: number }
);

export const AFFIXES: AffixRule[] = [
  { stat: 'attack', slots: ['weapon', 'gloves', 'ring', 'amulet'], weight: 10, kind: 'flat', base: 2.5, exponent: 0.95 },
  { stat: 'attackPct', slots: ['weapon', 'gloves', 'ring', 'amulet'], weight: 9, kind: 'pct', min: 3, max: 10 },
  { stat: 'armor', slots: ['helmet', 'armor', 'gloves', 'boots'], weight: 10, kind: 'flat', base: 2.2, exponent: 0.95 },
  { stat: 'armorPct', slots: ['helmet', 'armor', 'boots'], weight: 8, kind: 'pct', min: 4, max: 12 },
  { stat: 'maxHp', slots: ['helmet', 'armor', 'boots', 'amulet'], weight: 10, kind: 'flat', base: 9, exponent: 0.9 },
  { stat: 'maxHpPct', slots: ['helmet', 'armor', 'boots', 'amulet'], weight: 8, kind: 'pct', min: 3, max: 10 },
  { stat: 'attackSpeed', slots: ['weapon', 'gloves', 'ring'], weight: 7, kind: 'pct', min: 2, max: 8 },
  { stat: 'critChance', slots: ['weapon', 'gloves', 'ring', 'amulet', 'helmet'], weight: 7, kind: 'pct', min: 1, max: 5 },
  { stat: 'critDamage', slots: ['weapon', 'amulet', 'ring', 'gloves'], weight: 7, kind: 'pct', min: 6, max: 25 },
  { stat: 'cooldownReduction', slots: ['helmet', 'amulet', 'gloves'], weight: 5, kind: 'pct', min: 2, max: 7 },
  { stat: 'skillDamage', slots: ['weapon', 'helmet', 'amulet'], weight: 6, kind: 'pct', min: 4, max: 18 },
  { stat: 'bossDamage', slots: ['weapon', 'ring', 'gloves'], weight: 5, kind: 'pct', min: 4, max: 18 },
  { stat: 'damageReduction', slots: ['armor', 'boots', 'helmet'], weight: 5, kind: 'pct', min: 1, max: 5 },
  { stat: 'hpRegen', slots: ['armor', 'amulet', 'ring', 'boots'], weight: 5, kind: 'flat', base: 0.5, exponent: 0.9 },
  { stat: 'lifeSteal', slots: ['weapon', 'ring', 'gloves'], weight: 4, kind: 'pct', min: 0.5, max: 2.5 },
  { stat: 'goldFind', slots: ['boots', 'ring', 'amulet', 'helmet'], weight: 6, kind: 'pct', min: 5, max: 22 },
  { stat: 'magicFind', slots: ['boots', 'ring', 'amulet', 'helmet'], weight: 5, kind: 'pct', min: 4, max: 18 },
  { stat: 'xpBonus', slots: ['helmet', 'amulet', 'armor'], weight: 5, kind: 'pct', min: 3, max: 12 },
];

function round(value: number, step: number): number {
  return Math.round(value / step) * step;
}

function rollAffixValue(rule: AffixRule, level: number, rarity: Rarity, roll: number): number {
  const tier = rarityIndex(rarity);
  if (rule.kind === 'flat') {
    const value = rule.base * power(level) ** rule.exponent * (0.8 + 0.4 * roll) * (1 + 0.1 * tier);
    return value >= 20 ? Math.round(value) : round(value, 0.1);
  }
  return round((rule.min + (rule.max - rule.min) * roll) * (1 + 0.12 * tier), 0.1);
}

function pickWeighted<T extends { weight: number }>(rng: Rng, entries: T[]): T {
  const total = entries.reduce((sum, entry) => sum + entry.weight, 0);
  let pick = rng() * total;
  for (const entry of entries) {
    pick -= entry.weight;
    if (pick <= 0) return entry;
  }
  return entries[entries.length - 1];
}

// ---------------------------------------------------------------------------
// Socket materials: gems for decorations, runestones for engravings and
// glyphs for inscriptions. What one grants depends on the kind of item.

export type MaterialId =
  | 'ruby' | 'sapphire' | 'emerald' | 'topaz' | 'amethyst' | 'diamond'
  | 'fury-rune' | 'ward-rune' | 'vigor-rune'
  | 'fortune-glyph' | 'arcana-glyph' | 'clarity-glyph';

export type Material = { id: MaterialId; socket: SocketKind; icon: number; effects: Record<SlotGroup, StatBlock> };

export const MATERIALS: Record<MaterialId, Material> = {
  ruby: { id: 'ruby', socket: 'decoration', icon: 0, effects: { weapon: { attackPct: 8 }, armor: { maxHpPct: 6 }, jewelry: { critDamage: 12 } } },
  sapphire: { id: 'sapphire', socket: 'decoration', icon: 1, effects: { weapon: { critChance: 3 }, armor: { armorPct: 8 }, jewelry: { cooldownReduction: 4 } } },
  emerald: { id: 'emerald', socket: 'decoration', icon: 2, effects: { weapon: { lifeSteal: 1.5 }, armor: { maxHpPct: 8 }, jewelry: { xpBonus: 6 } } },
  topaz: { id: 'topaz', socket: 'decoration', icon: 3, effects: { weapon: { attackSpeed: 4 }, armor: { goldFind: 10 }, jewelry: { goldFind: 12 } } },
  amethyst: { id: 'amethyst', socket: 'decoration', icon: 4, effects: { weapon: { skillDamage: 10 }, armor: { damageReduction: 3 }, jewelry: { magicFind: 10 } } },
  diamond: { id: 'diamond', socket: 'decoration', icon: 5, effects: { weapon: { bossDamage: 12 }, armor: { damageReduction: 4 }, jewelry: { critChance: 3 } } },
  'fury-rune': { id: 'fury-rune', socket: 'engraving', icon: 6, effects: { weapon: { attackPct: 18 }, armor: { critDamage: 20 }, jewelry: { attackSpeed: 8 } } },
  'ward-rune': { id: 'ward-rune', socket: 'engraving', icon: 7, effects: { weapon: { damageReduction: 6 }, armor: { armorPct: 18 }, jewelry: { maxHpPct: 12 } } },
  'vigor-rune': { id: 'vigor-rune', socket: 'engraving', icon: 8, effects: { weapon: { lifeSteal: 3 }, armor: { maxHpPct: 15 }, jewelry: { hpRegen: 25 } } },
  'fortune-glyph': { id: 'fortune-glyph', socket: 'inscription', icon: 9, effects: { weapon: { goldFind: 25 }, armor: { goldFind: 30 }, jewelry: { goldFind: 35 } } },
  'arcana-glyph': { id: 'arcana-glyph', socket: 'inscription', icon: 10, effects: { weapon: { skillDamage: 25 }, armor: { cooldownReduction: 8 }, jewelry: { skillDamage: 20 } } },
  'clarity-glyph': { id: 'clarity-glyph', socket: 'inscription', icon: 11, effects: { weapon: { magicFind: 20 }, armor: { xpBonus: 15 }, jewelry: { magicFind: 25 } } },
};

export const MATERIAL_IDS = Object.keys(MATERIALS) as MaterialId[];

// ---------------------------------------------------------------------------

const SLOT_WEIGHTS: Record<Slot, number> = { weapon: 22, helmet: 13, armor: 13, gloves: 12, boots: 12, amulet: 14, ring: 14 };

export type RollOptions = {
  level: number;
  rarity: Rarity;
  slot?: Slot;
  classId?: HeroClassId | null;
  /** Classes in the party: weapons favor them. */
  partyClasses?: HeroClassId[];
};

/** A new item: base, affixes and empty sockets. */
export function rollItem(rng: Rng, options: RollOptions): ItemData {
  const level = Math.max(1, Math.min(MAX_REGION_LEVEL, Math.round(options.level)));
  const slot = options.slot ?? pickWeighted(rng, SLOTS.map((candidate) => ({ candidate, weight: SLOT_WEIGHTS[candidate] }))).candidate;
  let classId: HeroClassId | null = null;
  if (slot === 'weapon') {
    const party = options.partyClasses?.length ? options.partyClasses : HERO_CLASS_IDS;
    classId = options.classId ?? (rng() < 0.75 ? party[Math.floor(rng() * party.length)] : HERO_CLASS_IDS[Math.floor(rng() * HERO_CLASS_IDS.length)]);
  }
  const rules = RARITY_RULES[options.rarity];
  const pool = AFFIXES.filter((rule) => rule.slots.includes(slot));
  const affixes: ItemAffix[] = [];
  for (let index = 0; index < rules.affixes && pool.length; index += 1) {
    const rule = pickWeighted(rng, pool);
    pool.splice(pool.indexOf(rule), 1);
    affixes.push({ stat: rule.stat, value: rollAffixValue(rule, level, options.rarity, rng()) });
  }
  return { slot, classId, rarity: options.rarity, level, affixes, sockets: rules.sockets.map((kind) => ({ kind, material: null })) };
}

/** Everything an item gives its wearer. */
export function itemStats(item: ItemData): StatBlock {
  const affixes: StatBlock = {};
  for (const affix of item.affixes) affixes[affix.stat] = (affixes[affix.stat] ?? 0) + affix.value;
  const sockets = item.sockets
    .filter((socket) => socket.material)
    .map((socket) => MATERIALS[socket.material!].effects[slotGroup(item.slot)]);
  return addStats(implicitStats(item), affixes, ...sockets);
}

/** Only the base numbers (shown first in a tooltip). */
export function itemImplicitStats(item: ItemData): StatBlock {
  return implicitStats(item);
}

/** Gold an item turns into through alchemy. */
export function itemGoldValue(item: Pick<ItemData, 'rarity' | 'level'>, bonus = 0): number {
  return Math.round(6 * RARITY_RULES[item.rarity].worth * power(item.level) ** 0.6 * (1 + bonus / 100));
}

/** A single number to sort and compare items of the same slot. */
export function itemScore(item: ItemData): number {
  return Math.round(item.level * RARITY_RULES[item.rarity].multiplier * 10 + item.affixes.length * 5 + item.sockets.filter((socket) => socket.material).length * 8);
}

export function canEquip(item: Pick<ItemData, 'slot' | 'classId' | 'level'>, hero: { classId: HeroClassId; level: number }): 'ok' | 'class' | 'level' {
  if (item.slot === 'weapon' && item.classId && item.classId !== hero.classId) return 'class';
  if (item.level > hero.level + EQUIP_LEVEL_MARGIN) return 'level';
  return 'ok';
}

/** Which icon atlas and frame draws an item. */
export function itemIcon(item: Pick<ItemData, 'slot' | 'classId' | 'level'>): { atlas: string; frame: number } {
  const tier = baseTier(item.level);
  switch (item.slot) {
    case 'weapon': {
      const classId = item.classId ?? 'knight';
      const sheet: Record<HeroClassId, [string, number]> = {
        knight: ['icons-weapons-1', 0], ranger: ['icons-weapons-1', 1],
        sorceress: ['icons-weapons-2', 0], cleric: ['icons-weapons-2', 1],
        artificer: ['icons-weapons-3', 0], maestro: ['icons-weapons-3', 1],
      };
      const [atlas, row] = sheet[classId];
      return { atlas, frame: row * 6 + tier };
    }
    case 'helmet': return { atlas: 'icons-armor-1', frame: tier };
    case 'armor': return { atlas: 'icons-armor-1', frame: 6 + tier };
    case 'gloves': return { atlas: 'icons-armor-2', frame: tier };
    case 'boots': return { atlas: 'icons-armor-2', frame: 6 + tier };
    case 'amulet': return { atlas: 'icons-jewelry', frame: tier };
    case 'ring': return { atlas: 'icons-jewelry', frame: 6 + tier };
  }
}

/** Translation key of an item's base name (`slot.tier` or `weapon-class.tier`). */
export function itemBaseKey(item: Pick<ItemData, 'slot' | 'classId' | 'level'>): string {
  const tier = baseTier(item.level);
  return item.slot === 'weapon' ? `weapon-${item.classId ?? 'knight'}.${tier}` : `${item.slot}.${tier}`;
}
