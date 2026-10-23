import { z } from 'zod/v3';

const booleanQuery = z.preprocess(
  (value) => value === true || value === 'true' || value === '1',
  z.boolean(),
);

export const listAttentionSchema = z.object({
  workspaceId: z.string().uuid().optional(),
  includeResolved: booleanQuery.default(false),
  limit: z.coerce.number().int().min(1).max(500).default(300),
});

export const updateAttentionSchema = z.object({
  workspaceId: z.string().uuid(),
  status: z.enum(['open', 'read', 'snoozed', 'resolved']),
  snoozedUntil: z.string().datetime().nullable().optional(),
}).superRefine((value, context) => {
  if (value.status === 'snoozed' && !value.snoozedUntil) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['snoozedUntil'],
      message: 'snoozedUntil is required when status is snoozed.',
    });
  }
});

export type ListAttentionInput = z.infer<typeof listAttentionSchema>;
export type UpdateAttentionInput = z.infer<typeof updateAttentionSchema>;

export const decideAttentionSchema = z.object({
  workspaceId: z.string().uuid(),
  decision: z.enum(['approve', 'reject']),
});

export type DecideAttentionInput = z.infer<typeof decideAttentionSchema>;
