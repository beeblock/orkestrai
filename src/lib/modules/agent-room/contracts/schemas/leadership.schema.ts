import { z } from 'zod/v3';

export const leadershipRoleSchema = z.enum(['specialist', 'leader', 'deputy']);
const uuid = z.string().uuid();
const note = z.string().trim().max(8_000);
const expectedRevision = z.string().trim().min(1).max(128);
export const leadershipArtifactSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('file'), path: z.string().trim().min(1).max(2_000) }),
  z.object({ kind: z.literal('node'), nodeId: uuid }),
]);
export const leadershipCommandSchema = z.discriminatedUnion('command', [
  z.object({ command: z.literal('configure'), requestId: uuid, expectedRevision,
    leaderNodeId: uuid.nullable(), deputyNodeId: uuid.nullable(), note: note.optional(), taskId: uuid.optional() }),
  z.object({ command: z.literal('handoff_read'), handoffId: uuid,
    section: z.enum(['overview', 'instructions', 'messages', 'tasks', 'notes', 'learning']).default('overview'),
    offset: z.number().int().min(0).max(10_000).default(0) }),
  z.object({ command: z.literal('handoff_brief'), handoffId: uuid, brief: note.min(1) }),
  z.object({ command: z.literal('handoff_acknowledge'), handoffId: uuid }),
  z.object({ command: z.literal('review_prepare'), taskId: uuid,
    artifacts: z.array(leadershipArtifactSchema).min(1).max(100), note: note.optional() }),
  z.object({ command: z.literal('review_read'), reviewId: uuid }),
  z.object({ command: z.literal('review_decide'), reviewId: uuid, expectedRevision,
    decision: z.enum(['approve', 'changes_requested']),
    evidence: z.array(z.string().trim().min(1).max(2_000)).min(1).max(30),
    findings: z.array(z.string().trim().min(1).max(2_000)).max(30).default([]) }),
]);
export const bridgeLeadershipCommandSchema = z.object({
  token: z.string().trim().nullish(), from: z.string().trim().max(128).optional(),
  input: leadershipCommandSchema,
});

export type LeadershipRole = z.infer<typeof leadershipRoleSchema>;
export type LeadershipCommand = z.infer<typeof leadershipCommandSchema>;
export type LeadershipArtifact = z.infer<typeof leadershipArtifactSchema>;
export type LeadershipActor = { kind: 'owner' } | { kind: 'agent'; nodeId: string };
export type LeadershipConfiguration = {
  workspaceId: string; leaderNodeId: string | null; deputyNodeId: string | null; revision: string;
};
export type LeadershipAgent = { id: string; title: string; provider: string; role: LeadershipRole };
export type LeadershipVote = {
  nodeId: string; decision: 'approve' | 'changes_requested'; evidence: string[]; findings: string[]; at: string;
};
export type LeadershipReview = {
  id: string; taskId: string; leadershipRevision: string; leaderNodeId: string; deputyNodeId: string;
  revision: string; taskRevision: string; artifacts: LeadershipArtifact[];
  status: 'collecting' | 'pending' | 'changes_requested' | 'approved' | 'stale';
  leaderVote: LeadershipVote | null; deputyVote: LeadershipVote | null; createdAt: string;
};
export type LeadershipReviewSummary = Pick<LeadershipReview,
  'id' | 'taskId' | 'leadershipRevision' | 'leaderNodeId' | 'deputyNodeId' | 'revision' | 'status' | 'createdAt'> & {
  leaderDecision: LeadershipVote['decision'] | null; deputyDecision: LeadershipVote['decision'] | null; findingsCount: number;
};
export function leadershipReviewSummary(review: LeadershipReview): LeadershipReviewSummary {
  const { id, taskId, leadershipRevision, leaderNodeId, deputyNodeId, revision, status, createdAt } = review;
  return { id, taskId, leadershipRevision, leaderNodeId, deputyNodeId, revision, status, createdAt,
    leaderDecision: review.leaderVote?.decision ?? null, deputyDecision: review.deputyVote?.decision ?? null,
    findingsCount: (review.leaderVote?.findings.length ?? 0) + (review.deputyVote?.findings.length ?? 0) };
}
export type LeadershipHandoff = {
  id: string; fromNodeId: string | null; toNodeId: string; configurationRevision: string;
  status: string; brief: string | null; acknowledgedAt: string | null; createdAt: string;
};
export type LeadershipSnapshot = {
  configuration: LeadershipConfiguration; agents: LeadershipAgent[];
  handoffs: LeadershipHandoff[]; reviews: LeadershipReviewSummary[];
};

export class LeadershipError extends Error {
  constructor(readonly code: string, readonly status = 409) { super(code); }
}
