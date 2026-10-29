import type { z } from 'zod/v3';
import type { Buffer } from 'node:buffer';
export const INFERENCE_PROTOCOL: 'orkestrai-inference.v1';
export const MAX_INFERENCE_FRAME_BYTES: number;
export const MAX_INFERENCE_PLAINTEXT_BYTES: number;
export const MAX_INFERENCE_BODY_BYTES: number;
export type InferenceIdentity = { publicKey: string; privateKey: string };
export type InferenceMaterial = { hostToGuestKey: Buffer; guestToHostKey: Buffer; keyId: string };
export type InferenceEnvelope = { protocol: typeof INFERENCE_PROTOCOL; shareId: string; senderDeviceId: string; recipientPeerId: string | null; keyId: string; sequence: number; nonce: string; ciphertext: string };
export type InferenceMessage =
  | { type: 'pair.request'; guestId: string; name: string; publicKey: string; ephemeralKey: string; nonce: string; signature: string }
  | { type: 'pair.control'; guestId: string; guestNonce: string; state: 'waiting_approval' | 'denied' | 'revoked' | 'expired' | 'incompatible'; signature: string }
  | { type: 'pair.approved'; guestId: string; guestNonce: string; hostId: string; sessionId: string; hostNonce: string; ephemeralKey: string; revision: number; expiresAt: string; name: string; policy: Record<string, unknown>; signature: string }
  | { type: 'session.ready'; sessionId: string; revision: number }
  | { type: 'session.revoked'; reason: 'revoked' | 'expired' | 'policy_changed' | 'offline' }
  | { type: 'body.start'; requestId: string; kind: 'inference' | 'tool.result' | 'tool.call' | 'artifact'; size: number; chunks: number; sha256: string }
  | { type: 'body.chunk'; requestId: string; index: number; data: string }
  | { type: 'body.end'; requestId: string }
  | { type: 'request.accepted'; requestId: string }
  | { type: 'request.queued'; requestId: string; position: number }
  | { type: 'request.cancel'; requestId: string }
  | { type: 'stream'; requestId: string; event: 'text' | 'reasoning' | 'status'; text: string }
  | { type: 'tool.call'; requestId: string; callId: string; name: string; arguments: Record<string, unknown> }
  | { type: 'request.done'; requestId: string; status: 'completed' | 'cancelled' | 'failed' | 'unconfirmed'; code?: string }
  | { type: 'ping' | 'pong'; at: number };
export const inferenceIdSchema: z.ZodString;
export const inferenceMessageSchema: z.ZodType<InferenceMessage>;
export const inferenceEnvelopeSchema: z.ZodType<InferenceEnvelope>;
export function assertInferenceRelay(value: string): URL;
export function inferenceInvite(input: { grantId: string; secret: string; ownerPublicKey: string; relayUrl: string }): string;
export function parseInferenceInvite(value: string): { grantId: string; secret: string; ownerPublicKey: string; relayUrl: string };
export function inferenceIdentity(): InferenceIdentity;
export function inferenceEphemeral(): InferenceIdentity;
export function inferenceNonce(): string;
export function inferenceFingerprint(publicKey: string): string;
export function signInference(privateKey: string, purpose: string, fields: unknown[]): string;
export function verifyInference(publicKey: string, signature: string, purpose: string, fields: unknown[]): boolean;
export function inferencePairingMaterial(secret: string, grantId: string): InferenceMaterial;
export function inferenceSessionMaterial(input: { privateKey: string; remotePublicKey: string; secret: string; grantId: string; sessionId: string; guestNonce: string; hostNonce: string; guestId: string; hostId: string; revision: number }): InferenceMaterial;
export class SecureInferenceChannel {
  grantId: string; localId: string; remoteId: string | null; keyId: string;
  constructor(input: { role: 'host' | 'guest'; grantId: string; localId: string; remoteId: string | null; material: InferenceMaterial });
  encrypt(message: InferenceMessage, recipient?: string | null): InferenceEnvelope;
  decrypt(envelope: unknown): InferenceMessage;
  destroy(): void;
}
