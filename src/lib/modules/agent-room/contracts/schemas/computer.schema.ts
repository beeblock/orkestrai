import { z } from '@beeblock/svelar/validation';
import { autonomyRiskSchema } from './autonomy-policy.schema.js';
import { computerReplyGrantSchema } from './computer-reply.schema.js';
import { conversationMemorySearchSchema, conversationMemorySaveSchema, conversationMemoryForgetSchema, conversationMemoryResultSchema } from './conversation-memory.schema.js';
import { assistantArtifactInputSchema, assistantArtifactResultSchema } from './assistant-artifact.schema.js';
import { computerMediaSendSchema, computerMediaReceiveSchema, computerMediaResultSchema } from './computer-media.schema.js';

function uniqueNativeTargets<T extends { id: string }>(targets: T[]): T[] {
  const unique = new Map<string, T>();
  const ambiguous = new Set<string>();
  for (const target of targets) {
    const previous = unique.get(target.id);
    if (previous && JSON.stringify(previous) !== JSON.stringify(target)) ambiguous.add(target.id);
    else if (!previous) unique.set(target.id, target);
  }
  // Repeated native records are harmless; conflicting identities are not targets.
  return [...unique.values()].filter((target) => !ambiguous.has(target.id));
}

export const computerPlatformSchema = z.enum(['macos', 'windows', 'linux']);
export const computerPermissionStateSchema = z.enum(['granted', 'denied', 'prompt', 'unavailable', 'unknown']);
export const computerBoundsSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite().positive(),
  height: z.number().finite().positive(),
}).strict();

export const computerDisplaySchema = z.object({
  id: z.string().min(1).max(160),
  name: z.string().min(1).max(240),
  bounds: computerBoundsSchema,
  scaleFactor: z.number().finite().positive().max(8),
  primary: z.boolean(),
});

export const computerWindowSchema = z.object({
  id: z.string().min(1).max(160),
  appId: z.string().min(1).max(255),
  appName: z.string().min(1).max(255),
  title: z.string().max(1_000),
  bounds: computerBoundsSchema.nullable(),
  focused: z.boolean(),
});

export const computerSnapshotSchema = z.object({
  platform: computerPlatformSchema,
  available: z.boolean(),
  reason: z.enum(['ready', 'unsupported_os', 'backend_missing', 'wayland_unsupported']),
  detail: z.string().max(2_000).nullable(),
  permissions: z.object({
    accessibility: computerPermissionStateSchema,
    screenRecording: computerPermissionStateSchema,
  }).strict(),
  displays: z.array(computerDisplaySchema).max(32).transform(uniqueNativeTargets),
  windows: z.array(computerWindowSchema).max(500).transform(uniqueNativeTargets),
  focusedWindowId: z.string().max(160).nullable(),
});

const coordinate = z.number().finite();
const durationMs = z.number().int().min(50).max(30_000);
const key = z.string().trim().min(1).max(40).regex(/^[A-Za-z0-9+_.-]+$/);

export const computerElementSelectorSchema = z.object({
  id: z.string().regex(/^0(?:\.\d{1,4}){0,24}$/),
  role: z.string().min(1).max(120),
  name: z.string().max(2000),
  value: z.string().max(20_000).optional(),
}).strict();
export const computerAccessibilitySchema = z.object({
  available: z.boolean(),
  truncated: z.boolean(),
  elements: z.array(computerElementSelectorSchema.extend({
    value: z.string().max(20_000),
    protected: z.boolean(),
    enabled: z.boolean(),
    focused: z.boolean(),
    actions: z.array(z.enum(['press', 'fill'])).max(2),
  })).max(500),
}).strict();
export const computerInteractionSchema = z.object({
  command: z.literal('interact'),
  targetId: z.string().min(1).max(160),
  element: computerElementSelectorSchema,
  // Guards identify a particular conversation/document, not merely its app.
  guards: z.array(computerElementSelectorSchema).min(1).max(8),
  action: z.enum(['press', 'fill']),
  text: z.string().max(20_000).optional(),
}).strict();

export const computerStepSchema = z.discriminatedUnion('command', [
  z.object({ command: z.literal('prepare') }).strict(),
  z.object({ command: z.literal('launch'), applicationId: z.string().min(1).max(255).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/) }).strict(),
  z.object({ command: z.literal('inspect') }).strict(),
  z.object({ command: z.literal('read'), targetId: z.string().min(1).max(160) }).strict(),
  computerInteractionSchema,
  z.object({ command: z.literal('open_settings'), permission: z.enum(['accessibility', 'screenRecording']) }).strict(),
  z.object({ command: z.literal('focus'), windowId: z.string().min(1).max(160) }).strict(),
  z.object({
    command: z.literal('click'), x: coordinate, y: coordinate,
    space: z.enum(['screen', 'display', 'window']).default('screen'),
    targetId: z.string().min(1).max(160).optional(),
    button: z.enum(['left', 'right', 'middle']).default('left'),
    count: z.number().int().min(1).max(3).default(1),
  }).strict(),
  z.object({ command: z.literal('type'), text: z.string().min(1).max(20_000), targetId: z.string().min(1).max(160).optional() }).strict(),
  z.object({ command: z.literal('type_secret'), secretRef: z.string().regex(/^secretref:[0-9a-f-]{16,}$/i), targetId: z.string().min(1).max(160).optional() }).strict(),
  z.object({ command: z.literal('shortcut'), keys: z.array(key).min(1).max(8), targetId: z.string().min(1).max(160).optional() }).strict(),
  z.object({
    command: z.literal('screenshot'),
    target: z.enum(['all', 'display', 'window']).default('all'),
    targetId: z.string().min(1).max(160).optional(),
    retention: z.enum(['evidence', 'temporary']).optional(),
  }).strict(),
  z.object({
    command: z.literal('wait'),
    condition: z.enum(['window_exists', 'window_focused']),
    value: z.string().trim().min(1).max(500),
    timeoutMs: durationMs.default(10_000),
    pollMs: z.number().int().min(100).max(2_000).default(300),
  }).strict(),
]);

export const computerWatchSchema = z.object({
  replyGrantId: z.string().uuid().nullable().default(null),
  enabled: z.boolean().default(false),
  windowId: z.string().max(160).default(''),
  applicationId: z.string().max(255).default(''),
  routineId: z.string().uuid().nullable().default(null),
  taskId: z.string().uuid().nullable().default(null),
  mode: z.enum(['auto', 'visual']).default('auto'),
  intervalSeconds: z.number().int().min(1).max(60).default(1),
  cooldownSeconds: z.number().int().min(1).max(600).default(2),
  minChangePercent: z.number().min(0.1).max(50).default(1),
  region: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), width: z.number().positive().max(1), height: z.number().positive().max(1) }).strict()
    .refine((r) => r.x + r.width <= 1 && r.y + r.height <= 1).default({ x: 0, y: 0, width: 1, height: 1 }),
}).strict().refine((v) => !v.enabled || Boolean(v.windowId && v.applicationId && v.routineId && v.taskId));

export const computerCommandSchema = z.union([
  z.object({ command: z.literal('open_conversation'), grantId: z.string().uuid(), targetId: z.string().min(1).max(160) }).strict(),
  z.object({ command: z.literal('inbox_acknowledge'), grantId: z.string().uuid(), batchId: z.string().uuid(), inReplyToDigest: z.string().regex(/^[a-f0-9]{64}$/), reason: z.enum(['already_answered', 'no_response_needed']) }).strict(),
  computerMediaSendSchema,
  computerMediaReceiveSchema,
  z.object({ command: z.literal('media_recovery'), grantId: z.string().uuid(), targetId: z.string().min(1).max(160), actionId: z.string().uuid().optional(), expectedRequestDigest: z.string().regex(/^[a-f0-9]{64}$/).optional() }).strict().refine(v => Boolean(v.actionId) === Boolean(v.expectedRequestDigest)),
  z.object({ command: z.literal('reply_recovery'), grantId: z.string().uuid(), targetId: z.string().min(1).max(160), actionId: z.string().uuid().optional(), expectedDraftHash: z.string().regex(/^[a-f0-9]{64}$/).optional() }).strict().refine(v => Boolean(v.actionId) === Boolean(v.expectedDraftHash)),
  z.object({ command: z.literal('capabilities') }).strict(),
  conversationMemorySearchSchema, conversationMemorySaveSchema, conversationMemoryForgetSchema,
  assistantArtifactInputSchema,
  z.object({ command: z.literal('send'), grantId: z.string().uuid(), targetId: z.string().min(1).max(160), source: z.object({ kind: z.enum(['automation', 'task']), id: z.string().uuid() }).strict(), text: z.string().trim().min(1).max(4000) }).strict(),
  z.object({ command: z.literal('reply'), grantId: z.string().uuid(), targetId: z.string().min(1).max(160), inReplyToDigest: z.string().regex(/^[a-f0-9]{64}$/), batchId: z.string().uuid().optional(), text: z.string().trim().min(1).max(4000) }).strict(),
  z.object({ command: z.literal('authorize_replies'), grant: computerReplyGrantSchema.omit({ id: true }) }).strict(),
  computerStepSchema,
  z.object({ command: z.literal('batch'), steps: z.array(z.object({ input: computerStepSchema, risk: autonomyRiskSchema.optional() }).strict()).min(1).max(12) }).strict()
    .refine((v) => v.steps.every((s) => !['prepare', 'inspect', 'open_settings'].includes(s.input.command)), 'Only executable desktop steps belong in a batch.'),
  z.object({ command: z.literal('watch'), watch: computerWatchSchema }).strict(),
  z.object({ command: z.literal('cleanup') }).strict(),
]);

export const computerNodeConfigSchema = z.object({
  enabled: z.boolean().default(false),
  allowedApplications: z.array(z.string().trim().min(1).max(255)).max(100).default([]),
  allowedDisplays: z.array(z.string().trim().min(1).max(160)).max(32).default([]),
  evidenceRetentionDays: z.number().int().min(1).max(365).default(14),
  evidenceMaxMiB: z.number().int().min(32).max(1024).default(256),
  allowAgentWatch: z.boolean().default(false),
  watch: computerWatchSchema.default(() => computerWatchSchema.parse({})),
}).strict();

export const computerCommandResultSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('inbox_acknowledgment'), grantId: z.string().uuid(), batchId: z.string().uuid(), resolution: z.enum(['already_answered', 'no_response_needed']), count: z.number().int().min(1).max(20), sent: z.literal(false) }).strict(),
  computerMediaResultSchema,
  z.object({ kind: z.literal('media_recovery'), grantId: z.string().uuid(), actionId: z.string().uuid().nullable(), targetId: z.string(), requestDigest: z.string().nullable(), state: z.enum(['available', 'none', 'uncertain', 'repaired']) }),
  z.object({ kind: z.literal('reply_recovery'), grantId: z.string().uuid(), actionId: z.string().uuid().nullable(), targetId: z.string(), draftHash: z.string(), draftCharacters: z.number().int(), state: z.enum(['available', 'none', 'uncertain', 'repaired']) }),
  z.object({ kind: z.literal('capabilities'), platform: z.string(), voices: z.array(z.object({ id: z.string(), locale: z.string(), style: z.string() })).optional(), capabilities: z.array(z.object({ id: z.string(), state: z.enum(['available','permission_required','setup_required','unsupported']), tools: z.array(z.string()), detail: z.string() })), conversations: z.array(z.object({ grantId: z.string().uuid(), applicationId: z.string(), recipient: z.string(), enabled: z.boolean(), memoryEnabled: z.boolean(), allowProactive: z.boolean(), allowForegroundSend: z.boolean().optional(), allowConversationNavigation: z.boolean().optional() })), instructions: z.string() }),
  conversationMemoryResultSchema,
  assistantArtifactResultSchema,
  z.object({ kind: z.literal('publication'), completed: z.boolean(), grantId: z.string().uuid(), source: z.object({ kind: z.enum(['automation', 'task']), id: z.string().uuid() }), delivery: z.literal('unconfirmed'), elapsedMs: z.number(), snapshot: computerSnapshotSchema }),
  z.object({ kind: z.literal('snapshot'), snapshot: computerSnapshotSchema }),
  z.object({ kind: z.literal('action'), completed: z.boolean(), snapshot: computerSnapshotSchema }),
  z.object({ kind: z.literal('accessibility'), tree: computerAccessibilitySchema, snapshot: computerSnapshotSchema, replyTargets: z.array(z.object({ grantId: z.string().uuid(), digest: z.string(), text: z.string() })).optional() }),
  z.object({ kind: z.literal('reply'), completed: z.boolean(), grantId: z.string().uuid(), inReplyToDigest: z.string(), delivery: z.literal('unconfirmed'), elapsedMs: z.number(), snapshot: computerSnapshotSchema }),
  z.object({ kind: z.literal('screenshot'), path: z.string(), evidenceId: z.string().uuid(), width: z.number().int().positive().nullable(), height: z.number().int().positive().nullable(), snapshot: computerSnapshotSchema }),
  z.object({ kind: z.literal('batch'), completed: z.boolean(), steps: z.array(z.object({ index: z.number(), status: z.enum(['succeeded', 'gated', 'failed']), result: z.record(z.string(), z.unknown()).optional(), gateId: z.string().optional(), error: z.string().optional() })), snapshot: computerSnapshotSchema }),
]);

export const bridgeComputerCommandSchema = z.object({
  from: z.string().trim().min(1).max(120),
  taskId: z.string().uuid(),
  idempotencyKey: z.string().trim().min(8).max(240).regex(/^[a-zA-Z0-9._:@/-]+$/),
  input: computerCommandSchema,
  risk: autonomyRiskSchema.optional(),
}).strict();

export type ComputerPlatform = z.infer<typeof computerPlatformSchema>;
export type ComputerBounds = z.infer<typeof computerBoundsSchema>;
export type ComputerDisplay = z.infer<typeof computerDisplaySchema>;
export type ComputerWindow = z.infer<typeof computerWindowSchema>;
export type ComputerSnapshot = z.infer<typeof computerSnapshotSchema>;
export type ComputerCommandInput = z.infer<typeof computerCommandSchema>;
export type ComputerStepInput = z.infer<typeof computerStepSchema>;
export type ComputerWatch = z.infer<typeof computerWatchSchema>;
export type ComputerNodeConfig = z.infer<typeof computerNodeConfigSchema>;
export type ComputerCommandResult = z.infer<typeof computerCommandResultSchema>;
export type ComputerAccessibility = z.infer<typeof computerAccessibilitySchema>;
export type ComputerInteraction = z.infer<typeof computerInteractionSchema>;
