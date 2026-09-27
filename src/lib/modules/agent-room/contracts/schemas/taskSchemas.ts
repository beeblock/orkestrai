import { z } from 'zod';
import { MAX_WORKSPACE_ATTACHMENTS, workspaceAttachmentSchema } from './workspaceAttachmentSchemas.js';

export const createBoardTaskSchema = z.object({
  title: z.string().trim().min(1, 'Informe o titulo da tarefa.'),
  description: z.string().trim().nullish(),
  images: z.array(z.string().trim().min(1)).max(6).optional(),
  attachments: z.array(workspaceAttachmentSchema).max(MAX_WORKSPACE_ATTACHMENTS).optional(),
  assigneeNodeId: z.string().trim().nullish(),
  noteId: z.string().trim().nullish(),
  createdBy: z.string().trim().optional(),
  status: z.string().trim().min(1).max(48).optional(),
});

export const updateBoardTaskSchema = z.object({
  title: z.string().trim().min(1).optional(),
  description: z.string().trim().nullish(),
  status: z.string().trim().min(1).max(48).optional(),
  assigneeNodeId: z.string().trim().nullish(),
  imagePath: z.string().trim().nullish(),
  noteId: z.string().trim().nullish(),
});

export const bridgeBoardTaskSchema = z.object({
  leaderWork: z.enum(['coordination', 'review']).optional(),
  token: z.string().trim().min(1).nullish(),
  title: z.string().trim().min(1, 'Informe o titulo da tarefa.'),
  description: z.string().trim().nullish(),
  assignee: z.string().trim().nullish(),
  note: z.string().trim().nullish(),
  from: z.string().trim().nullish(),
  status: z.string().trim().min(1).max(48).optional(),
});

export const bridgeBoardTaskUpdateSchema = z.object({
  leaderWork: z.enum(['coordination', 'review']).optional(),
  token: z.string().trim().min(1).nullish(),
  status: z.string().trim().min(1).max(48).optional(),
  description: z.string().trim().nullish(),
  assignee: z.string().trim().nullish(),
  note: z.string().trim().nullish(),
  from: z.string().trim().nullish(),
});

export const createBoardColumnSchema = z.object({
  name: z.string().trim().min(1).max(48),
  color: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
});

export const updateBoardColumnSchema = z.object({
  name: z.string().trim().min(1).max(48).optional(),
  color: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
  position: z.coerce.number().int().min(0).optional(),
});

export type CreateBoardTaskInput = z.infer<typeof createBoardTaskSchema>;
export type UpdateBoardTaskInput = z.infer<typeof updateBoardTaskSchema>;
export type BridgeBoardTaskInput = z.infer<typeof bridgeBoardTaskSchema>;
export type BridgeBoardTaskUpdateInput = z.infer<typeof bridgeBoardTaskUpdateSchema>;
