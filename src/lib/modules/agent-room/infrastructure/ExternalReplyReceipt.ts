import { createHash, timingSafeEqual } from 'node:crypto';

export type ExternalReplyCredentials = { clientId: string; requestId: string; receipt: string };
export type ExternalReplyTarget = { clientId: string; requestId: string; receiptHash: string };
const nonce = /^[a-f0-9]{32}$/;
const digest = /^[a-f0-9]{64}$/;

export function externalReplyCorrelation(input: Pick<ExternalReplyCredentials, 'clientId' | 'requestId'>): string {
  return `external:${input.clientId}:${input.requestId}`;
}

/** Persist the verifier, never the client's private return receipt. */
export function externalReplyTarget(input: ExternalReplyCredentials): ExternalReplyTarget {
  return { clientId: input.clientId, requestId: input.requestId,
    receiptHash: createHash('sha256').update(input.receipt).digest('hex') };
}

export function savedExternalReply(metadata: Record<string, unknown>): ExternalReplyTarget | null {
  const value = metadata.externalReply;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const target = value as Record<string, unknown>;
  if (typeof target.clientId !== 'string' || !nonce.test(target.clientId)
    || typeof target.requestId !== 'string' || !nonce.test(target.requestId)
    || typeof target.receiptHash !== 'string' || !digest.test(target.receiptHash)) return null;
  return target as ExternalReplyTarget;
}

export function verifiesExternalReply(metadata: Record<string, unknown>, input: ExternalReplyCredentials): boolean {
  const saved = savedExternalReply(metadata);
  if (!saved || saved.clientId !== input.clientId || saved.requestId !== input.requestId) return false;
  return timingSafeEqual(Buffer.from(saved.receiptHash, 'hex'), Buffer.from(externalReplyTarget(input).receiptHash, 'hex'));
}

export function hasReplyRecipient(envelope: { fromNodeId: string | null; metadata: Record<string, unknown> }): boolean {
  return Boolean(envelope.fromNodeId || savedExternalReply(envelope.metadata));
}
