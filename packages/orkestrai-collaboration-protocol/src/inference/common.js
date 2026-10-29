import { z } from 'zod/v3';
export const INFERENCE_PROTOCOL = 'orkestrai-inference.v1';
export const MAX_INFERENCE_FRAME_BYTES = 256 * 1024;
export const MAX_INFERENCE_PLAINTEXT_BYTES = 192 * 1024;
export const MAX_INFERENCE_BODY_BYTES = 32 * 1024 * 1024;
export const inferenceIdSchema = z.string().min(8).max(128).regex(/^[a-zA-Z0-9_-]+$/);
const key = z.string().min(40).max(128).regex(/^[a-zA-Z0-9_-]+$/);
const nonce = z.string().length(43).regex(/^[a-zA-Z0-9_-]+$/);
const signature = z.string().min(80).max(90).regex(/^[a-zA-Z0-9_-]+$/);
const digest = z.string().length(64).regex(/^[a-f0-9]+$/);
const requestId = inferenceIdSchema;
export const inferenceMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('pair.request'), guestId: inferenceIdSchema, name: z.string().trim().min(1).max(100), publicKey: key, ephemeralKey: key, nonce, signature }).strict(),
  z.object({ type: z.literal('pair.control'), guestId: inferenceIdSchema, guestNonce: nonce, state: z.enum(['waiting_approval', 'denied', 'revoked', 'expired', 'incompatible']), signature }).strict(),
  z.object({ type: z.literal('pair.approved'), guestId: inferenceIdSchema, guestNonce: nonce, hostId: inferenceIdSchema, sessionId: inferenceIdSchema,
    hostNonce: nonce, ephemeralKey: key, revision: z.number().int().positive(), expiresAt: z.string().datetime(), name: z.string().min(1).max(100), policy: z.record(z.unknown()), signature }).strict(),
  z.object({ type: z.literal('session.ready'), sessionId: inferenceIdSchema, revision: z.number().int().positive() }).strict(),
  z.object({ type: z.literal('session.revoked'), reason: z.enum(['revoked', 'expired', 'policy_changed', 'offline']) }).strict(),
  z.object({ type: z.literal('body.start'), requestId, kind: z.enum(['inference', 'tool.result', 'tool.call', 'artifact']), size: z.number().int().min(1).max(MAX_INFERENCE_BODY_BYTES), chunks: z.number().int().min(1).max(1024), sha256: digest }).strict(),
  z.object({ type: z.literal('body.chunk'), requestId, index: z.number().int().min(0).max(1023), data: z.string().min(1).max(65536).regex(/^[a-zA-Z0-9_-]+$/) }).strict(),
  z.object({ type: z.literal('body.end'), requestId }).strict(),
  z.object({ type: z.literal('request.accepted'), requestId }).strict(),
  z.object({ type: z.literal('request.queued'), requestId, position: z.number().int().min(1).max(32) }).strict(),
  z.object({ type: z.literal('request.cancel'), requestId }).strict(),
  z.object({ type: z.literal('stream'), requestId, event: z.enum(['text', 'reasoning', 'status']), text: z.string().max(60000) }).strict(),
  z.object({ type: z.literal('tool.call'), requestId, callId: inferenceIdSchema, name: z.string().min(1).max(128), arguments: z.record(z.unknown()) }).strict(),
  z.object({ type: z.literal('request.done'), requestId, status: z.enum(['completed', 'cancelled', 'failed', 'unconfirmed']), code: z.string().max(80).optional() }).strict(),
  z.object({ type: z.literal('ping'), at: z.number().int().nonnegative() }).strict(),
  z.object({ type: z.literal('pong'), at: z.number().int().nonnegative() }).strict(),
]);
export const inferenceEnvelopeSchema = z.object({
  protocol: z.literal(INFERENCE_PROTOCOL), shareId: inferenceIdSchema, senderDeviceId: inferenceIdSchema, recipientPeerId: inferenceIdSchema.nullable(),
  keyId: z.string().min(16).max(64).regex(/^[a-zA-Z0-9_-]+$/), sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  nonce: z.string().length(16).regex(/^[a-zA-Z0-9_-]+$/), ciphertext: z.string().min(24).max(350000).regex(/^[a-zA-Z0-9_-]+$/),
}).strict();

/** @param {string} raw */
export function assertInferenceRelay(raw) {
  const url = new URL(raw);
  if (url.username || url.password || url.hash || url.search || !((url.protocol === 'wss:') || (url.protocol === 'ws:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) throw new Error('INFERENCE_INVALID_RELAY');
  return url;
}
/** @param {{grantId:string,secret:string,ownerPublicKey:string,relayUrl:string}} input */
export function inferenceInvite(input) {
  inferenceIdSchema.parse(input.grantId); nonce.parse(input.secret); key.parse(input.ownerPublicKey); assertInferenceRelay(input.relayUrl);
  return `orkestrai://model-access/${input.grantId}?relay=${encodeURIComponent(input.relayUrl)}#${input.secret}.${input.ownerPublicKey}`;
}
/** @param {string} raw */
export function parseInferenceInvite(raw) {
  const url = new URL(raw);
  if (url.protocol !== 'orkestrai:' || url.hostname !== 'model-access' || url.username || url.password || url.port || url.searchParams.getAll('relay').length !== 1 || [...url.searchParams.keys()].some(k => k !== 'relay')) throw new Error('INFERENCE_INVALID_INVITE');
  const grantId = inferenceIdSchema.parse(url.pathname.slice(1));
  const [secret, ownerPublicKey, extra] = url.hash.slice(1).split('.');
  if (extra || !secret || !ownerPublicKey) throw new Error('INFERENCE_INVALID_INVITE');
  nonce.parse(secret); key.parse(ownerPublicKey);
  const relayUrl = url.searchParams.get('relay') ?? ''; assertInferenceRelay(relayUrl);
  return { grantId, secret, ownerPublicKey, relayUrl };
}
