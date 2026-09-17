// Shared with the renderer; Svelar's validation barrel includes Node-only rules.
import { z } from 'zod';
import { CREATIVE_MODEL_IDS, CREATIVE_MODELS } from '../../domain/catalog.js';
import { FAL_ENDPOINT_PATTERN } from '../../domain/model-contract.js';

const id = z.string().uuid();
const revision = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
export const creativeModelIdSchema = z.string().max(240).refine(value => CREATIVE_MODEL_IDS.includes(value as typeof CREATIVE_MODEL_IDS[number]) || FAL_ENDPOINT_PATTERN.test(value), 'creative_model_not_found');
export const creativeCatalogQuerySchema = z.object({ endpoint: z.string().max(240).regex(FAL_ENDPOINT_PATTERN).optional(), query: z.string().max(100).default(''), offset: z.coerce.number().int().min(0).max(10000).default(0), limit: z.coerce.number().int().min(1).max(5000).default(100), refresh: z.preprocess(value => value === 'true' ? true : value === 'false' ? false : value, z.boolean().default(false)) }).strict();
function safeJson(value: unknown, depth = 0, count = { value: 0 }): boolean {
  if (++count.value > 10000 || depth > 16) return false;
  if (value === null || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'string') return value.length <= 50000 && !value.startsWith('data:');
  if (Array.isArray(value)) return value.length <= 1000 && value.every(item => safeJson(item, depth + 1, count));
  return !!value && typeof value === 'object' && Object.entries(value).every(([key, item]) => !['__proto__', 'constructor', 'prototype'].includes(key) && key.length <= 150 && safeJson(item, depth + 1, count));
}
export const creativeParametersSchema = z.unknown().refine(value => !!value && typeof value === 'object' && !Array.isArray(value) && safeJson(value) && JSON.stringify(value).length <= 250000, 'creative_model_parameters_invalid').pipe(z.record(z.unknown()));
export const creativePathSchema = z.string().trim().min(1).max(500).refine(
  value => !/^(?:[\\/]|[a-z]:|[a-z]+:)/i.test(value)
    && !/(^|[\\/])\.\.([\\/]|$)/.test(value) && !/[\x00-\x1f]/.test(value),
  'creative_invalid_path',
);
export const creativeConfigSchema = z.object({
  modelId: creativeModelIdSchema.default('wan-2.7-text'),
  parameters: creativeParametersSchema.default({}),
  mediaBindings: z.array(z.object({ pointer: z.string().min(1).max(500).regex(/^\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+$/), nodeId: id.optional(), path: creativePathSchema.optional() }).strict().refine(value => Boolean(value.nodeId) !== Boolean(value.path), 'creative_reference_required')).max(50).default([]),
  billingUnits: z.number().finite().positive().max(1000000000).nullable().default(null),
  profileId: id.nullable().default(null),
  prompt: z.string().trim().max(50000).default(''),
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
  if (new Set(value.mediaBindings.map(binding => binding.pointer)).size !== value.mediaBindings.length) ctx.addIssue({ code: 'custom', path: ['mediaBindings'], message: 'creative_duplicate_input' });
  const model = CREATIVE_MODELS[value.modelId as keyof typeof CREATIVE_MODELS];
  if (!model) return;
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
  modelIds: z.array(creativeModelIdSchema).max(5000).default([]),
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
