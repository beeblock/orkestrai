import { z } from 'zod/v3';

// ── ReviewSchemas Contract Schema ──────────────────────────────────
//
// Single source of truth for validation, API responses, and frontend types.
// Import the Zod schemas for validation, the types for everything else.
//
// Usage:
//   Resource:     import type { ReviewSchemasData } from './review-schemas.schema.js';
//   FormRequest:  import { createReviewSchemasSchema } from './review-schemas.schema.js';
//   Frontend:     import type { ReviewSchemasData, CreateReviewSchemasInput } from '$lib/modules/.../review-schemas.schema';

// ── Response schema (what the API returns) ──────────────────

export const reviewStatusSchema = z.enum(['pending', 'approved', 'changes_requested', 'rejected']);
export const reviewCommentSideSchema = z.enum(['original', 'modified', 'file']);

// ── Input schemas (what the API accepts) ────────────────────

export const createAgentReviewSchema = z.object({
  title: z.string().trim().min(1).max(160),
  summary: z.string().trim().max(4_000).nullish(),
  taskId: z.string().uuid().nullish(),
  assigneeNodeId: z.string().uuid().nullish(),
  selectedPaths: z.array(z.string().trim().min(1).max(1_024)).max(500).default([]),
  evidence: z.array(z.string().trim().min(1).max(1_000)).max(50).default([]),
  tests: z.array(z.string().trim().min(1).max(1_000)).max(50).default([]),
  risks: z.array(z.string().trim().min(1).max(1_000)).max(50).default([]),
});

export const decideAgentReviewSchema = z.object({
  status: z.enum(['approved', 'changes_requested', 'rejected']),
  note: z.string().trim().max(4_000).nullish(),
});

export const createAgentReviewCommentSchema = z.object({
  filePath: z.string().trim().min(1).max(1_024),
  lineNumber: z.number().int().min(1).nullish(),
  side: reviewCommentSideSchema.default('modified'),
  body: z.string().trim().min(1).max(4_000),
  authorNodeId: z.string().uuid().nullish(),
});

export const updateAgentReviewCommentSchema = z.object({
  resolved: z.boolean(),
});

// ── Inferred types — shared between server and frontend ─────

export type ReviewStatus = z.infer<typeof reviewStatusSchema>;
export type ReviewCommentSide = z.infer<typeof reviewCommentSideSchema>;
export type CreateAgentReviewInput = z.infer<typeof createAgentReviewSchema>;
export type DecideAgentReviewInput = z.infer<typeof decideAgentReviewSchema>;
export type CreateAgentReviewCommentInput = z.infer<typeof createAgentReviewCommentSchema>;
export type UpdateAgentReviewCommentInput = z.infer<typeof updateAgentReviewCommentSchema>;

export type AgentReviewCommentData = {
  id: string;
  reviewId: string;
  workspaceId: string;
  authorNodeId: string | null;
  authorTitle: string | null;
  filePath: string;
  lineNumber: number | null;
  side: ReviewCommentSide;
  body: string;
  revision: string;
  status: 'open' | 'resolved';
  stale: boolean;
  createdAt: string;
  updatedAt: string;
};

export type AgentReviewData = {
  id: string;
  workspaceId: string;
  taskId: string | null;
  taskTitle: string | null;
  assigneeNodeId: string | null;
  assigneeTitle: string | null;
  title: string;
  summary: string | null;
  status: ReviewStatus;
  revision: string;
  selectedPaths: string[];
  evidence: string[];
  tests: string[];
  risks: string[];
  decisionNote: string | null;
  decidedAt: string | null;
  createdAt: string;
  updatedAt: string;
  comments: AgentReviewCommentData[];
};

export type ReviewCenterTaskOption = { id: string; title: string; status: string; assigneeNodeId: string | null };
export type ReviewCenterAgentOption = { id: string; title: string; role: string | null; provider: string | null };
export type ReviewCenterSnapshot = {
  git: import('../../application/services/GitService.js').GitStatusResult;
  reviews: AgentReviewData[];
  tasks: ReviewCenterTaskOption[];
  agents: ReviewCenterAgentOption[];
};
export type ReviewDecisionResult = {
  review: AgentReviewData;
  feedback: { delivered: boolean; error: string | null } | null;
};
