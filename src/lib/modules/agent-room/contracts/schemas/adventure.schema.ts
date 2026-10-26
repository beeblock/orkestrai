import { z } from 'zod';
import { TEAMMATE_CLASS_IDS, WAVES_PER_STAGE } from '../../domain/adventure/catalog.js';

const count = z.number().int().min(0).max(1_000_000_000);

/** What a screen running the Adventure saves; the server keeps the furthest of what it hears. */
export const saveAdventureProgressSchema = z.object({
  stageIndex: z.number().int().min(0).max(100_000),
  wave: z.number().int().min(0).max(WAVES_PER_STAGE - 1),
  xp: count,
  gold: count,
  kills: count,
  bosses: count,
  quests: count,
});

/** The owner's pick for a teammate's class; null returns it to the one its role suggests. */
export const setAdventureHeroClassSchema = z.object({
  classId: z.enum(TEAMMATE_CLASS_IDS as [string, ...string[]]).nullable(),
});

export type SaveAdventureProgressInput = z.infer<typeof saveAdventureProgressSchema>;
export type SetAdventureHeroClassInput = z.infer<typeof setAdventureHeroClassSchema>;
