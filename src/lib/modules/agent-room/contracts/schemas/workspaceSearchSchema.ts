import { z } from 'zod/v3';

const booleanQuery = z.preprocess(
  (value) => value === true || value === 'true' || value === '1',
  z.boolean(),
);

export const workspaceSearchSchema = z.object({
  q: z.string().trim().min(1).max(120),
  workspaceId: z.string().trim().min(1).optional(),
  includeFiles: booleanQuery.default(false),
  limit: z.coerce.number().int().min(1).max(100).default(60),
});

export type WorkspaceSearchInput = z.infer<typeof workspaceSearchSchema>;
