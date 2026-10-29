import { z } from '@beeblock/svelar/validation';

export const modelAccessProviderSchema = z.enum(['claude', 'codex']);
export const modelAccessEffortSchema = z.enum(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
export const modelNameSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/);
const name = z.string().trim().min(1).max(100);
export const relayUrlSchema = z.string().url().max(2048).refine(value => {
  const url = new URL(value);
  return !url.username && !url.password && !url.hash && !url.search && !['0.0.0.0', '[::]'].includes(url.hostname)
    && (url.protocol === 'wss:' || (url.protocol === 'ws:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)));
}, 'A secure relay URL is required.');

export const modelAccessOfferingInputSchema = z.object({
  providerId: modelAccessProviderSchema,
  profileId: z.string().uuid().nullable(),
  models: z.array(modelNameSchema).min(1).max(100).nullable(),
  efforts: z.array(modelAccessEffortSchema).min(1).max(8).nullable(),
  images: z.boolean().default(false),
}).strict();
export const modelAccessOfferingSchema = modelAccessOfferingInputSchema.extend({ id: z.string().uuid(), label: name, availableModels: z.array(z.object({ value: modelNameSchema, label: name, efforts: z.array(modelAccessEffortSchema).max(8) }).strict()).max(100).default([]) }).strict();
export const modelAccessPolicySchema = z.object({
  offerings: z.array(modelAccessOfferingSchema).min(1).max(12),
  concurrency: z.number().int().min(1).max(4).default(1),
  requestsPerMinute: z.number().int().min(1).max(60).default(10),
  maxRequests: z.number().int().min(1).max(100000).nullable().default(null),
}).strict();
export const modelAccessPublicPolicySchema = modelAccessPolicySchema.extend({ offerings: z.array(modelAccessOfferingSchema.omit({ profileId: true })).min(1).max(12) }).strict();
export const createModelAccessSchema = z.object({
  name,
  relayUrl: relayUrlSchema,
  expiresInMinutes: z.number().int().min(5).max(30 * 24 * 60),
  offerings: z.array(modelAccessOfferingInputSchema).min(1).max(12),
  concurrency: z.number().int().min(1).max(4).default(1),
  requestsPerMinute: z.number().int().min(1).max(60).default(10),
  maxRequests: z.number().int().min(1).max(100000).nullable().default(null),
}).strict();
export const joinModelAccessSchema = z.object({ invite: z.string().min(80).max(4096), displayName: name, relayUrl: relayUrlSchema }).strict();
export const approveModelAccessSchema = z.object({ revision: z.number().int().positive(), guestId: z.string().uuid(), fingerprint: z.string().regex(/^(?:[A-F0-9]{4}-){7}[A-F0-9]{4}$/), approved: z.boolean() }).strict();
export const reviseModelAccessSchema = createModelAccessSchema.omit({ relayUrl: true }).extend({ revision: z.number().int().positive() }).strict();
export const modelAccessActionSchema = z.object({ action: z.enum(['invite', 'revoke', 'disconnect']), revision: z.number().int().positive().optional() }).strict();
export const peerIdentitySchema = z.object({ id: z.string().uuid(), name, publicKey: z.string().min(40).max(128), fingerprint: z.string().min(20).max(80), requestedAt: z.string().datetime() }).strict();
export type ModelAccessPolicy = z.infer<typeof modelAccessPolicySchema>;
export type ModelAccessOffering = z.infer<typeof modelAccessOfferingSchema>;
export type CreateModelAccessInput = z.infer<typeof createModelAccessSchema>;
export type JoinModelAccessInput = z.infer<typeof joinModelAccessSchema>;
export type ApproveModelAccessInput = z.infer<typeof approveModelAccessSchema>;
export type ModelAccessPeer = z.infer<typeof peerIdentitySchema>;

export const inferenceContentSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string().max(2 * 1024 * 1024) }).strict(),
  z.object({ type: z.literal('image'), mime: z.enum(['image/png', 'image/jpeg', 'image/webp']), data: z.string().min(4).max(8 * 1024 * 1024).regex(/^[A-Za-z0-9+/]+={0,2}$/) }).strict(),
]);
export const inferenceToolSchema = z.object({ name: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,95}$/), description: z.string().max(12000), internal: z.boolean().default(false), inputSchema: z.record(z.string(), z.unknown()) }).strict();
export const inferenceRequestSchema = z.object({
  offeringId: z.string().uuid(), model: modelNameSchema, effort: modelAccessEffortSchema,
  system: z.string().max(200000),
  messages: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.array(inferenceContentSchema).min(1).max(32) }).strict()).min(1).max(500),
  tools: z.array(inferenceToolSchema).max(1024),
}).strict().superRefine((value, context) => {
  if (new Set(value.tools.map(tool => tool.name)).size !== value.tools.length) context.addIssue({ code: 'custom', message: 'Duplicate tool names.' });
  if (value.messages.at(-1)?.role !== 'user') context.addIssue({ code: 'custom', message: 'The last message must be from the user.' });
});
export const imagegenSchema = z.object({ prompt: z.string().min(1).max(32000), transparent_background: z.boolean().default(false), referenced_image_paths: z.array(z.string().min(1).max(4096)).max(5).default([]), idempotencyKey: z.string().uuid() }).strict();
export const inferenceToolResultSchema = z.object({
  callId: z.string().uuid(), success: z.boolean(), content: z.array(inferenceContentSchema).min(1).max(32),
}).strict();
export type InferenceRequest = z.infer<typeof inferenceRequestSchema>;
export type InferenceToolResult = z.infer<typeof inferenceToolResultSchema>;
export function parseInferenceJson(body: Buffer): unknown {
  // Avoid parser excerpts leaking prompts into errors or audit logs; bound recursive schemas too.
  let value: unknown;
  try { value = JSON.parse(body.toString('utf8')); } catch { throw new Error('INFERENCE_INVALID_PAYLOAD'); }
  const pending: Array<[unknown, number]> = [[value, 0]]; let count = 0;
  while (pending.length) {
    const [item, depth] = pending.pop()!;
    if (++count > 100000 || depth > 32) throw new Error('INFERENCE_PAYLOAD_COMPLEXITY');
    if (item && typeof item === 'object') for (const child of Object.values(item)) pending.push([child, depth + 1]);
  }
  return value;
}
export const guestAgentSchema = z.object({
  sessionId: z.string().uuid(), model: z.string().min(74).max(450).optional(), effort: modelAccessEffortSchema.optional(),
  operation: z.enum(['open','turn']), prompt: z.string().max(1024 * 1024).default(''), instructions: z.string().max(200000).default(''),
}).strict();
export const bridgeModelAccessSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('status') }).strict(),
  z.object({ operation: z.literal('propose'), taskId: z.string().uuid(), input: createModelAccessSchema }).strict(),
  z.object({ operation: z.literal('revoke'), taskId: z.string().uuid(), grantId: z.string().uuid(), revision: z.number().int().positive() }).strict(),
  z.object({ operation: z.literal('disconnect'), taskId: z.string().uuid(), connectionId: z.string().uuid() }).strict(),
]);
export type GuestAgentInput = z.infer<typeof guestAgentSchema>;
