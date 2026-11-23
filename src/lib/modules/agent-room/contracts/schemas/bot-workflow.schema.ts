import { z } from 'zod/v3';

/** Fixed owner-approved plan. Customer messages never choose targets or rules. */
export const botWorkflowSchema = z.object({
  trigger: z.string().trim().min(1).max(40).regex(/^\/[\p{L}\p{N}_-]+$/u),
  acknowledgment: z.string().trim().min(1).max(500),
  steps: z.array(z.object({
    nodeId: z.string().uuid(),
    instructions: z.string().trim().min(1).max(6000),
  }).strict()).min(1).max(8),
}).strict();
export type BotWorkflow = z.infer<typeof botWorkflowSchema>;
export type BotWorkflowState = 'queued' | 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled';
export const botWorkflowProgressSchema = z.object({ id: z.string().uuid(), state: z.enum(['queued', 'running', 'waiting', 'completed', 'failed', 'cancelled']), index: z.number().int().min(0).max(8), total: z.number().int().min(1).max(8), taskIds: z.array(z.string().uuid()).max(8) }).strict();
export type BotWorkflowProgress = z.infer<typeof botWorkflowProgressSchema>;
