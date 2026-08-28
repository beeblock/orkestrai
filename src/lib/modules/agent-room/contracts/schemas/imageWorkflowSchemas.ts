import { z } from 'zod';

export const imageWorkflowStatusSchema = z.enum(['idle', 'running', 'succeeded', 'failed', 'cancelled']);

const relativeDirectorySchema = z.string().trim().min(1).max(240).transform((value) => value.replace(/\\/g, '/')).refine(
  (value) => !value.startsWith('/') && !/^[A-Za-z]:\//.test(value) && !value.split('/').includes('..'),
  'image_workflow_output_path_invalid',
);

const relativeFileSchema = z.string().trim().min(1).max(500).transform((value) => value.replace(/\\/g, '/')).refine(
  (value) => !value.startsWith('/') && !/^[A-Za-z]:\//.test(value) && !value.split('/').includes('..'),
  'image_workflow_reference_path_invalid',
);

const workflowConfigFields = {
  count: z.coerce.number().int().min(1).max(10),
  transparentBackground: z.boolean(),
  outputDirectory: relativeDirectorySchema,
  filePrefix: z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/),
};

export const imageWorkflowConfigSchema = z.object({
  prompt: z.string().trim().min(1).max(32_000),
  count: workflowConfigFields.count.default(1),
  transparentBackground: workflowConfigFields.transparentBackground.default(false),
  outputDirectory: workflowConfigFields.outputDirectory.default('generated/images'),
  filePrefix: workflowConfigFields.filePrefix.default('orkestrai-image'),
});

export const runImageWorkflowSchema = imageWorkflowConfigSchema;

export const bridgeRunImageWorkflowSchema = z.object({
  prompt: z.string().trim().min(1).max(32_000).optional(),
  count: workflowConfigFields.count.optional(),
  transparentBackground: workflowConfigFields.transparentBackground.optional(),
  outputDirectory: workflowConfigFields.outputDirectory.optional(),
  filePrefix: workflowConfigFields.filePrefix.optional(),
  from: z.string().trim().min(1).max(120).nullish(),
});

export const createImageWorkflowSchema = z.object({
  title: z.string().trim().min(1).max(120).default('Image workflow'),
  prompt: z.string().trim().max(32_000).default(''),
  count: workflowConfigFields.count.default(1),
  transparentBackground: workflowConfigFields.transparentBackground.default(false),
  outputDirectory: workflowConfigFields.outputDirectory.default('generated/images'),
  filePrefix: workflowConfigFields.filePrefix.default('orkestrai-image'),
  from: z.string().trim().min(1).max(120),
});

export const updateImageWorkflowSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  prompt: z.string().trim().max(32_000).optional(),
  count: workflowConfigFields.count.optional(),
  transparentBackground: workflowConfigFields.transparentBackground.optional(),
  outputDirectory: workflowConfigFields.outputDirectory.optional(),
  filePrefix: workflowConfigFields.filePrefix.optional(),
  from: z.string().trim().min(1).max(120),
}).refine((value) => Object.keys(value).some((key) => key !== 'from'), 'image_workflow_update_empty');

export const connectImageWorkflowNodeSchema = z.object({
  targetNodeId: z.string().uuid(),
  order: z.coerce.number().int().min(0).max(99).optional(),
  from: z.string().trim().min(1).max(120),
});

export const addImageWorkflowReferenceSchema = z.object({
  path: relativeFileSchema,
  title: z.string().trim().min(1).max(120).optional(),
  order: z.coerce.number().int().min(0).max(99).optional(),
  from: z.string().trim().min(1).max(120),
});

export const imageWorkflowActorSchema = z.object({
  from: z.string().trim().min(1).max(120),
});

export const completeImageWorkflowSchema = z.object({
  runId: z.string().uuid(),
  outputPaths: z.array(relativeDirectorySchema).min(1).max(10),
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
export type CreateImageWorkflowInput = z.infer<typeof createImageWorkflowSchema>;
export type UpdateImageWorkflowInput = z.infer<typeof updateImageWorkflowSchema>;
export type ConnectImageWorkflowNodeInput = z.infer<typeof connectImageWorkflowNodeSchema>;
export type AddImageWorkflowReferenceInput = z.infer<typeof addImageWorkflowReferenceSchema>;
export type ImageWorkflowActorInput = z.infer<typeof imageWorkflowActorSchema>;
export type CompleteImageWorkflowInput = z.infer<typeof completeImageWorkflowSchema>;
export type FailImageWorkflowInput = z.infer<typeof failImageWorkflowSchema>;
