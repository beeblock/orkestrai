import { z } from 'zod';

export const agentRuntimeModeSchema = z.enum(['interactive', 'on_demand', 'persistent']);

export const updateAgentRuntimeSchema = z.object({
  mode: agentRuntimeModeSchema,
  idleMinutes: z.number().int().min(5).max(720),
  concurrency: z.number().int().min(1).max(8),
  usageLimit: z.number().int().min(50).max(100),
});

export const agentRuntimeActionSchema = z.object({
  action: z.enum(['wake', 'sleep']),
});

export const agentRuntimeSchema = updateAgentRuntimeSchema.extend({
  workspaceId: z.string().uuid(),
  nodeId: z.string().uuid(),
  sessionId: z.string().uuid().nullable(),
  state: z.enum(['awake', 'sleeping', 'starting', 'blocked', 'error']),
  lastActivityAt: z.string().datetime().nullable(),
  lastWakeAt: z.string().datetime().nullable(),
  lastSleepAt: z.string().datetime().nullable(),
  lastError: z.string().nullable(),
  activeRuns: z.number().int().nonnegative(),
});

export type AgentRuntimeData = z.infer<typeof agentRuntimeSchema>;
export type UpdateAgentRuntimeInput = z.infer<typeof updateAgentRuntimeSchema>;
export type AgentRuntimeActionInput = z.infer<typeof agentRuntimeActionSchema>;
