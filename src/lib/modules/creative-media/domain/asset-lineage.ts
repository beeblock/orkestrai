import type { CreativeAssetSnapshot } from './asset-review.js';
import type { CreativeMediaReference } from './types.js';
export type CreativeAssetLineage = {
  actionId: string; sourceNodeId: string; sourceDigest: string;
  source: CreativeAssetSnapshot; frozenReference: CreativeMediaReference;
  operation: string; annotation: unknown;
};
