// Shared with the renderer; Svelar's validation barrel includes Node-only rules.
import { z } from 'zod';
import { importedVideoMime, MAX_IMPORTED_VIDEO_BYTES } from '../../domain/video-format.js';

export const creativeVideoUploadSchema = z.object({
  file: z.custom<File>((value) => typeof File !== 'undefined' && value instanceof File)
    .refine(file => file?.size >= 32 && file?.size <= MAX_IMPORTED_VIDEO_BYTES, 'creative_video_import_size')
    .refine(file => typeof file?.name === 'string' && importedVideoMime(file.name) !== null, 'creative_video_import_format'),
  x: z.coerce.number().finite().min(-1_000_000).max(1_000_000).default(100),
  y: z.coerce.number().finite().min(-1_000_000).max(1_000_000).default(100),
  floorId: z.preprocess(value => value === '' ? null : value, z.string().uuid().nullable().default(null)),
}).strict();
