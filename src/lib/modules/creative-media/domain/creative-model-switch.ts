import { creativeConfigSchema, type CreativeConfig } from '../contracts/schemas/creative-media.schema.js';
import { CREATIVE_MODELS } from './catalog.js';
import { CreativeMediaError } from './types.js';
import type { CreativeProviderId } from './providers.js';

export function expandLegacyCreativeModel(previous: CreativeConfig): CreativeConfig {
  const model = CREATIVE_MODELS[previous.modelId as keyof typeof CREATIVE_MODELS];
  if (!model) return previous;
  if (Object.keys(previous.parameters).length || previous.mediaBindings.length || previous.characterBindings.length) throw new CreativeMediaError('creative_model_mapping_required');
  const mediaBindings = [
    ...(previous.startImageNodeId ? [{ pointer: '/start_image_url', nodeId: previous.startImageNodeId }] : []),
    ...(previous.endImageNodeId ? [{ pointer: '/end_image_url', nodeId: previous.endImageNodeId }] : []),
  ];
  const parameters = model.startImage
    ? { duration: String(previous.duration), negative_prompt: previous.negativePrompt, generate_audio: previous.generateAudio, cfg_scale: 0.5 }
    : { duration: previous.duration, negative_prompt: previous.negativePrompt, aspect_ratio: previous.aspectRatio, resolution: previous.resolution, enable_prompt_expansion: false, enable_safety_checker: true, ...(previous.seed === null ? {} : { seed: previous.seed }) };
  return creativeConfigSchema.parse({ ...previous, modelId: model.endpoint, parameters, mediaBindings, startImageNodeId: null, endImageNodeId: null });
}

export function switchCreativeModel(previous: CreativeConfig, modelId: string, provider: CreativeProviderId = previous.provider, confirmProviderChange = false): CreativeConfig {
  if (provider !== previous.provider) {
    // No cross-provider field equivalence is implied, even for identically named models.
    if (!confirmProviderChange && (previous.mediaBindings.length || previous.characterBindings.length || previous.startImageNodeId || previous.endImageNodeId || Object.keys(previous.parameters).length)) throw new CreativeMediaError('creative_model_mapping_required');
    const requiredReferenceNodeIds = [...new Set([...previous.requiredReferenceNodeIds, ...[previous.startImageNodeId, previous.endImageNodeId, ...previous.mediaBindings.map(binding => binding.nodeId)].filter((id): id is string => !!id)])];
    const mediaBindings = [...previous.mediaBindings,
      ...(previous.startImageNodeId ? [{ pointer: '/start_image_url', nodeId: previous.startImageNodeId }] : []),
      ...(previous.endImageNodeId ? [{ pointer: '/end_image_url', nodeId: previous.endImageNodeId }] : []),
    ];
    return creativeConfigSchema.parse({ ...previous, provider, modelId, profileId: null, parameters: {}, mediaBindings, requiredReferenceNodeIds, startImageNodeId: null, endImageNodeId: null });
  }
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
