import type { z } from 'zod/v3';

export const COLLABORATION_PROTOCOL: 'orkestrai-collaboration.v1';
export const MAX_ENCRYPTED_FRAME_BYTES: number;
export const MAX_PLAINTEXT_BYTES: number;
export const collaborationRoleSchema: z.ZodEnum<['viewer', 'collaborator', 'operator', 'administrator']>;
export const collaborationMessageSchema: z.ZodTypeAny;
export const collaborationEnvelopeSchema: z.ZodTypeAny;
export type CollaborationMessage = z.infer<typeof collaborationMessageSchema>;
export type CollaborationEnvelope = z.infer<typeof collaborationEnvelopeSchema>;

export type BrowserSessionMaterial = {
  hostToGuestKey: CryptoKey;
  guestToHostKey: CryptoKey;
  keyId: string;
};

export function generatePairingSecret(): string;
export function generateHandshakeNonce(): string;
export function importPairingSecret(pairingSecret: string): Promise<CryptoKey>;
export function createInviteUri(shareId: string, pairingSecret: string): string;
export function createWebInviteUri(baseUrl: string, shareId: string, pairingSecret: string): string;
export function parseInviteUri(uri: string): { shareId: string; pairingSecret: string };
export function deriveSessionMaterial(input: {
  pairingKey: CryptoKey;
  shareId: string;
  sessionId: string;
  hostNonce: string;
  guestNonce: string;
}): Promise<BrowserSessionMaterial>;
export function derivePairingMaterial(input: { pairingKey: CryptoKey; shareId: string }): Promise<BrowserSessionMaterial>;

export class SecureCollaborationChannel {
  constructor(input: {
    role: 'host' | 'guest';
    shareId: string;
    localDeviceId: string;
    remoteDeviceId: string;
    material: BrowserSessionMaterial;
  });
  encrypt(message: CollaborationMessage, recipientPeerId?: string | null): Promise<CollaborationEnvelope>;
  decrypt(envelope: CollaborationEnvelope): Promise<CollaborationMessage>;
  readonly sentSequence: number;
  readonly receivedSequence: number;
  readonly keyId: string;
}
