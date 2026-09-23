import { z } from 'zod';
const identity = { nodeId: z.string().uuid() };
export const agentLearningCommandSchema = z.discriminatedUnion('command', [
  z.object({ command: z.literal('reflect'), ...identity, taskId: z.string().uuid(), title: z.string().trim().min(3).max(160), trigger: z.string().trim().min(8).max(1000), mistake: z.string().trim().max(2000).default(''), correction: z.string().trim().min(12).max(4000), evidence: z.string().trim().min(12).max(4000) }).strict(),
  z.object({ command: z.literal('decide'), ...identity, id: z.string().uuid(), revision: z.number().int().positive(), status: z.enum(['active', 'rejected', 'archived']) }).strict(),
  z.object({ command: z.literal('configure'), ...identity, mode: z.enum(['automatic', 'review', 'off']) }).strict(),
  z.object({ command: z.literal('skip'), ...identity, id: z.string().uuid(), revision: z.number().int().positive() }).strict(),
]);
export type AgentLearningCommand = z.infer<typeof agentLearningCommandSchema>;
