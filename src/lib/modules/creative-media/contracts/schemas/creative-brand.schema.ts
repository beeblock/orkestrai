import { z } from 'zod';
import { creativePathSchema } from './creative-media.schema.js';
const id = z.string().uuid();
export const creativeBrandDefinitionSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(4000).default(''),
  colors: z.array(z.object({ name: z.string().trim().min(1).max(60), value: z.string().regex(/^#[0-9a-fA-F]{6}$/) }).strict()).max(24).default([]),
  assets: z.array(z.object({ label: z.string().trim().min(1).max(100), kind: z.enum(['logo', 'product', 'style']), path: creativePathSchema }).strict()).max(20).default([]),
  rules: z.string().trim().max(12000).default(''),
  tone: z.string().trim().max(4000).default(''),
}).strict();
export const creativeBrandCommandSchema = z.object({
  command: z.enum(['list', 'read', 'library', 'create', 'update', 'lock', 'fork', 'place', 'remove']),
  id: id.optional(), revision: z.number().int().positive().optional(),
  definition: creativeBrandDefinitionSchema.optional(),
  sourceWorkspaceId: id.optional(), floorId: id.nullable().optional(),
  position: z.object({ x: z.number().finite().min(-100000).max(100000), y: z.number().finite().min(-100000).max(100000) }).strict().optional(),
}).strict().superRefine((value, context) => {
  const required = value.command === 'create' ? ['definition'] : ['list', 'library'].includes(value.command) ? [] : value.command === 'update' ? ['id', 'revision', 'definition'] : ['lock', 'remove'].includes(value.command) ? ['id', 'revision'] : ['id'];
  for (const key of required) if (value[key as keyof typeof value] === undefined) context.addIssue({ code: 'custom', path: [key], message: 'creative_invalid_input' });
});
export type CreativeBrandDefinition = z.infer<typeof creativeBrandDefinitionSchema>;
export type CreativeBrandCommand = z.infer<typeof creativeBrandCommandSchema>;
