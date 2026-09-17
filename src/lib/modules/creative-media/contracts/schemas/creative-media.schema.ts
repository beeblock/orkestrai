// Shared with the renderer; Svelar's validation barrel includes Node-only rules.
import { z } from 'zod';
import { CREATIVE_MODEL_IDS, CREATIVE_MODELS } from '../../domain/catalog.js';

const id = z.string().uuid();
const revision = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
export const creativePathSchema = z.string().trim().min(1).max(500).refine(
  value => !/^(?:[\\/]|[a-z]:|[a-z]+:)/i.test(value)
    && !/(^|[\\/])\.\.([\\/]|$)/.test(value) && !/[\x00-\x1f]/.test(value),
  'creative_invalid_path',
);
export const creativeConfigSchema = z.object({
  modelId: z.enum(CREATIVE_MODEL_IDS).default('wan-2.7-text'),
  profileId: id.nullable().default(null),
  prompt: z.string().trim().max(5000).default(''),
  negativePrompt: z.string().trim().max(2500).default(''),
  duration: z.number().int().min(2).max(15).default(5),
  aspectRatio: z.enum(['16:9', '9:16', '1:1', '4:3', '3:4']).default('16:9'),
  resolution: z.enum(['720p', '1080p']).default('720p'),
  generateAudio: z.boolean().default(false),
  seed: z.number().int().min(0).max(2147483647).nullable().default(null),
  startImageNodeId: id.nullable().default(null),
  endImageNodeId: id.nullable().default(null),
  contextNodeIds: z.array(id).max(8).default([]),
  outputDirectory: creativePathSchema.default('generated/videos'),
  filePrefix: z.string().trim().min(1).max(80).regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/).default('orkestrai-video'),
}).strict().superRefine((value, ctx) => {
  const model = CREATIVE_MODELS[value.modelId];
  for (const [field, maximum] of [['prompt', model.promptLimit], ['negativePrompt', model.negativePromptLimit]] as const) {
    if (value[field].length > maximum) ctx.addIssue({ code: 'custom', path: [field], message: 'creative_prompt_too_long' });
  }
  if (value.duration < model.minDuration) ctx.addIssue({ code: 'custom', path: ['duration'], message: 'creative_invalid_duration' });
  if (!model.startImage && (value.startImageNodeId || value.endImageNodeId)) ctx.addIssue({ code: 'custom', path: ['startImageNodeId'], message: 'creative_unsupported_input' });
  if (!model.seed && value.seed !== null) ctx.addIssue({ code: 'custom', path: ['seed'], message: 'creative_unsupported_input' });
  if (!model.audioToggle && value.generateAudio) ctx.addIssue({ code: 'custom', path: ['generateAudio'], message: 'creative_unsupported_input' });
  if (new Set(value.contextNodeIds).size !== value.contextNodeIds.length) ctx.addIssue({ code: 'custom', path: ['contextNodeIds'], message: 'creative_duplicate_input' });
});

export const creativeProfileSchema = z.object({
  name: z.string().trim().min(1).max(80), provider: z.literal('fal'),
  enabled: z.boolean().default(false),
}).strict();
export const creativeProfileSaveSchema = creativeProfileSchema.extend({
  revision: revision.optional(),
  credential: z.string().trim().min(8).max(512).regex(/^[\x21-\x7e]+$/).optional(),
});
export const creativePolicySchema = z.object({
  enabled: z.boolean().default(false),
  allowAgents: z.boolean().default(false),
  allowExternalMedia: z.boolean().default(false),
  modelIds: z.array(z.enum(CREATIVE_MODEL_IDS)).max(CREATIVE_MODEL_IDS.length).default([]),
  maxRunCents: z.number().int().min(0).max(100000).default(0),
  maxDayCents: z.number().int().min(0).max(1000000).default(0),
  maxConcurrentRuns: z.number().int().min(1).max(4).default(1),
}).strict();
export const creativePolicySaveSchema = creativePolicySchema.extend({ revision: revision.optional() });
export const creativeWorkflowSaveSchema = z.object({
  title: z.string().trim().min(1).max(120), config: creativeConfigSchema,
  revision: revision.optional(),
}).strict();
export const creativeRunRequestSchema = z.object({
  revision, previewId: id, idempotencyKey: id,
}).strict();
export const creativeRunCommandSchema = z.object({ command: z.enum(['cancel', 'retry_download', 'close_unconfirmed']), runId: id }).strict();
export type CreativeConfig = z.infer<typeof creativeConfigSchema>;
export type CreativePolicy = z.infer<typeof creativePolicySchema>;
export type CreativeProfileSave = z.infer<typeof creativeProfileSaveSchema>;
export type CreativeWorkflowSave = z.infer<typeof creativeWorkflowSaveSchema>;
export type CreativeRunRequest = z.infer<typeof creativeRunRequestSchema>;
