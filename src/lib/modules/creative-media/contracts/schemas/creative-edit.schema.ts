import { z } from 'zod';
import { creativeConfigSchema } from './creative-media.schema.js';
export const creativeAnnotationSchema = z.object({
  sourceWidth: z.number().int().min(1).max(16384), sourceHeight: z.number().int().min(1).max(16384),
  x: z.number().finite().min(0).max(1), y: z.number().finite().min(0).max(1),
  width: z.number().finite().positive().max(1), height: z.number().finite().positive().max(1),
}).strict().refine(value => value.x + value.width <= 1.000001 && value.y + value.height <= 1.000001, 'creative_invalid_input');
export const creativeEditSchema = z.object({
  operation: z.enum(['variation', 'remove_background', 'annotated_change', 'animate']),
  direction: z.string().trim().max(16000).default(''),
  executorNodeId: z.string().uuid().nullable().default(null),
  count: z.number().int().min(1).max(10).default(1),
  annotation: creativeAnnotationSchema.optional(),
  config: creativeConfigSchema.optional(),
}).strict().superRefine((value, context) => {
  if (value.operation !== 'remove_background' && !value.direction) context.addIssue({ code: 'custom', path: ['direction'], message: 'creative_prompt_required' });
  if (value.operation === 'annotated_change' && !value.annotation) context.addIssue({ code: 'custom', path: ['annotation'], message: 'creative_invalid_input' });
  if (value.operation !== 'annotated_change' && value.annotation) context.addIssue({ code: 'custom', path: ['annotation'], message: 'creative_invalid_input' });
});
export type CreativeEdit = z.infer<typeof creativeEditSchema>;

export function creativeEditPrompt(input: CreativeEdit) {
  if (input.operation === 'remove_background') return 'Isolate the subject and delete the background. Keep the subject unchanged. Remove every checkerboard square and all background pixels. Return only the subject as a true transparent RGBA PNG cutout, with alpha 0 everywhere outside the subject. No visible checkerboard, no white or gray background, no matte, no shadow, no halo. Do not redraw the subject.';
  const region = input.annotation;
  return [input.direction, region ? `Edit only the rectangle x=${Math.round(region.x * region.sourceWidth)}, y=${Math.round(region.y * region.sourceHeight)}, width=${Math.round(region.width * region.sourceWidth)}, height=${Math.round(region.height * region.sourceHeight)} in the ${region.sourceWidth}x${region.sourceHeight} reference image. Preserve the rest of the composition. The rectangle is a creative instruction, not a supplied raster mask.` : 'Preserve the supplied subject identity and style unless the requested variation explicitly changes them.'].join('\n\n');
}
