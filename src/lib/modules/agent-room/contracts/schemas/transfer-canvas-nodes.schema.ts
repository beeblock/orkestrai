import { z } from '@beeblock/svelar/validation';

export const transferCanvasNodesSchema = z.object({
  destinationWorkspaceId: z.string().uuid(),
  nodeIds: z.array(z.string().uuid()).min(1).max(100).transform((ids) => [...new Set(ids)]),
  mode: z.enum(['copy', 'move']),
}).strict();

export type TransferCanvasNodesInput = z.infer<typeof transferCanvasNodesSchema>;
