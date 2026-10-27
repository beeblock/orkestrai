import { HERO_CLASSES, HERO_CLASS_IDS, type HeroClassId } from './catalog.js';
import { SETS, SET_PIECES, UNIQUES, uniqueStats, type SetId, type UniqueId } from './artifacts.js';
import { addStats, type StatBlock, type StatId } from './stats.js';
import { MAX_REGION_LEVEL, power } from './world.js';

/**
 * Gear. A full armory — main hand and off hand, head, shoulders, chest,
 * hands, legs and feet, a necklace, two rings and two trinkets — nine
 * rarities, six base tiers per slot (by item level) with three variants each, random affixes and sockets for gems (in five
 * qualities), runestones and glyphs; plus uniques and class sets (see
 * artifacts.ts). Everything here is pure: the server rolls items with its
 * own random source.
 */

export type Rng = () => number;

/** `weapon` is the main hand, `armor` the chest piece and `amulet` the necklace. */
export type Slot = 'weapon' | 'offhand' | 'helmet' | 'shoulders' | 'armor' | 'gloves' | 'legs' | 'boots' | 'amulet' | 'ring' | 'trinket';
export const SLOTS: Slot[] = ['weapon', 'offhand', 'helmet', 'shoulders', 'armor', 'gloves', 'legs', 'boots', 'amulet', 'ring', 'trinket'];

/** How many items of a slot one hero wears: two rings and two trinkets, one of everything else. */
export const SLOT_CAPACITY: Record<Slot, number> = {
  weapon: 1, offhand: 1, helmet: 1, shoulders: 1, armor: 1, gloves: 1, legs: 1, boots: 1, amulet: 1, ring: 2, trinket: 2,
};

/** Slots whose items belong to one class. */
export function classSlot(slot: Slot): boolean {
  return slot === 'weapon' || slot === 'offhand';
}

export type SlotGroup = 'weapon' | 'armor' | 'jewelry';
export function slotGroup(slot: Slot): SlotGroup {
  if (slot === 'weapon' || slot === 'offhand') return 'weapon';
  return slot === 'amulet' || slot === 'ring' || slot === 'trinket' ? 'jewelry' : 'armor';
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

/**
 * Every base tier comes in three variants with their own look and focus:
 * the classic one, a lighter and faster one, and a heavier or more arcane one.
 */
export type BaseVariant = 0 | 1 | 2;
export const BASE_VARIANTS: BaseVariant[] = [0, 1, 2];

export type ItemAffix = { stat: StatId; value: number };
/** `quality` only matters for gems (1 Chipped ... 5 Perfect); absent means Normal (3). */
export type ItemSocket = { kind: SocketKind; material: MaterialId | null; quality?: GemQuality };

/** What defines an item, independent of where it is kept. */
export type ItemData = {
  slot: Slot;
  /** Weapons belong to one class. */
  classId: HeroClassId | null;
  rarity: Rarity;
  level: number;
  affixes: ItemAffix[];
  sockets: ItemSocket[];
  /** Base variant; absent means the classic one. */
  variant?: BaseVariant;
  /** A named unique with its own power. */
  uniqueId?: UniqueId | null;
  /** A piece of a class set. */
  setId?: SetId | null;
};

export type ItemLocation = 'inventory' | 'stash' | 'equipped';

export type Item = ItemData & {
  id: string;
  location: ItemLocation;
  /** The hero wearing it, when equipped. */
  heroId: string | null;
  locked: boolean;
  createdAt: string;
};

// ---------------------------------------------------------------------------
// Base stats every item of a slot has, scaled by level and rarity.

/** Classes whose heavy weapon variant leans on skills rather than critical hits. */
const CASTERS = new Set<HeroClassId>(['sorceress', 'cleric', 'maestro']);

/** Each class's off hand: a shield, a quiver, a focus crystal, a relic, a gadget or a songbook. */
function offhandStats(classId: HeroClassId, scale: number, tier: number): StatBlock {
  switch (classId) {
    case 'knight': return { armor: 4 * scale, damageReduction: 2 + tier * 0.4 };
    case 'ranger': return { attack: HERO_CLASSES.ranger.damage * 0.15 * scale, attackSpeed: 3 + tier * 0.6 };
    case 'sorceress': return { skillDamage: 6 + tier * 1.5, cooldownReduction: 2 + tier * 0.3 };
    case 'cleric': return { maxHpPct: 4 + tier * 0.8, skillDamage: 4 + tier };
    case 'artificer': return { attackPct: 4 + tier, cooldownReduction: 2 + tier * 0.3 };
    case 'maestro': return { skillDamage: 4 + tier, xpBonus: 3 + tier * 0.8 };
  }
}

function implicitStats(item: Pick<ItemData, 'slot' | 'classId' | 'rarity' | 'level' | 'variant'>): StatBlock {
  const scale = power(item.level) * RARITY_RULES[item.rarity].multiplier;
  const life = power(item.level) ** 0.9 * RARITY_RULES[item.rarity].multiplier;
  const tier = rarityIndex(item.rarity);
  const variant = item.variant ?? 0;
  switch (item.slot) {
    case 'weapon': {
      const damage = HERO_CLASSES[item.classId ?? 'knight'].damage * scale;
      if (variant === 1) return { attack: damage * 0.8, attackSpeed: 5 + tier };
      if (variant === 2) return CASTERS.has(item.classId ?? 'knight') ? { attack: damage * 0.82, skillDamage: 8 + tier * 2 } : { attack: damage * 0.82, critDamage: 10 + tier * 3 };
      return { attack: damage * 0.9 };
    }
    case 'offhand': return offhandStats(item.classId ?? 'knight', scale, tier);
    // The six armor pieces share what four used to carry, so a full outfit stays in balance.
    case 'helmet':
      if (variant === 1) return { armor: 2 * scale, maxHp: 6 * life, cooldownReduction: 2 + tier * 0.4 };
      if (variant === 2) return { armor: 2.5 * scale, maxHp: 6 * life, critChance: 1 + tier * 0.3 };
      return { armor: 3 * scale, maxHp: 8 * life };
    case 'shoulders':
      if (variant === 1) return { armor: 1.5 * scale, maxHp: 4 * life, skillDamage: 3 + tier * 0.8 };
      if (variant === 2) return { armor: 2 * scale, maxHp: 4 * life, attackPct: 2 + tier * 0.5 };
      return { armor: 2 * scale, maxHp: 6 * life };
    case 'armor':
      if (variant === 1) return { armor: 4 * scale, maxHp: 13 * life, skillDamage: 5 + tier };
      if (variant === 2) return { armor: 5 * scale, maxHp: 12 * life, damageReduction: 1 + tier * 0.3 };
      return { armor: 6 * scale, maxHp: 17 * life };
    case 'gloves':
      if (variant === 1) return { armor: 1.5 * scale, attackSpeed: 3 + tier * 0.5 };
      if (variant === 2) return { armor: 3 * scale, critDamage: 6 + tier };
      return { armor: 2.5 * scale, attack: 1 * scale };
    case 'legs':
      if (variant === 1) return { armor: 2.5 * scale, maxHp: 7 * life, xpBonus: 2 + tier * 0.5 };
      if (variant === 2) return { armor: 3 * scale, maxHp: 7 * life, armorPct: 3 + tier * 0.6 };
      return { armor: 3.5 * scale, maxHp: 10 * life };
    case 'boots':
      if (variant === 1) return { armor: 1.5 * scale, maxHp: 3 * life, goldFind: 5 + tier };
      if (variant === 2) return { armor: 3 * scale, maxHp: 4 * life, hpRegen: 0.4 * life };
      return { armor: 2.5 * scale, maxHp: 5 * life };
    case 'amulet':
      if (variant === 1) return { attack: 1.2 * scale, skillDamage: 4 + tier };
      if (variant === 2) return { maxHpPct: 3 + tier * 0.8, magicFind: 3 + tier };
      return { attack: 1.5 * scale, maxHpPct: 3 + tier * 0.8 };
    case 'ring':
      if (variant === 1) return { attackSpeed: 2 + tier * 0.5 };
      if (variant === 2) return { critDamage: 5 + tier * 1.5 };
      return { critChance: 1.5 + tier * 0.4 };
    case 'trinket':
      if (variant === 1) return { attackPct: 3 + tier * 0.8 };
      if (variant === 2) return { maxHpPct: 3 + tier * 0.8, armorPct: 3 + tier * 0.6 };
      return { goldFind: 6 + tier * 1.5, magicFind: 3 + tier };
  }
}

// ---------------------------------------------------------------------------
// Affixes.

type AffixRule = { stat: StatId; slots: Slot[]; weight: number } & (
  | { kind: 'flat'; base: number; exponent: number }
  | { kind: 'pct'; min: number; max: number }
);

export const AFFIXES: AffixRule[] = [
  { stat: 'attack', slots: ['weapon', 'offhand', 'gloves', 'ring', 'amulet', 'trinket'], weight: 10, kind: 'flat', base: 2.5, exponent: 0.95 },
  { stat: 'attackPct', slots: ['weapon', 'offhand', 'gloves', 'shoulders', 'ring', 'amulet', 'trinket'], weight: 9, kind: 'pct', min: 3, max: 10 },
  { stat: 'armor', slots: ['offhand', 'helmet', 'shoulders', 'armor', 'gloves', 'legs', 'boots'], weight: 10, kind: 'flat', base: 2.2, exponent: 0.95 },
  { stat: 'armorPct', slots: ['offhand', 'helmet', 'shoulders', 'armor', 'legs', 'boots'], weight: 8, kind: 'pct', min: 4, max: 12 },
  { stat: 'maxHp', slots: ['helmet', 'shoulders', 'armor', 'legs', 'boots', 'amulet'], weight: 10, kind: 'flat', base: 9, exponent: 0.9 },
  { stat: 'maxHpPct', slots: ['offhand', 'helmet', 'shoulders', 'armor', 'legs', 'boots', 'amulet', 'trinket'], weight: 8, kind: 'pct', min: 3, max: 10 },
  { stat: 'attackSpeed', slots: ['weapon', 'offhand', 'gloves', 'ring', 'trinket'], weight: 7, kind: 'pct', min: 2, max: 8 },
  { stat: 'critChance', slots: ['weapon', 'offhand', 'gloves', 'ring', 'amulet', 'helmet', 'trinket'], weight: 7, kind: 'pct', min: 1, max: 5 },
  { stat: 'critDamage', slots: ['weapon', 'amulet', 'ring', 'gloves', 'shoulders', 'trinket'], weight: 7, kind: 'pct', min: 6, max: 25 },
  { stat: 'cooldownReduction', slots: ['offhand', 'helmet', 'shoulders', 'amulet', 'gloves', 'trinket'], weight: 5, kind: 'pct', min: 2, max: 7 },
  { stat: 'skillDamage', slots: ['weapon', 'offhand', 'helmet', 'shoulders', 'amulet', 'trinket'], weight: 6, kind: 'pct', min: 4, max: 18 },
  { stat: 'bossDamage', slots: ['weapon', 'offhand', 'ring', 'gloves', 'trinket'], weight: 5, kind: 'pct', min: 4, max: 18 },
  { stat: 'damageReduction', slots: ['offhand', 'armor', 'legs', 'boots', 'helmet', 'shoulders'], weight: 5, kind: 'pct', min: 1, max: 5 },
  { stat: 'hpRegen', slots: ['armor', 'legs', 'amulet', 'ring', 'boots', 'trinket'], weight: 5, kind: 'flat', base: 0.5, exponent: 0.9 },
  { stat: 'lifeSteal', slots: ['weapon', 'ring', 'gloves', 'trinket'], weight: 4, kind: 'pct', min: 0.5, max: 2.5 },
  { stat: 'goldFind', slots: ['boots', 'legs', 'ring', 'amulet', 'helmet', 'trinket'], weight: 6, kind: 'pct', min: 5, max: 22 },
  { stat: 'magicFind', slots: ['boots', 'legs', 'ring', 'amulet', 'helmet', 'trinket'], weight: 5, kind: 'pct', min: 4, max: 18 },
  { stat: 'xpBonus', slots: ['helmet', 'shoulders', 'amulet', 'armor', 'legs', 'trinket'], weight: 5, kind: 'pct', min: 3, max: 12 },
];

function round(value: number, step: number): number {
  return Math.round(value / step) * step;
}

/**
 * A full armory has thirteen pieces where the first design had seven: every
 * affix rolls at this share of its old size, so a hero dressed head to toe
 * stays on the power curve the monsters were tuned for.
 */
export const AFFIX_SCALE = 0.55;

function rollAffixValue(rule: AffixRule, level: number, rarity: Rarity, roll: number): number {
  const tier = rarityIndex(rarity);
  if (rule.kind === 'flat') {
    const value = rule.base * power(level) ** rule.exponent * (0.8 + 0.4 * roll) * (1 + 0.1 * tier) * AFFIX_SCALE;
    return value >= 20 ? Math.round(value) : round(value, 0.1);
  }
  return round((rule.min + (rule.max - rule.min) * roll) * (1 + 0.12 * tier) * AFFIX_SCALE, 0.1);
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

// Gem qualities: gems drop Chipped, Flawed or Normal by region level, and
// the cube fuses three of a quality into one of the next.

export type GemQuality = 1 | 2 | 3 | 4 | 5;
export const GEM_QUALITIES: GemQuality[] = [1, 2, 3, 4, 5];
export const NORMAL_GEM_QUALITY: GemQuality = 3;
export const GEM_QUALITY_FACTOR: Record<GemQuality, number> = { 1: 0.5, 2: 0.75, 3: 1, 4: 1.5, 5: 2.2 };

export function isGem(material: MaterialId): boolean {
  return MATERIALS[material].socket === 'decoration';
}

/** How the account keeps a material: the id for runes, glyphs and Normal gems; `id:quality` otherwise. */
export function materialKey(material: MaterialId, quality: GemQuality = NORMAL_GEM_QUALITY): string {
  return isGem(material) && quality !== NORMAL_GEM_QUALITY ? `${material}:${quality}` : material;
}

export function parseMaterialKey(key: string): { material: MaterialId; quality: GemQuality } | null {
  const [id, raw] = key.split(':');
  if (!MATERIALS[id as MaterialId]) return null;
  const material = id as MaterialId;
  if (raw === undefined) return { material, quality: NORMAL_GEM_QUALITY };
  const quality = Number(raw) as GemQuality;
  return isGem(material) && GEM_QUALITIES.includes(quality) && quality !== NORMAL_GEM_QUALITY ? { material, quality } : null;
}

/** What a socketed material grants on an item, its quality included. */
export function materialStats(material: MaterialId, quality: GemQuality | undefined, slot: Slot): StatBlock {
  const effects = MATERIALS[material].effects[slotGroup(slot)];
  const factor = isGem(material) ? GEM_QUALITY_FACTOR[quality ?? NORMAL_GEM_QUALITY] : 1;
  return Object.fromEntries(Object.entries(effects).map(([stat, value]) => [stat, Math.round(value * factor * 10) / 10]));
}

/** A dropped gem's quality: better regions yield better cuts, Normal at most. */
export function gemQualityFor(rng: Rng, level: number): GemQuality {
  const roll = rng() + level / 120;
  return roll < 0.55 ? 1 : roll < 1.05 ? 2 : 3;
}

export const GEM_FUSION_INPUTS = 3;

/** Gold the cube charges to fuse three gems of a quality into one of the next. */
export function gemFusionCost(quality: GemQuality): number {
  return 2_000 * 4 ** (quality - 1);
}

/** Which icon draws a material of a quality. */
export function materialIcon(material: MaterialId, quality: GemQuality = NORMAL_GEM_QUALITY): { atlas: string; frame: number } {
  const icon = MATERIALS[material].icon;
  if (!isGem(material) || quality === NORMAL_GEM_QUALITY) return { atlas: 'icons-materials', frame: icon };
  if (quality === 1) return { atlas: 'icons-gems-1', frame: icon };
  if (quality === 2) return { atlas: 'icons-gems-1', frame: 6 + icon };
  if (quality === 4) return { atlas: 'icons-gems-2', frame: icon };
  return { atlas: 'icons-gems-2', frame: 6 + icon };
}

// ---------------------------------------------------------------------------

const SLOT_WEIGHTS: Record<Slot, number> = {
  weapon: 18, offhand: 12, helmet: 10, shoulders: 9, armor: 10, gloves: 9, legs: 9, boots: 9, amulet: 9, ring: 12, trinket: 10,
};

export type RollOptions = {
  level: number;
  rarity: Rarity;
  slot?: Slot;
  classId?: HeroClassId | null;
  variant?: BaseVariant;
  /** Roll this unique (its slot and class follow). */
  uniqueId?: UniqueId;
  /** Roll a piece of this set (with `slot` among its pieces). */
  setId?: SetId;
  /** Classes in the party: weapons favor them. */
  partyClasses?: HeroClassId[];
};

/** A new item: base, affixes and empty sockets. */
export function rollItem(rng: Rng, options: RollOptions): ItemData {
  const level = Math.max(1, Math.min(MAX_REGION_LEVEL, Math.round(options.level)));
  const unique = options.uniqueId ? UNIQUES[options.uniqueId] : null;
  const set = options.setId ? SETS[options.setId] : null;
  const slot = unique?.slot
    ?? (set ? (options.slot && SET_PIECES.includes(options.slot) ? options.slot : SET_PIECES[Math.floor(rng() * SET_PIECES.length)]) : null)
    ?? options.slot
    ?? pickWeighted(rng, SLOTS.map((candidate) => ({ candidate, weight: SLOT_WEIGHTS[candidate] }))).candidate;
  let classId: HeroClassId | null = null;
  if (unique) classId = unique.classId;
  else if (classSlot(slot)) {
    const party = options.partyClasses?.length ? options.partyClasses : HERO_CLASS_IDS;
    classId = options.classId ?? (rng() < 0.75 ? party[Math.floor(rng() * party.length)] : HERO_CLASS_IDS[Math.floor(rng() * HERO_CLASS_IDS.length)]);
  }
  // Uniques, set pieces and off hands have their own look; everything else picks a variant.
  const variant: BaseVariant = unique || set || slot === 'offhand' ? 0 : options.variant ?? (Math.floor(rng() * 3) as BaseVariant);
  const rules = RARITY_RULES[options.rarity];
  const pool = AFFIXES.filter((rule) => rule.slots.includes(slot));
  const affixes: ItemAffix[] = [];
  for (let index = 0; index < rules.affixes && pool.length; index += 1) {
    const rule = pickWeighted(rng, pool);
    pool.splice(pool.indexOf(rule), 1);
    affixes.push({ stat: rule.stat, value: rollAffixValue(rule, level, options.rarity, rng()) });
  }
  const item: ItemData = { slot, classId, rarity: options.rarity, level, affixes, sockets: rules.sockets.map((kind) => ({ kind, material: null })) };
  if (variant) item.variant = variant;
  if (unique) item.uniqueId = unique.id;
  if (set) item.setId = set.id;
  return item;
}

/** Everything an item gives its wearer (set bonuses come from the whole outfit, see build.ts). */
export function itemStats(item: ItemData): StatBlock {
  const affixes: StatBlock = {};
  for (const affix of item.affixes) affixes[affix.stat] = (affixes[affix.stat] ?? 0) + affix.value;
  const sockets = item.sockets
    .filter((socket) => socket.material)
    .map((socket) => materialStats(socket.material!, socket.quality, item.slot));
  const unique = item.uniqueId && UNIQUES[item.uniqueId] ? uniqueStats(item.uniqueId, rarityIndex(item.rarity)) : {};
  return addStats(implicitStats(item), affixes, unique, ...sockets);
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
  const special = item.uniqueId ? 60 : item.setId ? 40 : 0;
  return Math.round(item.level * RARITY_RULES[item.rarity].multiplier * 10 + item.affixes.length * 5 + item.sockets.filter((socket) => socket.material).length * 8 + special);
}

export function canEquip(item: Pick<ItemData, 'slot' | 'classId' | 'level' | 'setId'>, hero: { classId: HeroClassId; level: number }): 'ok' | 'class' | 'level' {
  if (classSlot(item.slot) && item.classId && item.classId !== hero.classId) return 'class';
  // Set pieces are cut for their class.
  if (item.setId && SETS[item.setId] && SETS[item.setId].classId !== hero.classId) return 'class';
  if (item.level > hero.level + EQUIP_LEVEL_MARGIN) return 'level';
  return 'ok';
}

/** Atlas of the original slots' two extra variants: row 0 is variant 1, row 1 variant 2. */
const VARIANT_ATLAS: Partial<Record<Slot, string>> = {
  helmet: 'icons-helmets-v', armor: 'icons-armors-v', gloves: 'icons-gloves-v', boots: 'icons-boots-v', amulet: 'icons-amulets-v', ring: 'icons-rings-v',
};

/** Off hands: two classes per sheet, one row each. */
const OFFHAND_ICONS: Record<HeroClassId, [string, number]> = {
  knight: ['icons-offhands-1', 0], ranger: ['icons-offhands-1', 1],
  sorceress: ['icons-offhands-2', 0], cleric: ['icons-offhands-2', 1],
  artificer: ['icons-offhands-3', 0], maestro: ['icons-offhands-3', 1],
};

/** Which icon atlas and frame draws an item. */
export function itemIcon(item: Pick<ItemData, 'slot' | 'classId' | 'level' | 'variant' | 'uniqueId' | 'setId'>): { atlas: string; frame: number } {
  if (item.uniqueId && UNIQUES[item.uniqueId]) return UNIQUES[item.uniqueId].icon;
  if (item.setId && SETS[item.setId]) {
    const set = SETS[item.setId];
    return { atlas: set.icon.atlas, frame: set.icon.row * 6 + Math.max(0, SET_PIECES.indexOf(item.slot)) };
  }
  const tier = baseTier(item.level);
  const variant = item.variant ?? 0;
  switch (item.slot) {
    case 'offhand': {
      const [atlas, row] = OFFHAND_ICONS[item.classId ?? 'knight'];
      return { atlas, frame: row * 6 + tier };
    }
    // Shoulders and legs share a sheet per variant: shoulders above, legs below.
    case 'shoulders': return { atlas: `icons-shoulders-legs-${variant + 1}`, frame: tier };
    case 'legs': return { atlas: `icons-shoulders-legs-${variant + 1}`, frame: 6 + tier };
    case 'trinket': return variant === 2 ? { atlas: 'icons-trinkets-2', frame: tier } : { atlas: 'icons-trinkets-1', frame: variant * 6 + tier };
  }
  if (variant) {
    const atlas = item.slot === 'weapon' ? `icons-weapons-v-${item.classId ?? 'knight'}` : VARIANT_ATLAS[item.slot]!;
    return { atlas, frame: (variant - 1) * 6 + tier };
  }
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
    default: return { atlas: 'icons-jewelry', frame: 6 + tier };
  }
}

/** Translation key of an item's base name (`slot.tier` or `weapon-class.tier`, then `.variant` for the extra variants). */
export function itemBaseKey(item: Pick<ItemData, 'slot' | 'classId' | 'level' | 'variant'>): string {
  const tier = baseTier(item.level);
  const base = classSlot(item.slot) ? `${item.slot}-${item.classId ?? 'knight'}.${tier}` : `${item.slot}.${tier}`;
  return item.variant ? `${base}.${item.variant}` : base;
}
