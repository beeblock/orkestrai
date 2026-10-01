import { z } from 'zod';

// Schemas de andares, hooks e rotinas — compartilhados backend/frontend.

export const createFloorSchema = z.object({
  name: z.string().trim().min(1, 'Informe o nome do andar.'),
  branch: z.string().trim().optional(),
  existingBranch: z.boolean().default(false),
  cloneLayout: z.boolean().default(false),
});

export const renameFloorSchema = z.object({ name: z.string().trim().min(1) });
export const landFloorSchema = z.object({ targetBranch: z.string().trim().optional() });

export const cleanupFloorsSchema = z.object({
  from: z.string().trim().min(1).max(120),
  taskId: z.string().uuid(),
  entries: z.array(z.object({ floorId: z.string().uuid(), revision: z.string().regex(/^[a-f0-9]{64}$/) })).min(1).max(100),
});

export const hooksSchema = z.object({
  setup: z.array(z.object({ command: z.string() })).optional(),
  run: z.array(z.object({ command: z.string() })).optional(),
  teardown: z.array(z.object({ command: z.string() })).optional(),
  autoRunSetup: z.boolean().optional(),
});

export const runHooksSchema = z.object({ kind: z.enum(['setup', 'run', 'teardown']) });

export const createRoutineSchema = z.object({
  targetNodeId: z.string().trim().min(1, 'Informe o terminal alvo.'),
  prompt: z.string().min(1, 'Informe o prompt da rotina.'),
  intervalMinutes: z.coerce.number().int().min(1).nullish(),
});

export const routineEnabledSchema = z.object({ enabled: z.boolean() });

export const updateRoutineSchema = z.object({
  targetNodeId: z.string().trim().min(1).optional(),
  prompt: z.string().min(1, 'Informe o prompt da rotina.').optional(),
  intervalMinutes: z.coerce.number().int().min(1).nullish(),
});

export type CreateFloorInput = z.infer<typeof createFloorSchema>;
export type CreateRoutineInput = z.infer<typeof createRoutineSchema>;
export type HooksInput = z.infer<typeof hooksSchema>;
