import type { CreativeMediaReference } from './types.js';
export type CreativeAssetSummary = { nodeId: string; type: 'image' | 'video'; title: string; path: string; groupId: string | null };
export type CreativeAssetSnapshot = { media: CreativeMediaReference; origin: { workflowNodeId: string | null; runId: string | null; inputHash: string | null }; characters: Array<{ id: string; version: number; digest: string; name: string }> };
export type CreativeAssetReview = { id: string; nodeId: string; revision: number; digest: string; decision: 'approved' | 'rejected' | 'changes_requested' | 'proposed'; comment: string; snapshot: CreativeAssetSnapshot; createdAt: string; actorType: string; actorId: string | null };
export type CreativeAssetInspection = { asset: CreativeAssetSummary; snapshot: CreativeAssetSnapshot; digest: string; review: CreativeAssetReview | null; history: CreativeAssetReview[]; reviewCurrent: boolean };
