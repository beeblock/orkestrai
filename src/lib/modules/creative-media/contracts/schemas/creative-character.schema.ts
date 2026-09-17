import { z } from 'zod';
import { creativePathSchema, creativeModelIdSchema, creativeConfigSchema } from './creative-media.schema.js';

const language = z.string().trim().min(2).max(40);
const style = z.string().trim().max(2000).default('');
export const creativeCharacterDefinitionSchema = z.object({
  name: z.string().trim().min(1).max(80),
  appearance: z.string().trim().max(8000).default(''),
  images: z.array(creativePathSchema).max(12).default([]),
  voice: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('unassigned') }).strict(),
    z.object({ kind: z.literal('audio'), path: creativePathSchema, language, style }).strict(),
    z.object({ kind: z.literal('provider'), voiceId: z.string().trim().min(1).max(200).regex(/^[a-zA-Z0-9_.:-]+$/), profileId: z.string().uuid(), modelIds: z.array(creativeModelIdSchema).min(1).max(100), language, style }).strict(),
  ]).default({ kind: 'unassigned' }),
}).strict();
export const creativeCharacterCommandSchema = z.object({
  command: z.enum(['list', 'library', 'place', 'read', 'create', 'update', 'fork', 'lock', 'remove', 'binding']),
  config: creativeConfigSchema.optional(),
  id: z.string().uuid().optional(),
  sourceWorkspaceId: z.string().uuid().optional(),
  position: z.object({ x: z.number().finite().min(-1000000).max(1000000), y: z.number().finite().min(-1000000).max(1000000) }).strict().optional(),
  floorId: z.string().uuid().nullable().optional(),
  revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
  definition: creativeCharacterDefinitionSchema.optional(),
}).strict().superRefine((value, ctx) => {
  if (!['create', 'list', 'library'].includes(value.command) && !value.id) ctx.addIssue({ code: 'custom', path: ['id'], message: 'creative_character_required' });
  if (['update', 'lock', 'remove'].includes(value.command) && !value.revision) ctx.addIssue({ code: 'custom', path: ['revision'], message: 'creative_revision_conflict' });
  if (['create', 'update'].includes(value.command) && !value.definition) ctx.addIssue({ code: 'custom', path: ['definition'], message: 'creative_character_required' });
  if (value.command === 'binding' && !value.config) ctx.addIssue({ code: 'custom', path: ['config'], message: 'creative_invalid_input' });
});
export type CreativeCharacterDefinition = z.infer<typeof creativeCharacterDefinitionSchema>;
export type CreativeCharacterCommand = z.infer<typeof creativeCharacterCommandSchema>;
