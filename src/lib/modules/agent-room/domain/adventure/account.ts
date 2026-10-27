import type { HeroClassId, MonsterId } from './catalog.js';
import type { ElixirId } from './artifacts.js';
import type { ItemData, Rarity } from './items.js';
import type { ChestTier } from './loot.js';
import type { PetId } from './pets.js';
import type { RuneRanks } from './runes.js';
import type { SkillRanks } from './skills.js';
import { NO_CLEARS, START_POSITION, type ClearedStages, type Difficulty, type StagePosition } from './world.js';

/**
 * What a workspace's Adventure keeps between sessions: the account (map,
 * wallet, chests, runes, cube, settings), the guild of heroes and the items.
 * Heroes outlive agents: the leader recruits and dismisses agents on demand,
 * and a dismissed agent's hero rests in the guild, with its level, skills and
 * gear, until another agent of its class takes it up. The server owns all of
 * it; the strip only reports what happened in battle.
 */

export type ChestEntry = { id: string; tier: ChestTier; level: number; difficulty: Difficulty; act: number };

export type AdventureSettings = {
  /** Move on to the next stage after clearing one (off: farm the same stage). */
  autoAdvance: boolean;
  /** Retry a failed stage instead of falling back one stage. */
  autoRetry: boolean;
  /** Open chests as they arrive (red ones after an act's first wait for a soulstone). */
  autoOpen: boolean;
  /** Loot from opened chests that no hero puts on is salvaged up to this rarity. */
  autoSalvage: SalvageLevel;
};

/** How far automatic salvage goes: never past Epic. */
export type SalvageLevel = 'off' | 'common' | 'uncommon' | 'rare' | 'epic';
export const SALVAGE_LEVELS: SalvageLevel[] = ['off', 'common', 'uncommon', 'rare', 'epic'];

export const DEFAULT_SETTINGS: AdventureSettings = { autoAdvance: true, autoRetry: false, autoOpen: true, autoSalvage: 'common' };

/** A line of the loot log, newest first. */
export type JournalEntry =
  | { at: string; kind: 'item'; itemId: string; rarity: Rarity; source: ChestTier | 'synthesis' | 'crafting' | 'offering' | 'starter'; heroId?: string | null }
  | { at: string; kind: 'level'; heroId: string; level: number; paragon?: number }
  | { at: string; kind: 'stage'; difficulty: Difficulty; act: number; stage: number; result: 'clear' | 'fail' }
  | { at: string; kind: 'boss'; difficulty: Difficulty; act: number; monsterId: MonsterId }
  | { at: string; kind: 'pet'; petId: PetId }
  | { at: string; kind: 'quest'; title: string; heroId: string | null }
  | { at: string; kind: 'recruit'; heroId: string; agentTitle: string; inherited: boolean }
  | { at: string; kind: 'offline'; minutes: number; gold: number }
  | { at: string; kind: 'equip'; heroId: string; itemId: string; rarity: Rarity }
  | { at: string; kind: 'salvage'; count: number; gold: number };

export const JOURNAL_SIZE = 60;

/** Experience and levels by hero id. */
export type OfflineSummary = { minutes: number; gold: number; xp: Record<string, number>; levels: Record<string, number>; at: string };

export type AdventureAccount = {
  version: 2;
  position: StagePosition;
  cleared: ClearedStages;
  gold: number;
  kills: number;
  bosses: number;
  quests: number;
  killsByMonster: Partial<Record<MonsterId, number>>;
  chests: ChestEntry[];
  soulstones: Record<Difficulty, number>;
  coins: number;
  /** By material key: the id for runes, glyphs and Normal gems, `gem:quality` for the other cuts. */
  materials: Record<string, number>;
  /** Elixirs in the bag, and when the ones drunk run out. */
  elixirs: Partial<Record<ElixirId, number>>;
  activeElixirs: Partial<Record<ElixirId, string>>;
  runes: RuneRanks;
  activePet: PetId | null;
  cube: { level: number; xp: number };
  settings: AdventureSettings;
  /** Heroes (ids) the owner placed in the formation, in order; the rest fill in automatically. */
  formation: string[];
  /** `difficulty:act` pairs whose boss was beaten once: their first red chest is free. */
  firstBossClears: string[];
  /** Kanban cards already paid as quests. */
  rewardedTasks: string[];
  /** Cards finished before this moment are history, not quests. */
  questsSince: string;
  /** The last time a screen reported a battle. */
  lastReportAt: string | null;
  /**
   * Battle time is paid up to this moment. A screen that lost the server
   * sends what was fought meanwhile in several reports; each one is paid in
   * full while the total stays within the time that really passed.
   */
  battleUntil: string | null;
  /** Ids of the latest reports, so a report sent again is never paid twice. */
  recentReports: string[];
  offline: OfflineSummary | null;
  journal: JournalEntry[];
};

/** How many report ids the save remembers: enough for every retry a screen may still send. */
export const REPORT_MEMORY = 32;

export function newAccount(now: string): AdventureAccount {
  return {
    version: 2,
    position: { ...START_POSITION },
    cleared: { ...NO_CLEARS },
    gold: 0,
    kills: 0,
    bosses: 0,
    quests: 0,
    killsByMonster: {},
    chests: [],
    soulstones: { normal: 0, nightmare: 0, hell: 0, torment: 0 },
    coins: 0,
    materials: {},
    elixirs: {},
    activeElixirs: {},
    runes: {},
    activePet: null,
    cube: { level: 1, xp: 0 },
    settings: { ...DEFAULT_SETTINGS },
    formation: [],
    firstBossClears: [],
    rewardedTasks: [],
    questsSince: now,
    lastReportAt: null,
    battleUntil: null,
    recentReports: [],
    offline: null,
    journal: [],
  };
}

export type AdventureHero = {
  id: string;
  /** The hero's own name: agents come and go, the hero stays. */
  name: string;
  /** The class it fights as. */
  classId: HeroClassId;
  /** The owner's pick of class; null keeps the class its first agent's role suggested. */
  chosenClass: HeroClassId | null;
  /** The Maestro: always played by whoever leads the team. */
  leader: boolean;
  /** The agent playing this hero now; null while it rests in the guild. */
  agentNodeId: string | null;
  /** Title of the last agent that played it. */
  agentTitle: string | null;
  level: number;
  /** Levels past the maximum: each adds +1% attack and +1% life. */
  paragon: number;
  xp: number;
  skills: SkillRanks;
  /** Active skills the owner slotted, in order. */
  actives: string[];
  /** Spend new skill points automatically. */
  autoSkills: boolean;
  /** Put on clear upgrades from opened chests by itself. */
  autoGear: boolean;
  kills: number;
};

export function newHero(id: string, name: string, classId: HeroClassId, leader = false): AdventureHero {
  return { id, name, classId, chosenClass: null, leader, agentNodeId: null, agentTitle: null, level: 1, paragon: 0, xp: 0, skills: {}, actives: [], autoSkills: true, autoGear: true, kills: 0 };
}

/** The gear a new hero starts with: a common weapon of its class and a padded tunic. */
export function starterKit(classId: HeroClassId): ItemData[] {
  return [
    { slot: 'weapon', classId, rarity: 'common', level: 1, affixes: [], sockets: [] },
    { slot: 'armor', classId: null, rarity: 'common', level: 1, affixes: [], sockets: [] },
  ];
}
