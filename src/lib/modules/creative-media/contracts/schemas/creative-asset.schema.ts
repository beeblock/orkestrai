import { z } from 'zod';
export const creativeAssetCommandSchema = z.object({
  command: z.enum(['list', 'inspect', 'decide']),
  nodeId: z.string().uuid().optional(),
  expectedDigest: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  revision: z.number().int().min(0).optional(),
  decision: z.enum(['approved', 'rejected', 'changes_requested', 'proposed']).optional(),
  comment: z.string().trim().max(8000).default(''),
}).strict().superRefine((value, context) => {
  for (const key of value.command === 'decide' ? ['nodeId', 'expectedDigest', 'revision', 'decision'] : value.command === 'inspect' ? ['nodeId'] : []) if (value[key as keyof typeof value] === undefined) context.addIssue({ code: 'custom', path: [key], message: 'creative_invalid_input' });
});
export type CreativeAssetCommand = z.infer<typeof creativeAssetCommandSchema>;
