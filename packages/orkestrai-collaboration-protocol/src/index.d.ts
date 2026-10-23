import type { z } from 'zod/v3';

export const COLLABORATION_PROTOCOL: 'orkestrai-collaboration.v1';
export const MAX_ENCRYPTED_FRAME_BYTES: number;
export const MAX_PLAINTEXT_BYTES: number;
export const collaborationRoleSchema: z.ZodEnum<['viewer', 'collaborator', 'operator', 'administrator']>;
export const collaborationMessageSchema: z.ZodTypeAny;
export const collaborationEnvelopeSchema: z.ZodTypeAny;
export type CollaborationMessage = z.infer<typeof collaborationMessageSchema>;
export type CollaborationEnvelope = z.infer<typeof collaborationEnvelopeSchema>;

export type SessionMaterial = {
  hostToGuestKey: Buffer;
  guestToHostKey: Buffer;
  keyId: string;
};

export function generatePairingSecret(): string;
export function generateHandshakeNonce(): string;
export function createInviteUri(shareId: string, pairingSecret: string): string;
export function createWebInviteUri(baseUrl: string, shareId: string, pairingSecret: string): string;
export function parseInviteUri(uri: string): { shareId: string; pairingSecret: string };
export function deriveSessionMaterial(input: {
  pairingSecret: string;
  shareId: string;
  sessionId: string;
  hostNonce: string;
  guestNonce: string;
}): SessionMaterial;
export function derivePairingMaterial(input: { pairingSecret: string; shareId: string }): SessionMaterial;

export class SecureCollaborationChannel {
  constructor(input: {
    role: 'host' | 'guest';
    shareId: string;
    localDeviceId: string;
    remoteDeviceId: string;
    material: SessionMaterial;
  });
  encrypt(message: CollaborationMessage, recipientPeerId?: string | null): CollaborationEnvelope;
  decrypt(envelope: CollaborationEnvelope): CollaborationMessage;
  readonly sentSequence: number;
  readonly receivedSequence: number;
  readonly keyId: string;
}
