import { z } from 'zod/v3';

export const COLLABORATION_PROTOCOL = 'orkestrai-collaboration.v1';
export const MAX_ENCRYPTED_FRAME_BYTES = 256 * 1024;
export const MAX_PLAINTEXT_BYTES = 192 * 1024;

export const opaqueIdSchema = z.string().min(8).max(128).regex(/^[a-zA-Z0-9_-]+$/);
const boundedRecord = z.record(z.unknown());

export const collaborationRoleSchema = z.enum(['viewer', 'collaborator', 'operator', 'administrator']);

export const collaborationMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('hello'),
    capabilities: z.array(z.string().min(1).max(64)).max(32),
    appVersion: z.string().min(1).max(32),
  }).strict(),
  z.object({
    type: z.literal('join.request'),
    deviceId: opaqueIdSchema,
    displayName: z.string().trim().min(1).max(80),
    platform: z.enum(['darwin', 'win32', 'linux', 'ios', 'android', 'web']),
    requestedRole: collaborationRoleSchema,
    guestNonce: z.string().min(40).max(64),
    appVersion: z.string().min(1).max(32),
  }).strict(),
  z.object({
    type: z.literal('join.approved'),
    sessionId: opaqueIdSchema,
    hostNonce: z.string().min(40).max(64),
    role: collaborationRoleSchema,
    scopes: z.array(z.string().min(1).max(80)).max(32),
    workspace: z.object({ name: z.string().max(160), icon: z.string().max(200).nullable() }).strict(),
  }).strict(),
  z.object({ type: z.literal('join.rejected'), reason: z.enum(['denied', 'expired', 'revoked', 'incompatible', 'full']) }).strict(),
  z.object({ type: z.literal('snapshot.request'), lastSequence: z.number().int().nonnegative().optional() }).strict(),
  z.object({ type: z.literal('snapshot'), revision: z.number().int().nonnegative(), workspace: boundedRecord }).strict(),
  z.object({
    type: z.literal('command'),
    commandId: opaqueIdSchema,
    revision: z.number().int().nonnegative(),
    command: boundedRecord,
  }).strict(),
  z.object({
    type: z.literal('command.result'),
    commandId: opaqueIdSchema,
    accepted: z.boolean(),
    revision: z.number().int().nonnegative(),
    errorCode: z.string().min(1).max(80).optional(),
  }).strict(),
  z.object({
    type: z.literal('event'),
    sequence: z.number().int().positive(),
    revision: z.number().int().nonnegative(),
    event: boundedRecord,
  }).strict(),
  z.object({
    type: z.literal('presence'),
    cursor: z.object({ x: z.number().finite(), y: z.number().finite() }).strict().optional(),
    selectedNodeIds: z.array(opaqueIdSchema).max(32),
  }).strict(),
  z.object({
    type: z.literal('terminal.open'),
    nodeId: opaqueIdSchema,
    cols: z.number().int().min(20).max(240),
    rows: z.number().int().min(5).max(100),
  }).strict(),
  z.object({
    type: z.literal('terminal.opened'),
    nodeId: opaqueIdSchema,
    cols: z.number().int().min(20).max(240),
    rows: z.number().int().min(5).max(100),
    scrollback: z.string().max(98_304),
  }).strict(),
  z.object({ type: z.literal('terminal.input'), nodeId: opaqueIdSchema, data: z.string().min(1).max(8_192) }).strict(),
  z.object({
    type: z.literal('terminal.resize'),
    nodeId: opaqueIdSchema,
    cols: z.number().int().min(20).max(240),
    rows: z.number().int().min(5).max(100),
  }).strict(),
  z.object({ type: z.literal('terminal.close'), nodeId: opaqueIdSchema }).strict(),
  z.object({ type: z.literal('terminal.output'), nodeId: opaqueIdSchema, data: z.string().min(1).max(32_768) }).strict(),
  z.object({ type: z.literal('terminal.exit'), nodeId: opaqueIdSchema, exitCode: z.number().int() }).strict(),
  z.object({
    type: z.literal('terminal.error'),
    nodeId: opaqueIdSchema.optional(),
    code: z.string().min(1).max(80),
  }).strict(),
  z.object({
    type: z.literal('voice.transcription.start'),
    requestId: opaqueIdSchema,
    language: z.enum(['auto', 'pt', 'en', 'es']),
    byteLength: z.number().int().min(45).max(3 * 1024 * 1024),
    chunks: z.number().int().min(1).max(64),
  }).strict(),
  z.object({
    type: z.literal('voice.transcription.chunk'),
    requestId: opaqueIdSchema,
    index: z.number().int().min(0).max(63),
    data: z.string().min(1).max(65_536).regex(/^[a-zA-Z0-9_-]+$/),
  }).strict(),
  z.object({ type: z.literal('voice.transcription.finish'), requestId: opaqueIdSchema }).strict(),
  z.object({
    type: z.literal('voice.transcription.result'),
    requestId: opaqueIdSchema,
    text: z.string().trim().min(1).max(10_000),
  }).strict(),
  z.object({
    type: z.literal('voice.transcription.error'),
    requestId: opaqueIdSchema,
    code: z.string().min(1).max(80),
  }).strict(),
  z.object({ type: z.literal('ping'), sentAt: z.number().int().nonnegative() }).strict(),
  z.object({ type: z.literal('pong'), sentAt: z.number().int().nonnegative() }).strict(),
]);

export const collaborationEnvelopeSchema = z.object({
  protocol: z.literal(COLLABORATION_PROTOCOL),
  shareId: opaqueIdSchema,
  senderDeviceId: opaqueIdSchema,
  recipientPeerId: opaqueIdSchema.nullable(),
  keyId: z.string().min(16).max(64).regex(/^[a-zA-Z0-9_-]+$/),
  sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  nonce: z.string().min(16).max(32).regex(/^[a-zA-Z0-9_-]+$/),
  ciphertext: z.string().min(24).max(Math.ceil(MAX_ENCRYPTED_FRAME_BYTES * 4 / 3)),
}).strict();

export function assertOpaqueId(value, label) {
  const parsed = opaqueIdSchema.safeParse(value);
  if (!parsed.success) throw new Error(`${label} is invalid.`);
  return parsed.data;
}

export function assertPairingSecret(value) {
  if (!/^[a-zA-Z0-9_-]{43}$/.test(value)) throw new Error('Pairing secret must contain 32 random bytes.');
  return value;
}

export function createInviteUri(shareId, pairingSecret) {
  assertOpaqueId(shareId, 'Share id');
  assertPairingSecret(pairingSecret);
  return `orkestrai://join/${encodeURIComponent(shareId)}#${pairingSecret}`;
}

export function createWebInviteUri(baseUrl, shareId, pairingSecret) {
  const base = new URL(baseUrl);
  if (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname))) {
    throw new Error('Web invite must use HTTPS.');
  }
  const id = assertOpaqueId(shareId, 'Share id');
  const secret = assertPairingSecret(pairingSecret);
  return new URL(`/join/${encodeURIComponent(id)}#${secret}`, base).toString();
}

export function parseInviteUri(uri) {
  const parsed = new URL(uri);
  const isNative = parsed.protocol === 'orkestrai:' && parsed.hostname === 'join';
  const segments = parsed.pathname.split('/').filter(Boolean);
  const isWeb = (parsed.protocol === 'https:' || (parsed.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)))
    && segments.at(-2) === 'join';
  if (!isNative && !isWeb) throw new Error('Unsupported collaboration invite.');
  const rawShareId = isNative ? parsed.pathname.replace(/^\//, '') : segments.at(-1) ?? '';
  const shareId = assertOpaqueId(decodeURIComponent(rawShareId), 'Share id');
  return { shareId, pairingSecret: assertPairingSecret(parsed.hash.slice(1)) };
}
