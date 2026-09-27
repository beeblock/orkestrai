import { z } from '@beeblock/svelar/validation';

export const devicePlatformSchema = z.enum(['ios', 'android']);
export const deviceRuntimeStateSchema = z.enum(['shutdown', 'booting', 'booted', 'offline', 'unauthorized', 'unknown']);
export const deviceSessionStatusSchema = z.enum(['starting', 'streaming', 'error']);
export const deviceOrientationSchema = z.enum([
  'portrait',
  'portrait_upside_down',
  'landscape_left',
  'landscape_right',
]);
export const devicePermissionSchema = z.enum([
  'notifications',
  'location',
  'camera',
  'microphone',
  'photos',
  'photos-add',
  'contacts',
  'calendar',
  'reminders',
  'motion',
  'media-library',
  'siri',
  'speech',
  'faceid',
  'user-tracking',
  'homekit',
  'all',
]);

export const deviceDescriptorSchema = z.object({
  id: z.string(),
  name: z.string(),
  platform: devicePlatformSchema,
  runtime: z.string().nullable(),
  state: deviceRuntimeStateSchema,
  available: z.boolean(),
  physical: z.boolean(),
});

export const devicePlatformAvailabilitySchema = z.object({
  platform: devicePlatformSchema,
  available: z.boolean(),
  reason: z.enum([
    'ready',
    'unsupported_os',
    'unsupported_arch',
    'xcode_missing',
    'runtime_missing',
    'android_sdk_missing',
    'android_device_missing',
  ]),
  detail: z.string().nullable(),
  setupUrl: z.string().url().nullable(),
});

export const deviceSessionSchema = z.object({
  workspaceId: z.string().uuid(),
  platform: devicePlatformSchema,
  deviceId: z.string(),
  deviceName: z.string(),
  status: deviceSessionStatusSchema,
  orientation: deviceOrientationSchema,
  startedByOrkestrai: z.boolean(),
  attachedAt: z.string(),
  lastError: z.string().nullable(),
});

export const deviceAttachmentSchema = z.object({
  platform: devicePlatformSchema,
  deviceId: z.string().min(1).max(160),
  deviceName: z.string().min(1).max(300),
  physical: z.boolean(),
});

export const deviceRecoverySchema = deviceAttachmentSchema.extend({
  reason: z.enum(['unavailable', 'busy', 'failed', 'confirmation_required']),
});

export const deviceSnapshotSchema = z.object({
  nodeId: z.string().uuid().nullable().optional(),
  platforms: z.array(devicePlatformAvailabilitySchema),
  devices: z.array(deviceDescriptorSchema),
  session: deviceSessionSchema.nullable(),
  recovery: deviceRecoverySchema.nullable().optional(),
});

export const deviceCommandResultSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('screenshot'), path: z.string() }),
  z.object({ kind: z.literal('logs'), content: z.string(), truncated: z.boolean() }),
  z.object({ kind: z.literal('tree'), tree: z.unknown(), truncated: z.boolean() }),
  z.object({ kind: z.literal('permissions'), content: z.string(), truncated: z.boolean() }),
]);

export const deviceCommandResponseSchema = z.object({
  snapshot: deviceSnapshotSchema,
  result: deviceCommandResultSchema.nullable(),
});

const normalizedCoordinate = z.number().finite().min(0).max(1);
const deviceCommandBase = z.object({ command: z.string() });

export const deviceCommandSchema = z.discriminatedUnion('command', [
  deviceCommandBase.extend({
    command: z.literal('start'),
    platform: devicePlatformSchema,
    deviceId: z.string().min(1).max(160),
    confirmPhysical: z.boolean().optional(),
  }),
  deviceCommandBase.extend({ command: z.literal('stop') }),
  deviceCommandBase.extend({ command: z.literal('restart') }),
  deviceCommandBase.extend({
    command: z.literal('tap'),
    x: normalizedCoordinate,
    y: normalizedCoordinate,
  }),
  deviceCommandBase.extend({
    command: z.literal('swipe'),
    fromX: normalizedCoordinate,
    fromY: normalizedCoordinate,
    toX: normalizedCoordinate,
    toY: normalizedCoordinate,
    durationMs: z.number().int().min(80).max(5_000).default(300),
  }),
  deviceCommandBase.extend({
    command: z.literal('pinch'),
    centerX: normalizedCoordinate,
    centerY: normalizedCoordinate,
    startDistance: z.number().finite().min(0.02).max(0.9),
    endDistance: z.number().finite().min(0.02).max(0.9),
    durationMs: z.number().int().min(80).max(5_000).default(300),
  }),
  deviceCommandBase.extend({
    command: z.literal('type'),
    text: z.string().min(1).max(4_000),
  }),
  deviceCommandBase.extend({
    command: z.literal('button'),
    button: z.enum(['back', 'home', 'lock', 'app-switcher']),
  }),
  deviceCommandBase.extend({
    command: z.literal('rotate'),
    orientation: deviceOrientationSchema,
  }),
  deviceCommandBase.extend({
    command: z.literal('install'),
    path: z.string().min(1).max(4_096),
  }),
  deviceCommandBase.extend({
    command: z.literal('launch'),
    bundleId: z.string().min(1).max(255).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9._$-]+)?$/),
  }),
  deviceCommandBase.extend({ command: z.literal('screenshot') }),
  deviceCommandBase.extend({
    command: z.literal('logs'),
    minutes: z.number().int().min(1).max(30).default(2),
  }),
  deviceCommandBase.extend({ command: z.literal('tree') }),
  deviceCommandBase.extend({
    command: z.literal('permissions'),
    action: z.enum(['list', 'grant', 'revoke', 'reset']),
    permission: devicePermissionSchema.optional(),
    bundleId: z.string().min(1).max(255).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/).optional(),
    value: z.string().min(1).max(120).optional(),
  }),
]);

export type DevicePlatform = z.infer<typeof devicePlatformSchema>;
export type DeviceRuntimeState = z.infer<typeof deviceRuntimeStateSchema>;
export type DeviceOrientation = z.infer<typeof deviceOrientationSchema>;
export type DevicePermission = z.infer<typeof devicePermissionSchema>;
export type DeviceDescriptor = z.infer<typeof deviceDescriptorSchema>;
export type DevicePlatformAvailability = z.infer<typeof devicePlatformAvailabilitySchema>;
export type DeviceSession = z.infer<typeof deviceSessionSchema>;
export type DeviceSnapshot = z.infer<typeof deviceSnapshotSchema>;
export type DeviceAttachment = z.infer<typeof deviceAttachmentSchema>;
export type DeviceRecovery = z.infer<typeof deviceRecoverySchema>;
export type DeviceCommandInput = z.infer<typeof deviceCommandSchema>;
export type DeviceCommandResult = z.infer<typeof deviceCommandResultSchema>;
export type DeviceCommandResponse = z.infer<typeof deviceCommandResponseSchema>;
