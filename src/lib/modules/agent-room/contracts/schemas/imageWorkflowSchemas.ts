import { z } from 'zod';

export const imageWorkflowStatusSchema = z.enum(['idle', 'running', 'succeeded', 'failed', 'cancelled']);

const relativeDirectorySchema = z.string().trim().min(1).max(240).transform((value) => value.replace(/\\/g, '/')).refine(
  (value) => !value.startsWith('/') && !/^[A-Za-z]:\//.test(value) && !value.split('/').includes('..'),
  'image_workflow_output_path_invalid',
);

export const imageWorkflowConfigSchema = z.object({
  prompt: z.string().trim().min(1).max(32_000),
  count: z.coerce.number().int().min(1).max(4).default(1),
  transparentBackground: z.boolean().default(false),
  outputDirectory: relativeDirectorySchema.default('generated/images'),
  filePrefix: z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/).default('orkestrai-image'),
});

export const runImageWorkflowSchema = imageWorkflowConfigSchema;

export const bridgeRunImageWorkflowSchema = z.object({
  prompt: z.string().trim().min(1).max(32_000).optional(),
  count: z.coerce.number().int().min(1).max(4).optional(),
  transparentBackground: z.boolean().optional(),
  outputDirectory: relativeDirectorySchema.optional(),
  filePrefix: z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/).optional(),
  from: z.string().trim().min(1).max(120).nullish(),
});

export const completeImageWorkflowSchema = z.object({
  runId: z.string().uuid(),
  outputPaths: z.array(relativeDirectorySchema).min(1).max(4),
  from: z.string().trim().min(1).max(120),
});

export const failImageWorkflowSchema = z.object({
  runId: z.string().uuid(),
  errorCode: z.enum(['image_gen_tool_failed', 'image_gen_output_missing', 'image_gen_cancelled']).default('image_gen_tool_failed'),
  from: z.string().trim().min(1).max(120),
});

export type ImageWorkflowConfigInput = z.infer<typeof imageWorkflowConfigSchema>;
export type RunImageWorkflowInput = z.infer<typeof runImageWorkflowSchema>;
export type BridgeRunImageWorkflowInput = z.infer<typeof bridgeRunImageWorkflowSchema>;
export type CompleteImageWorkflowInput = z.infer<typeof completeImageWorkflowSchema>;
export type FailImageWorkflowInput = z.infer<typeof failImageWorkflowSchema>;
