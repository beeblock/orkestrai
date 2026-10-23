import { z } from 'zod/v3';

// ── Input Schemas ────────────────────────────────────────

export const createPostSchema = z.object({
  title: z.string().min(3, 'Title must be at least 3 characters').max(255),
  slug: z.string().regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with dashes').optional(),
  body: z.string().min(10, 'Body must be at least 10 characters'),
  published: z.boolean().default(false),
});

export const updatePostSchema = z.object({
  title: z.string().min(3).max(255).optional(),
  slug: z.string().regex(/^[a-z0-9-]+$/).optional(),
  body: z.string().min(10).optional(),
  published: z.boolean().optional(),
});

// ── Inferred Types ───────────────────────────────────────

export type CreatePostInput = z.infer<typeof createPostSchema>;
export type UpdatePostInput = z.infer<typeof updatePostSchema>;

// ── Response Schema (Resources + API contracts) ──────────

export const postResponseSchema = z.object({
  id: z.number(),
  title: z.string(),
  slug: z.string(),
  body: z.string(),
  published: z.boolean(),
  user_id: z.number(),
  created_at: z.string().nullable(),
  updated_at: z.string().nullable(),
});

export type PostResponse = z.infer<typeof postResponseSchema>;
