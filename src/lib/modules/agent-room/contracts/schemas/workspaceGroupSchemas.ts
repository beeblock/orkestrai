import { z } from 'zod/v3';

export const createWorkspaceGroupSchema = z.object({
  name: z.string().trim().min(1).max(80),
  parentId: z.string().trim().uuid().nullish(),
});

export const updateWorkspaceGroupSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  parentId: z.string().trim().uuid().nullish(),
  collapsed: z.boolean().optional(),
});

export const moveWorkspaceSchema = z.object({
  groupId: z.string().trim().uuid().nullish(),
});

export type CreateWorkspaceGroupInput = z.infer<typeof createWorkspaceGroupSchema>;
export type UpdateWorkspaceGroupInput = z.infer<typeof updateWorkspaceGroupSchema>;
export type MoveWorkspaceInput = z.infer<typeof moveWorkspaceSchema>;
