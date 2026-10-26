import { z } from 'zod';
import { MONSTERS, TEAMMATE_CLASS_IDS, HERO_CLASS_IDS, type HeroClassId, type MonsterId } from '../../domain/adventure/catalog.js';
import { ELIXIR_IDS, type ElixirId } from '../../domain/adventure/artifacts.js';
import { MATERIAL_IDS, MATERIALS, SLOTS, type MaterialId, type Slot } from '../../domain/adventure/items.js';
import { CHEST_TIERS, type ChestTier } from '../../domain/adventure/loot.js';
import { PETS, type PetId } from '../../domain/adventure/pets.js';
import { RUNES } from '../../domain/adventure/runes.js';
import { ACT_COUNT, DIFFICULTIES, MAX_REGION_LEVEL, STAGES_PER_ACT, WAVES_PER_STAGE, type Difficulty } from '../../domain/adventure/world.js';

const tuple = <T extends string>(values: readonly T[]) => values as unknown as [T, ...T[]];

const id = z.string().min(1).max(64);
const amount = z.number().finite().min(0).max(1e12);
const difficulty = z.enum(tuple<Difficulty>(DIFFICULTIES));
const act = z.number().int().min(1).max(ACT_COUNT);
const stage = z.number().int().min(1).max(STAGES_PER_ACT);
const monster = z.enum(tuple(Object.keys(MONSTERS) as MonsterId[]));
const position = z.object({ difficulty, act, stage });

/** What the battle on a screen produced since its last report; experience is by hero id. */
export const adventureReportSchema = z.object({
  reportId: z.string().min(1).max(80),
  elapsedMs: z.number().int().min(0).max(3_600_000),
  position,
  wave: z.number().int().min(0).max(WAVES_PER_STAGE - 1),
  xp: z.record(id, amount).refine((value) => Object.keys(value).length <= 64),
  gold: amount,
  // Only the monsters that fell are listed (Zod 4 records over an enum require every key).
  kills: z.partialRecord(monster, z.number().int().min(0).max(100_000)),
  chests: z.array(z.object({ tier: z.enum(tuple<ChestTier>(CHEST_TIERS)), level: z.number().int().min(1).max(MAX_REGION_LEVEL), difficulty, act })).max(200),
  bosses: z.array(z.object({ difficulty, act, monsterId: monster })).max(20),
  stages: z.array(position.extend({ result: z.enum(['clear', 'fail']) })).max(50),
});

const itemIds = z.array(id).max(200);
const gems = MATERIAL_IDS.filter((material) => MATERIALS[material].socket === 'decoration');
const gemQuality = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]);

/** Everything the camp can do, one action per request. */
export const adventureActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('open-chests'), ids: z.array(id).max(50).optional(), tier: z.enum(tuple<ChestTier>(CHEST_TIERS)).optional(), limit: z.number().int().min(1).max(50).optional() }),
  // `replaceId`: which of two worn rings or trinkets makes room.
  z.object({ type: z.literal('equip'), itemId: id, heroId: id, replaceId: id.optional() }),
  z.object({ type: z.literal('unequip'), itemId: id }),
  z.object({ type: z.literal('auto-equip'), heroId: id }),
  z.object({ type: z.literal('lock'), itemId: id, locked: z.boolean() }),
  z.object({ type: z.literal('move'), itemId: id, location: z.enum(['inventory', 'stash']) }),
  z.object({ type: z.literal('salvage'), itemIds: itemIds.min(1) }),
  z.object({ type: z.literal('synthesize'), itemIds: z.array(id).length(9) }),
  z.object({ type: z.literal('craft'), slot: z.enum(tuple<Slot>(SLOTS)), level: z.number().int().min(1).max(MAX_REGION_LEVEL), classId: z.enum(tuple<HeroClassId>(HERO_CLASS_IDS)).nullable().optional(), gems: z.array(z.enum(tuple<MaterialId>(MATERIAL_IDS))).length(2) }),
  z.object({ type: z.literal('socket'), itemId: id, socketIndex: z.number().int().min(0).max(8), material: z.enum(tuple<MaterialId>(MATERIAL_IDS)), quality: gemQuality.optional() }),
  z.object({ type: z.literal('fuse-gems'), gem: z.enum(tuple<MaterialId>(gems)), quality: gemQuality }),
  z.object({ type: z.literal('drink'), elixirId: z.enum(tuple<ElixirId>(ELIXIR_IDS)) }),
  z.object({ type: z.literal('unsocket'), itemId: id, socketIndex: z.number().int().min(0).max(8) }),
  z.object({ type: z.literal('offering') }),
  z.object({ type: z.literal('buy-rune'), runeId: z.enum(tuple(RUNES.map((rune) => rune.id))) }),
  z.object({ type: z.literal('raise-skill'), heroId: id, skillId: z.string().min(1).max(80) }),
  z.object({ type: z.literal('reset-skills'), heroId: id }),
  z.object({ type: z.literal('auto-skills'), heroId: id, enabled: z.boolean() }),
  z.object({ type: z.literal('set-actives'), heroId: id, actives: z.array(z.string().min(1).max(80)).max(4) }),
  z.object({ type: z.literal('set-class'), heroId: id, classId: z.enum(tuple<HeroClassId>(TEAMMATE_CLASS_IDS)).nullable() }),
  z.object({ type: z.literal('travel'), difficulty, act, stage }),
  z.object({ type: z.literal('settings'), settings: z.object({ autoAdvance: z.boolean().optional(), autoRetry: z.boolean().optional(), autoOpen: z.boolean().optional() }) }),
  // Hero ids pinned to the formation, in order.
  z.object({ type: z.literal('formation'), order: z.array(id).max(12) }),
  z.object({ type: z.literal('pet'), petId: z.enum(tuple<PetId>(PETS.map((pet) => pet.id))).nullable() }),
  z.object({ type: z.literal('dismiss-offline') }),
]);

export type AdventureReportInput = z.infer<typeof adventureReportSchema>;
export type AdventureAction = z.infer<typeof adventureActionSchema>;
