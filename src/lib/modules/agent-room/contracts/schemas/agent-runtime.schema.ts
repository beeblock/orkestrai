import { z } from 'zod/v3';

export const agentUsageBlockSchema = z.object({
  provider: z.string().min(1).max(60), profileId: z.string().uuid().nullable(),
  usedPercent: z.number().int().min(0).max(100), limit: z.number().int().min(50).max(100),
  window: z.enum(['5h', 'weekly', 'monthly']), resetsAt: z.string().max(80).nullable(),
});
export type AgentUsageBlock = z.infer<typeof agentUsageBlockSchema>;

export const agentRuntimeModeSchema = z.enum(['interactive', 'on_demand', 'persistent']);

export const updateAgentRuntimeSchema = z.object({
  transport: z.enum(['terminal', 'structured']).optional(),
  mode: agentRuntimeModeSchema,
  idleMinutes: z.number().int().min(5).max(720),
  concurrency: z.number().int().min(1).max(8),
  usageLimit: z.number().int().min(50).max(100),
});

export const agentRuntimeActionSchema = z.object({
  action: z.enum(['wake', 'sleep']),
});

export const agentRuntimeSchema = updateAgentRuntimeSchema.extend({
  transport: z.enum(['terminal', 'structured']).default('terminal'),
  structuredAvailable: z.boolean().default(false),
  workspaceId: z.string().uuid(),
  nodeId: z.string().uuid(),
  sessionId: z.string().uuid().nullable(),
  state: z.enum(['awake', 'sleeping', 'starting', 'blocked', 'error']),
  lastActivityAt: z.string().datetime().nullable(),
  lastWakeAt: z.string().datetime().nullable(),
  lastSleepAt: z.string().datetime().nullable(),
  lastError: z.string().nullable(),
  usageBlock: agentUsageBlockSchema.nullable().optional(),
  activeRuns: z.number().int().nonnegative(),
});

export type AgentRuntimeData = z.infer<typeof agentRuntimeSchema>;
export type UpdateAgentRuntimeInput = z.infer<typeof updateAgentRuntimeSchema>;
export type AgentRuntimeActionInput = z.infer<typeof agentRuntimeActionSchema>;
