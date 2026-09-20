import type { CreativeConfig, CreativePolicy } from '../contracts/schemas/creative-media.schema.js';
import type { CreativeRunStatus } from './catalog.js';
import type { FalModelContract } from './model-contract.js';
import type { VideoMime } from './video-format.js';

export type CreativeActor = { type: 'user' } | { type: 'agent'; nodeId: string; taskId: string };
export type CreativeProfile = { id: string; name: string; provider: import('./providers.js').CreativeProviderId; enabled: boolean; hasCredential: boolean; revision: number };
export type CreativeWorkspacePolicy = CreativePolicy & { id: string; workspaceId: string; profileId: string; revision: number };
export type CreativeWorkflow = { id: string; workspaceId: string; nodeId: string; title: string; config: CreativeConfig; revision: number };
export type CreativeReference = { nodeId: string; path: string; sha256: string; size: number; mimeType: 'image/png' | 'image/jpeg' | 'image/webp'; width: number; height: number };
export type CreativeSnapshot = {
  config: CreativeConfig; prompt: string; catalogRevision: string; revision: number;
  startImage: CreativeReference | null; endImage: CreativeReference | null;
  modelContract?: FalModelContract;
  media?: Array<{ pointer: string; reference: CreativeMediaReference }>;
  characters?: Array<{ id: string; version: number; digest: string; name: string }>;
};
export type CreativeMediaReference = { nodeId?: string; path: string; sha256: string; size: number; mimeType: string };
export type CreativeVideoAsset = {
  path: string; sha256: string; size: number; mimeType: VideoMime;
  width: number | null; height: number | null; duration: number | null; fps: number | null;
  workflowNodeId: string; runId: string; modelId: CreativeConfig['modelId'];
  outputIndex?: number; additionalOutputs?: CreativeVideoAsset[];
};
export type CreativeRun = {
  id: string; workspaceId: string; workflowId: string; nodeId: string; profileId: string;
  status: CreativeRunStatus; snapshot: CreativeSnapshot; reservedCents: number;
  queuePosition: number | null; errorCode: string | null; output: CreativeVideoAsset | null;
  actor: CreativeActor; createdAt: string; updatedAt: string;
};
export type CreativePreview = {
  id: string; workflowId: string; revision: number; snapshot: CreativeSnapshot;
  profileId: string; profileRevision: number; policyRevision: number;
  estimatedCents: number; reservedCents: number; currency: 'USD'; expiresAt: string;
  priceSource?: 'account_quote' | 'public_list'; priceVerifiedAt?: string;
};

export class CreativeMediaError extends Error {
  constructor(public readonly code: string, public readonly status = 422, public readonly billing?: { unit: string; unitPrice: number; currency: 'USD' }) {
    super(code);
    this.name = 'CreativeMediaError';
  }
}
