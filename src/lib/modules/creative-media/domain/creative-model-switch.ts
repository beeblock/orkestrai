import { creativeConfigSchema, type CreativeConfig } from '../contracts/schemas/creative-media.schema.js';
import { CREATIVE_MODELS } from './catalog.js';
import { CreativeMediaError } from './types.js';

export function switchCreativeModel(previous: CreativeConfig, modelId: string): CreativeConfig {
  const next = CREATIVE_MODELS[modelId as keyof typeof CREATIVE_MODELS];
  // Generic pointer mappings cannot be silently discarded by a curated adapter.
  if (next && (previous.mediaBindings.length || previous.characterBindings.length || Object.keys(previous.parameters).length)) {
    throw new CreativeMediaError('creative_model_mapping_required');
  }
  const references = [...new Set([...previous.requiredReferenceNodeIds, ...[previous.startImageNodeId, previous.endImageNodeId, ...previous.mediaBindings.map(binding => binding.nodeId)].filter((id): id is string => !!id)])];
  return creativeConfigSchema.parse({ ...previous, modelId, requiredReferenceNodeIds: references,
    startImageNodeId: next?.startImage ? previous.startImageNodeId : null,
    endImageNodeId: next?.endImage ? previous.endImageNodeId : null,
  });
}
