import { z } from 'zod';

// Schemas de filesystem/git — compartilhados backend/frontend.

export const fsWriteSchema = z.object({
  path: z.string().trim().min(1),
  content: z.string(),
});

export const gitPathSchema = z.object({
  path: z.string().trim().min(1).max(4_000),
});

export const gitOperationSchema = z.enum([
  'fetch', 'pull', 'push', 'checkout', 'createBranch', 'renameBranch',
  'deleteBranch', 'merge', 'rebase', 'cherryPick', 'revert', 'createTag',
  'deleteTag', 'stash', 'stashPop', 'abortMerge', 'abortRebase',
]);

export const gitOperationInputSchema = z.object({
  operation: gitOperationSchema,
  ref: z.string().trim().min(1).max(300).optional(),
  name: z.string().trim().min(1).max(240).optional(),
  remote: z.string().trim().min(1).max(240).optional(),
  message: z.string().trim().min(1).max(1_000).optional(),
  force: z.boolean().default(false),
  setUpstream: z.boolean().default(false),
});

export const executeGitOperationSchema = gitOperationInputSchema.extend({
  expectedRevision: z.string().regex(/^[0-9a-f]{64}$/i),
  confirmed: z.boolean().default(false),
});

export type FsWriteInput = z.infer<typeof fsWriteSchema>;
export type GitPathInput = z.infer<typeof gitPathSchema>;
export type GitOperationInput = z.infer<typeof gitOperationInputSchema>;
export type ExecuteGitOperationInput = z.infer<typeof executeGitOperationSchema>;
