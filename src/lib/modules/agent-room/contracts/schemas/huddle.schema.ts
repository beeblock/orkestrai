import { z } from 'zod/v3';

function nodeIds(max: number) {
  return z
    .array(z.string().uuid())
    .min(1)
    .max(max)
    .transform((values) => [...new Set(values)]);
}

export const createHuddleSchema = z
  .object({
    title: z.string().trim().min(1).max(160),
    agenda: z.string().trim().max(8_000).nullable().optional(),
    agentNodeIds: nodeIds(11),
    facilitatorNodeId: z.string().uuid().nullable().optional(),
  })
  .strict();

export const updateHuddleSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('add_agents'), agentNodeIds: nodeIds(12) }).strict(),
  z.object({ operation: z.literal('end') }).strict(),
]);

export const submitHuddleTurnSchema = z
  .object({
    text: z.string().trim().min(1).max(10_000),
    targetNodeIds: z
      .array(z.string().uuid())
      .min(1)
      .max(5)
      .transform((values) => [...new Set(values)]),
  })
  .strict();

export const contributeHuddleTurnSchema = z
  .object({
    text: z.string().trim().min(1).max(10_000),
  })
  .strict();

export const createHuddleTaskSchema = z
  .object({
    title: z.string().trim().min(1).max(180),
    status: z.string().trim().min(1).max(80).optional(),
  })
  .strict();

export type CreateHuddleInput = z.infer<typeof createHuddleSchema>;
export type UpdateHuddleInput = z.infer<typeof updateHuddleSchema>;
export type SubmitHuddleTurnInput = z.infer<typeof submitHuddleTurnSchema>;
export type ContributeHuddleTurnInput = z.infer<typeof contributeHuddleTurnSchema>;
export type CreateHuddleTaskInput = z.infer<typeof createHuddleTaskSchema>;
