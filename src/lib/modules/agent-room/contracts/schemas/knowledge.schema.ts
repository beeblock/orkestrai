import { z } from 'zod';

export const knowledgeCommandSchema = z.discriminatedUnion('command', [
  z.object({ command: z.literal('create'), title: z.string().trim().min(1).max(180).default('Second Brain'), x: z.number().finite().optional(), y: z.number().finite().optional(), floorId: z.string().uuid().nullable().optional() }).strict(),
  z.object({ command: z.literal('attach'), path: z.string().trim().min(1).max(1024), title: z.string().trim().min(1).max(180).optional(), x: z.number().finite().optional(), y: z.number().finite().optional(), floorId: z.string().uuid().nullable().optional() }).strict(),
  z.object({ command: z.literal('refresh') }).strict(),
  z.object({ command: z.literal('tags'), nodeId: z.string().uuid(), tags: z.array(z.string().trim().min(1).max(48)).max(24) }).strict(),
]);
export const knowledgeQuerySchema = z.object({
  query: z.string().max(500).default(''), kind: z.enum(['note', 'file', 'task', 'memory', 'image', 'design', 'codeGraph']).optional(),
  tag: z.string().max(48).optional(), limit: z.coerce.number().int().min(1).max(300).default(150),
});
export type KnowledgeCommand = z.infer<typeof knowledgeCommandSchema>;
export type KnowledgeQuery = z.infer<typeof knowledgeQuerySchema>;
export const knowledgeUploadSchema = z.object({
  file: z.custom<File>(value => typeof File !== 'undefined' && value instanceof File && value.size > 0 && value.size <= 25 * 1024 * 1024),
  x: z.coerce.number().finite().optional(), y: z.coerce.number().finite().optional(),
  floorId: z.preprocess(value => value === '' ? null : value, z.string().uuid().nullable().optional()),
});
