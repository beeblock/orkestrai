import { z } from 'zod/v3';

export const listWorkspaceMemorySchema = z.object({
  query: z.string().max(500).default(''),
  history: z.enum(['0', '1']).default('0'),
  nodeId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

export const workspaceMemoryKindSchema = z.enum(['decision', 'fact', 'preference', 'constraint', 'reference', 'lesson']);
export const workspaceMemorySourceTypeSchema = z.enum(['user', 'note', 'task', 'message', 'file', 'url', 'git', 'review', 'council', 'agent']);

export const workspaceMemorySourceSchema = z.object({
  type: workspaceMemorySourceTypeSchema,
  sourceId: z.string().trim().max(240).nullish(),
  label: z.string().trim().min(1).max(240),
  uri: z.string().trim().max(2_048).nullish(),
  excerpt: z.string().trim().max(4_000).nullish(),
  metadata: z.record(z.string(), z.unknown()).optional(),
}).strict();

export const saveWorkspaceMemorySchema = z.object({
  title: z.string().trim().min(1).max(160),
  content: z.string().trim().min(1).max(12_000),
  kind: workspaceMemoryKindSchema,
  confidence: z.number().int().min(0).max(100).default(100),
  pinned: z.boolean().default(false),
  tags: z.array(z.string().trim().min(1).max(48)).max(12).default([]),
  createdByNodeId: z.string().uuid().nullish(),
  sources: z.array(workspaceMemorySourceSchema).min(1).max(8),
}).strict();

export const reviseWorkspaceMemorySchema = saveWorkspaceMemorySchema.extend({
  baseUpdatedAt: z.string().datetime(),
  baseRevision: z.number().int().min(1),
}).strict();

export type SaveWorkspaceMemoryInput = z.infer<typeof saveWorkspaceMemorySchema>;
export type ReviseWorkspaceMemoryInput = z.infer<typeof reviseWorkspaceMemorySchema>;
