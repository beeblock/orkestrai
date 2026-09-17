import { z } from 'zod';
import { creativeConfigSchema } from './creative-media.schema.js';
import { shotDirectionSchema } from '../../domain/shot-direction.js';

const id = z.string().uuid();
const ids = (max: number) => z.array(id).max(max).refine(value => new Set(value).size === value.length, 'creative_duplicate_input');
export const storyboardSceneContentSchema = z.object({
  title: z.string().trim().min(1).max(120),
  direction: z.string().trim().max(16000).default(''),
  dialogue: z.string().trim().max(8000).default(''),
  language: z.string().trim().min(2).max(35).default('en-US'),
  duration: z.number().finite().min(1).max(120).default(5),
  aspectRatio: z.enum(['16:9', '9:16', '1:1', '4:3', '3:4']).default('16:9'),
  shot: shotDirectionSchema.default({}),
  characterIds: ids(8).default([]),
  referenceNodeIds: ids(20).default([]),
  executorNodeId: id.nullable().default(null),
}).strict();
export const storyboardSceneSchema = storyboardSceneContentSchema.extend({
  id,
  imageWorkflowNodeId: id.nullable().default(null),
  videoWorkflowNodeId: id.nullable().default(null),
  imageBriefHash: z.string().regex(/^[a-f0-9]{64}$/).nullable().default(null),
  videoBriefHash: z.string().regex(/^[a-f0-9]{64}$/).nullable().default(null),
});
export const storyboardDocumentSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  title: z.string().trim().min(1).max(120),
  scenes: z.array(storyboardSceneSchema).max(100).default([]),
}).strict().refine(value => new Set(value.scenes.map(scene => scene.id)).size === value.scenes.length, 'creative_duplicate_input');
export const storyboardOperationSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('add'), scene: storyboardSceneContentSchema.extend({ id: id.optional() }), beforeId: id.nullable().optional() }).strict(),
  z.object({ type: z.literal('update'), id, patch: storyboardSceneContentSchema.partial() }).strict(),
  z.object({ type: z.literal('remove'), id }).strict(),
  z.object({ type: z.literal('move'), id, beforeId: id.nullable() }).strict(),
  z.object({ type: z.literal('duplicate'), id, newId: id.optional() }).strict(),
  z.object({ type: z.literal('rename'), title: z.string().trim().min(1).max(120) }).strict(),
  z.object({ type: z.literal('link'), id, kind: z.enum(['image', 'video']), nodeId: id.nullable() }).strict(),
]);
export const creativeStoryboardCommandSchema = z.object({
  command: z.enum(['list', 'read', 'create', 'apply', 'materialize', 'remove']),
  nodeId: id.optional(), revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
  title: z.string().trim().min(1).max(120).optional(),
  nearNodeId: id.optional(), floorId: id.nullable().optional(),
  position: z.object({ x: z.number().finite().min(-100000).max(100000), y: z.number().finite().min(-100000).max(100000) }).strict().optional(),
  operations: z.array(storyboardOperationSchema).min(1).max(100).optional(),
  sceneId: id.optional(), kind: z.enum(['image', 'video']).optional(),
  config: creativeConfigSchema.optional(),
}).strict().superRefine((value, context) => {
  const required = value.command === 'create' ? ['title'] : value.command === 'list' ? [] : value.command === 'read' ? ['nodeId'] : value.command === 'apply' ? ['nodeId', 'revision', 'operations'] : value.command === 'materialize' ? ['nodeId', 'revision', 'sceneId', 'kind'] : ['nodeId', 'revision'];
  for (const key of required) if (value[key as keyof typeof value] === undefined) context.addIssue({ code: 'custom', path: [key], message: 'creative_invalid_input' });
});
export type StoryboardScene = z.infer<typeof storyboardSceneSchema>;
export type StoryboardDocument = z.infer<typeof storyboardDocumentSchema>;
export type StoryboardOperation = z.infer<typeof storyboardOperationSchema>;
export type CreativeStoryboardCommand = z.infer<typeof creativeStoryboardCommandSchema>;
