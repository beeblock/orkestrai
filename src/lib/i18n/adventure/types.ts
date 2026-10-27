import type { ElixirId, PowerId, SetId, UniqueId } from '$lib/modules/agent-room/domain/adventure/artifacts.js';
import type { CubeFunction } from '$lib/modules/agent-room/domain/adventure/cube.js';
import type { MaterialId, Rarity, Slot, SocketKind } from '$lib/modules/agent-room/domain/adventure/items.js';
import type { ChestTier } from '$lib/modules/agent-room/domain/adventure/loot.js';
import type { PetId } from '$lib/modules/agent-room/domain/adventure/pets.js';
import type { RuneBranch, RuneRule } from '$lib/modules/agent-room/domain/adventure/runes.js';
import type { ActiveAction } from '$lib/modules/agent-room/domain/adventure/skills.js';
import type { StatId } from '$lib/modules/agent-room/domain/adventure/stats.js';
import type { Difficulty } from '$lib/modules/agent-room/domain/adventure/world.js';

/**
 * The Adventure's game content in one language: names of gear, skills,
 * runes, pets and materials, and the sentences that describe effects. Effect
 * numbers come from the rules, so descriptions are templates with {value}.
 */
export type AdventureCatalog = {
  rarities: Record<Rarity, string>;
  slots: Record<Slot, string>;
  /** Stat names; percentages and flat values share a name. */
  stats: Record<StatId, string>;
  /** `slot.tier`, `weapon-class.tier` or `offhand-class.tier` (tiers 0..5), plus `.1` and `.2` for the extra variants. */
  bases: Record<string, string>;
  uniques: Record<UniqueId, string>;
  sets: Record<SetId, string>;
  /** Set piece names by `set.slot`. */
  setPieces: Record<string, string>;
  /** What each unique or set power does in battle. */
  powers: Record<PowerId, string>;
  materials: Record<MaterialId, string>;
  /** A gem's name at each quality; {gem} is the gem. */
  gemQualities: Record<'1' | '2' | '3' | '4' | '5', string>;
  elixirs: Record<ElixirId, string>;
  sockets: Record<SocketKind, string>;
  chests: Record<ChestTier, string>;
  difficulties: Record<Difficulty, string>;
  outfits: Record<'1' | '2' | '3' | '4', string>;
  /** Skill node names by id (`class.name`). */
  skills: Record<string, string>;
  /** What an active does; {value} is its power for the current rank. */
  actives: Record<ActiveAction, string>;
  runes: Record<string, string>;
  runeBranches: Record<RuneBranch, string>;
  /** Rule effects of runes; {value} is the total for the rank. */
  runeRules: Record<RuneRule, string>;
  pets: Record<PetId, string>;
  cube: Record<CubeFunction, { name: string; description: string }>;
  /** Refusals from the rules, by error code. */
  errors: Record<string, string>;
  /** Loot log lines. Placeholders: {hero}, {item}, {level}, {stage}, {monster}, {pet}, {title}, {minutes}, {gold}. */
  journal: Record<'item' | 'level' | 'paragon' | 'recruit' | 'inherited' | 'stageClear' | 'stageFail' | 'boss' | 'pet' | 'quest' | 'offline' | 'equip' | 'salvage', string>;
  itemSources: Record<'white' | 'blue' | 'red' | 'quest' | 'synthesis' | 'crafting' | 'offering' | 'starter', string>;
};
