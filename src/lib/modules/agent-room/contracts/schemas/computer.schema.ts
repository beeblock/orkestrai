import { z } from '@beeblock/svelar/validation';

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
  displays: z.array(computerDisplaySchema).max(32),
  windows: z.array(computerWindowSchema).max(500),
  focusedWindowId: z.string().max(160).nullable(),
});

const coordinate = z.number().finite();
const durationMs = z.number().int().min(50).max(30_000);
const key = z.string().trim().min(1).max(40).regex(/^[A-Za-z0-9+_.-]+$/);

export const computerCommandSchema = z.discriminatedUnion('command', [
  z.object({ command: z.literal('inspect') }).strict(),
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
  }).strict(),
  z.object({
    command: z.literal('wait'),
    condition: z.enum(['window_exists', 'window_focused']),
    value: z.string().trim().min(1).max(500),
    timeoutMs: durationMs.default(10_000),
    pollMs: z.number().int().min(100).max(2_000).default(300),
  }).strict(),
]);

export const computerNodeConfigSchema = z.object({
  enabled: z.boolean().default(false),
  allowedApplications: z.array(z.string().trim().min(1).max(255)).max(100).default([]),
  allowedDisplays: z.array(z.string().trim().min(1).max(160)).max(32).default([]),
  evidenceRetentionDays: z.number().int().min(1).max(365).default(14),
}).strict();

export const computerCommandResultSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('snapshot'), snapshot: computerSnapshotSchema }),
  z.object({ kind: z.literal('action'), completed: z.boolean(), snapshot: computerSnapshotSchema }),
  z.object({ kind: z.literal('screenshot'), path: z.string(), evidenceId: z.string().uuid(), width: z.number().int().positive().nullable(), height: z.number().int().positive().nullable(), snapshot: computerSnapshotSchema }),
]);

export const bridgeComputerCommandSchema = z.object({
  from: z.string().trim().min(1).max(120),
  taskId: z.string().uuid(),
  idempotencyKey: z.string().trim().min(8).max(240).regex(/^[a-zA-Z0-9._:@/-]+$/),
  input: computerCommandSchema,
}).strict();

export type ComputerPlatform = z.infer<typeof computerPlatformSchema>;
export type ComputerBounds = z.infer<typeof computerBoundsSchema>;
export type ComputerDisplay = z.infer<typeof computerDisplaySchema>;
export type ComputerWindow = z.infer<typeof computerWindowSchema>;
export type ComputerSnapshot = z.infer<typeof computerSnapshotSchema>;
export type ComputerCommandInput = z.infer<typeof computerCommandSchema>;
export type ComputerNodeConfig = z.infer<typeof computerNodeConfigSchema>;
export type ComputerCommandResult = z.infer<typeof computerCommandResultSchema>;
