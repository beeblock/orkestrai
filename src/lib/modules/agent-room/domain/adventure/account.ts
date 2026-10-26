import type { HeroClassId, MonsterId } from './catalog.js';
import type { ItemData, MaterialId, Rarity } from './items.js';
import type { ChestTier } from './loot.js';
import type { PetId } from './pets.js';
import type { RuneRanks } from './runes.js';
import type { SkillRanks } from './skills.js';
import { NO_CLEARS, START_POSITION, type ClearedStages, type Difficulty, type StagePosition } from './world.js';

/**
 * What a workspace's Adventure keeps between sessions: the account (map,
 * wallet, chests, runes, cube, settings), one record per hero (agent) and the
 * items. The server owns it; the strip only reports what happened in battle.
 */

export type ChestEntry = { id: string; tier: ChestTier; level: number; difficulty: Difficulty; act: number };

export type AdventureSettings = {
  /** Move on to the next stage after clearing one (off: farm the same stage). */
  autoAdvance: boolean;
  /** Retry a failed stage instead of falling back one stage. */
  autoRetry: boolean;
  /** Open chests on arrival when the runes allow it. */
  autoOpen: boolean;
};

export const DEFAULT_SETTINGS: AdventureSettings = { autoAdvance: true, autoRetry: false, autoOpen: true };

/** A line of the loot log, newest first. */
export type JournalEntry =
  | { at: string; kind: 'item'; itemId: string; rarity: Rarity; source: ChestTier | 'synthesis' | 'crafting' | 'offering' | 'starter'; heroNodeId?: string | null }
  | { at: string; kind: 'level'; heroNodeId: string; level: number }
  | { at: string; kind: 'stage'; difficulty: Difficulty; act: number; stage: number; result: 'clear' | 'fail' }
  | { at: string; kind: 'boss'; difficulty: Difficulty; act: number; monsterId: MonsterId }
  | { at: string; kind: 'pet'; petId: PetId }
  | { at: string; kind: 'quest'; title: string; heroNodeId: string | null }
  | { at: string; kind: 'offline'; minutes: number; gold: number };

export const JOURNAL_SIZE = 60;

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
  materials: Partial<Record<MaterialId, number>>;
  runes: RuneRanks;
  activePet: PetId | null;
  cube: { level: number; xp: number };
  settings: AdventureSettings;
  /** Heroes the owner placed in the formation, in order; the rest fill in automatically. */
  formation: string[];
  /** `difficulty:act` pairs whose boss was beaten once: their first red chest is free. */
  firstBossClears: string[];
  /** Kanban cards already paid as quests. */
  rewardedTasks: string[];
  /** Cards finished before this moment are history, not quests. */
  questsSince: string;
  lastReportAt: string | null;
  lastReportId: string | null;
  offline: OfflineSummary | null;
  journal: JournalEntry[];
};

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
    runes: {},
    activePet: null,
    cube: { level: 1, xp: 0 },
    settings: { ...DEFAULT_SETTINGS },
    formation: [],
    firstBossClears: [],
    rewardedTasks: [],
    questsSince: now,
    lastReportAt: null,
    lastReportId: null,
    offline: null,
    journal: [],
  };
}

export type AdventureHero = {
  nodeId: string;
  /** The owner's pick of class; null follows the role. */
  chosenClass: HeroClassId | null;
  level: number;
  xp: number;
  skills: SkillRanks;
  /** Active skills the owner slotted, in order. */
  actives: string[];
  /** Spend new skill points automatically. */
  autoSkills: boolean;
  kills: number;
};

export function newHero(nodeId: string, chosenClass: HeroClassId | null = null): AdventureHero {
  return { nodeId, chosenClass, level: 1, xp: 0, skills: {}, actives: [], autoSkills: true, kills: 0 };
}

/** The gear a new hero starts with: a common weapon of its class and a padded tunic. */
export function starterKit(classId: HeroClassId): ItemData[] {
  return [
    { slot: 'weapon', classId, rarity: 'common', level: 1, affixes: [], sockets: [] },
    { slot: 'armor', classId: null, rarity: 'common', level: 1, affixes: [], sockets: [] },
  ];
}
