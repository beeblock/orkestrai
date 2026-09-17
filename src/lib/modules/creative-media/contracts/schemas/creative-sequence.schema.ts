import { z } from 'zod';
const id = z.string().uuid();
const time = z.number().finite().min(0).max(600);
export const sequenceClipSchema = z.object({
  id, nodeId: id, title: z.string().max(120), path: z.string().min(1).max(1000), sha256: z.string().regex(/^[a-f0-9]{64}$/),
  sourceDuration: time.positive(), width: z.number().int().positive().max(7680), height: z.number().int().positive().max(7680), hasAudio: z.boolean(),
  in: time.default(0), out: time.positive(), volume: z.number().finite().min(0).max(1).default(1), caption: z.string().max(500).default(''),
}).strict().refine(clip => clip.out > clip.in && clip.out <= clip.sourceDuration + 0.05, 'creative_sequence_trim_invalid');
export const sequenceDocumentSchema = z.object({
  schemaVersion: z.literal(1).default(1), title: z.string().trim().min(1).max(120),
  width: z.number().int().min(240).max(1920).refine(value => value % 2 === 0).default(1920),
  height: z.number().int().min(240).max(1920).refine(value => value % 2 === 0).default(1080),
  fps: z.union([z.literal(24), z.literal(25), z.literal(30)]).default(30), clips: z.array(sequenceClipSchema).max(30).default([]),
}).strict().refine(value => new Set(value.clips.map(clip => clip.id)).size === value.clips.length && value.clips.reduce((sum, clip) => sum + clip.out - clip.in, 0) <= 600, 'creative_sequence_limit');
export const sequenceOperationSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('add'), nodeId: id }).strict(),
  z.object({ type: z.literal('update'), clipId: id, patch: z.object({ in: time.optional(), out: time.positive().optional(), volume: z.number().min(0).max(1).optional(), caption: z.string().max(500).optional() }).strict() }).strict(),
  z.object({ type: z.literal('move'), clipId: id, index: z.number().int().min(0).max(29) }).strict(),
  z.object({ type: z.literal('remove'), clipId: id }).strict(),
  z.object({ type: z.literal('settings'), title: z.string().trim().min(1).max(120).optional(), width: z.number().int().min(240).max(1920).optional(), height: z.number().int().min(240).max(1920).optional(), fps: z.union([z.literal(24), z.literal(25), z.literal(30)]).optional() }).strict(),
]);
export const creativeSequenceCommandSchema = z.object({
  command: z.enum(['list', 'read', 'create', 'apply', 'export', 'cancel', 'remove', 'runtime', 'install_runtime']),
  nodeId: id.optional(), revision: z.number().int().positive().optional(), title: z.string().trim().min(1).max(120).optional(),
  nearNodeId: id.optional(), floorId: id.nullable().optional(), operations: z.array(sequenceOperationSchema).min(1).max(60).optional(), idempotencyKey: id.optional(),
}).strict().superRefine((value, ctx) => {
  const required = ['read', 'apply', 'export', 'cancel', 'remove'].includes(value.command) ? ['nodeId'] : value.command === 'create' ? ['title'] : [];
  if (['apply', 'export', 'remove'].includes(value.command)) required.push('revision');
  if (value.command === 'apply') required.push('operations');
  if (value.command === 'export') required.push('idempotencyKey');
  for (const key of required) if (value[key as keyof typeof value] === undefined) ctx.addIssue({ code: 'custom', path: [key], message: 'creative_invalid_input' });
});
export type SequenceDocument = z.infer<typeof sequenceDocumentSchema>;
export type SequenceClip = z.infer<typeof sequenceClipSchema>;
export type SequenceOperation = z.infer<typeof sequenceOperationSchema>;
export type CreativeSequenceCommand = z.infer<typeof creativeSequenceCommandSchema>;
