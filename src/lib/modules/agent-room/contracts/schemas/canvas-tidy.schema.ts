import { z } from 'zod/v3';

/** Restore archived canvas nodes by id. */
export const restoreArchivedNodesSchema = z.object({
  nodeIds: z.array(z.string().trim().min(1).max(64)).min(1).max(200),
});

export type RestoreArchivedNodesInput = z.infer<typeof restoreArchivedNodesSchema>;
