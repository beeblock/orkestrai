export const CREATIVE_MODELS = {
  'wan-2.7-text': {
    id: 'wan-2.7-text', provider: 'fal', name: 'Wan 2.7', mode: 'text-to-video',
    endpoint: 'fal-ai/wan/v2.7/text-to-video',
    promptLimit: 5000, negativePromptLimit: 500, minDuration: 2, maxDuration: 15,
    aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4'], resolutions: ['720p', '1080p'],
    startImage: false, endImage: false, audioToggle: false, seed: true,
    documentationUrl: 'https://fal.ai/models/fal-ai/wan/v2.7/text-to-video/api',
  },
  'kling-v3-pro-image': {
    id: 'kling-v3-pro-image', provider: 'fal', name: 'Kling 3 Pro', mode: 'image-to-video',
    endpoint: 'fal-ai/kling-video/v3/pro/image-to-video',
    promptLimit: 2500, negativePromptLimit: 2500, minDuration: 3, maxDuration: 15,
    aspectRatios: [], resolutions: [], startImage: true, endImage: true, audioToggle: true, seed: false,
    documentationUrl: 'https://fal.ai/models/fal-ai/kling-video/v3/pro/image-to-video/api',
  },
} as const;

export type CreativeModelId = keyof typeof CREATIVE_MODELS;
export const CREATIVE_MODEL_IDS = ['wan-2.7-text', 'kling-v3-pro-image'] as const;
export const CREATIVE_CATALOG_REVISION = '2026-09-17.1';
export const MAX_CREATIVE_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_CREATIVE_VIDEO_BYTES = 256 * 1024 * 1024;

export const CREATIVE_RUN_STATUSES = [
  'queued', 'submitting', 'submission_uncertain', 'provider_running', 'downloading',
  'download_failed', 'cancel_requested', 'cancelled', 'completed', 'failed', 'closed_unconfirmed',
] as const;
export type CreativeRunStatus = typeof CREATIVE_RUN_STATUSES[number];
export const ACTIVE_CREATIVE_STATUSES: CreativeRunStatus[] = [
  'queued', 'submitting', 'submission_uncertain', 'provider_running', 'downloading', 'cancel_requested',
];
