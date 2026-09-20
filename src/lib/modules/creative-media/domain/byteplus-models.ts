import type { ModelSchema } from './model-contract.js';

// Production IDs/rates verified 2026-09-20 against ModelArk docs 1520757/1544106.
export const BYTEPLUS_MODELS = [
  { id: 'dreamina-seedance-2-5-260628', name: 'Seedance 2.5', duration: 30, images: 30, media: 10, resolutions: ['480p', '720p', '1080p'], rates: { '480p': [10.7, 6.4], '720p': [10.7, 6.4], '1080p': [11.7, 7] } },
  { id: 'dreamina-seedance-2-0-260128', name: 'Seedance 2.0', duration: 15, images: 9, media: 3, resolutions: ['480p', '720p', '1080p', '4k'], rates: { '480p': [7, 4.3], '720p': [7, 4.3], '1080p': [7.7, 4.7], '4k': [4, 2.4] } },
  { id: 'dreamina-seedance-2-0-fast-260128', name: 'Seedance 2.0 Fast', duration: 15, images: 9, media: 3, resolutions: ['480p', '720p'], rates: { '480p': [5.6, 3.3], '720p': [5.6, 3.3] } },
  { id: 'dreamina-seedance-2-0-mini-260615', name: 'Seedance 2.0 Mini', duration: 15, images: 9, media: 3, resolutions: ['480p', '720p'], rates: { '480p': [3.5, 2.1], '720p': [3.5, 2.1] } },
] as const;

export function byteplusSchema(model: typeof BYTEPLUS_MODELS[number]): ModelSchema {
  const url = (title: string): ModelSchema => ({ type: 'string', title, minLength: 1 });
  const urls = (title: string, count: number): ModelSchema => ({ type: 'array', title, minItems: 1, maxItems: count, items: url(title) });
  return { type: 'object', additionalProperties: false, required: ['prompt', 'duration', 'resolution', 'ratio'], properties: {
    prompt: { type: 'string', minLength: 1, maxLength: 50000 },
    duration: { type: 'integer', minimum: 4, maximum: model.duration, default: 5 },
    resolution: { type: 'string', enum: [...model.resolutions], default: '720p' },
    ratio: { type: 'string', enum: ['adaptive', '16:9', '4:3', '1:1', '3:4', '9:16', '21:9'], default: 'adaptive' },
    generate_audio: { type: 'boolean', default: true }, watermark: { type: 'boolean', default: false },
    seed: { type: 'integer', minimum: -1, maximum: 2147483647, default: -1 },
    return_last_frame: { type: 'boolean', default: true },
    first_image_url: url('First frame'), last_image_url: url('Last frame'),
    image_urls: urls('Reference images', model.images), video_urls: urls('Public reference videos', model.media), audio_urls: urls('Reference audio', model.media),
    ...(model.duration === 30 ? { output_format: { type: 'string', enum: ['mp4', 'mov'], default: 'mp4' } } : {}),
  } };
}
