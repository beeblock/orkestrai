import { z } from 'zod';
import { storyboardSceneContentSchema } from './creative-storyboard.schema.js';

const id = z.string().uuid();
export const creativeRecipeSceneSchema = storyboardSceneContentSchema.omit({ characterIds: true, referenceNodeIds: true, executorNodeId: true });
export const creativeRecipeDefinitionSchema = z.object({
  title: z.string().trim().min(1).max(120),
  scenes: z.array(creativeRecipeSceneSchema).min(1).max(100),
  inputs: z.array(z.object({
    key: z.string().regex(/^(character|reference)-[1-9][0-9]*$/),
    kind: z.enum(['character', 'image', 'video']), label: z.string().min(1).max(120),
    scenes: z.array(z.number().int().min(0).max(99)).min(1).max(100),
    identity: z.object({ familyId: id, version: z.number().int().positive(), digest: z.string().regex(/^[a-f0-9]{64}$/) }).strict().optional(),
  }).strict()).max(100),
}).strict().superRefine((value, ctx) => {
  if (new Set(value.inputs.map(input => input.key)).size !== value.inputs.length || value.inputs.some(input => input.scenes.some(index => !value.scenes[index]))) ctx.addIssue({ code: 'custom', message: 'creative_invalid_input' });
});
export const creativeRecipeBindingsSchema = z.object({
  script: z.string().trim().max(12000).default(''),
  aspectRatio: z.enum(['16:9', '9:16', '1:1', '4:3', '3:4']).default('16:9'),
  executorNodeId: id.nullable().default(null),
  values: z.array(z.object({ key: z.string().max(60), id }).strict()).max(100).default([]),
}).strict().refine(value => new Set(value.values.map(item => item.key)).size === value.values.length, 'creative_duplicate_input');
export const creativeRecipeCaptureSchema = z.object({
  name: z.string().trim().min(1).max(120), description: z.string().trim().max(2000).default(''),
  sourceNodeId: id, revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), previousId: id.optional(),
}).strict();
export const creativeRecipeCommandSchema = z.object({
  command: z.enum(['list', 'library', 'read', 'capture', 'instantiate', 'remove', 'queue']),
  id: id.optional(), sourceWorkspaceId: id.optional(),
  capture: creativeRecipeCaptureSchema.optional(), bindings: creativeRecipeBindingsSchema.optional(),
  floorId: id.nullable().optional(),
  position: z.object({ x: z.number().finite().min(-100000).max(100000), y: z.number().finite().min(-100000).max(100000) }).strict().optional(),
}).strict().superRefine((value, ctx) => {
  const required = value.command === 'capture' ? ['capture'] : value.command === 'instantiate' ? ['id', 'bindings'] : ['read', 'remove'].includes(value.command) ? ['id'] : [];
  for (const key of required) if (value[key as keyof typeof value] === undefined) ctx.addIssue({ code: 'custom', path: [key], message: 'creative_invalid_input' });
});
export type CreativeRecipeCommand = z.infer<typeof creativeRecipeCommandSchema>;
export type CreativeRecipeDefinition = z.infer<typeof creativeRecipeDefinitionSchema>;
export type CreativeRecipeBindings = z.infer<typeof creativeRecipeBindingsSchema>;
