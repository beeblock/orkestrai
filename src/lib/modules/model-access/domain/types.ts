import type { ModelAccessPeer, ModelAccessPolicy } from '../contracts/schemas/model-access.schema.js';
export const MODEL_ACCESS_AGENT_PROVIDER = 'shared';
export type ModelAccessGrant = {
  id: string; name: string; status: 'draft' | 'active' | 'revoked' | 'expired';
  relayUrl: string; revision: number; policy: ModelAccessPolicy; guest: ModelAccessPeer | null;
  requestsUsed: number; expiresAt: string; createdAt: string; updatedAt: string;
};
export type ModelAccessPublicOffering = Omit<ModelAccessPolicy['offerings'][number], 'profileId'>;
export type ModelAccessPublicPolicy = Omit<ModelAccessPolicy, 'offerings'> & { offerings: ModelAccessPublicOffering[] };
export type ModelAccessConnection = {
  id: string; grantId: string; name: string; relayUrl: string; ownerPublicKey: string;
  guestId: string; guestName: string; status: 'pending' | 'active' | 'revoked' | 'expired';
  policy: ModelAccessPublicPolicy | null; expiresAt: string | null; createdAt: string; updatedAt: string;
};
export type ModelAccessAudit = { id: string; grantId: string; event: string; metadata: Record<string, string | number | boolean | null>; createdAt: string };
export type ModelAccessTransportState = 'connecting' | 'connected' | 'offline' | 'waiting_approval' | 'expired' | 'revoked' | 'error';
