import { z } from '@beeblock/svelar/validation';

export const collaborationRoleSchema = z.enum(['viewer', 'collaborator', 'operator', 'administrator']);

export const createCollaborationShareSchema = z.object({
  defaultRole: collaborationRoleSchema.default('viewer'),
  expiresInMinutes: z.coerce.number().int().min(5).max(24 * 60).default(15),
  maxPeers: z.coerce.number().int().min(1).max(5).default(5),
  relayUrl: z.string().url().max(500),
}).strict();

export const collaborationJoinRequestSchema = z.object({
  deviceId: z.string().min(8).max(128).regex(/^[a-zA-Z0-9_-]+$/),
  displayName: z.string().trim().min(1).max(80),
  platform: z.enum(['darwin', 'win32', 'linux', 'ios', 'android', 'web']),
  requestedRole: collaborationRoleSchema.default('viewer'),
  guestNonce: z.string().min(40).max(64).regex(/^[a-zA-Z0-9_-]+$/),
  appVersion: z.string().min(1).max(32),
}).strict();

export const approveCollaborationDeviceSchema = z.object({
  approved: z.boolean(),
  role: collaborationRoleSchema.default('viewer'),
  terminalAccess: z.boolean().default(false),
  designAccess: z.enum(['inherited', 'none', 'view', 'comment', 'propose', 'edit']).default('inherited'),
}).strict();

const taskCreateCommandSchema = z.object({
  type: z.literal('task.create'),
  title: z.string().trim().min(1).max(180),
  description: z.string().trim().max(20_000).nullish(),
  status: z.string().trim().min(1).max(80).optional(),
  assigneeNodeId: z.string().uuid().nullish(),
}).strict();

const taskUpdateCommandSchema = z.object({
  type: z.literal('task.update'),
  taskId: z.string().uuid(),
  title: z.string().trim().min(1).max(180).optional(),
  description: z.string().trim().max(20_000).nullish(),
  status: z.string().trim().min(1).max(80).optional(),
  assigneeNodeId: z.string().uuid().nullish(),
}).strict();

const reviewDecisionCommandSchema = z.object({
  type: z.literal('review.decide'),
  reviewId: z.string().uuid(),
  status: z.enum(['approved', 'changes_requested', 'rejected']),
  note: z.string().trim().max(4_000).nullish(),
}).strict();

const leaderMessageCommandSchema = z.object({
  type: z.literal('leader.message'),
  message: z.string().trim().min(1).max(10_000),
}).strict();

const agentMessageCommandSchema = z.object({
  type: z.literal('agent.message'),
  agentNodeId: z.string().uuid(),
  message: z.string().trim().min(1).max(10_000),
}).strict();

const agentInvokeCommandSchema = z.object({
  type: z.literal('agent.invoke'),
  agentNodeId: z.string().uuid(),
}).strict();

const huddleCreateCommandSchema = z.object({
  type: z.literal('huddle.create'),
  title: z.string().trim().min(1).max(160),
  agenda: z.string().trim().max(8_000).nullish(),
  agentNodeIds: z.array(z.string().uuid()).min(1).max(12),
  facilitatorNodeId: z.string().uuid().nullish(),
}).strict();

const huddleTurnCommandSchema = z.object({
  type: z.literal('huddle.turn'),
  huddleId: z.string().uuid(),
  text: z.string().trim().min(1).max(10_000),
  targetNodeIds: z.array(z.string().uuid()).min(1).max(5),
}).strict();

const huddleEndCommandSchema = z.object({
  type: z.literal('huddle.end'),
  huddleId: z.string().uuid(),
}).strict();

const designCommentCreateCommandSchema = z.object({
  type: z.literal('design.comment.create'),
  nodeId: z.string().uuid(),
  pageId: z.string().uuid(),
  elementId: z.string().uuid().nullish(),
  body: z.string().trim().min(1).max(20_000),
}).strict();

const designCommentReplyCommandSchema = z.object({
  type: z.literal('design.comment.reply'),
  nodeId: z.string().uuid(),
  commentId: z.string().uuid(),
  body: z.string().trim().min(1).max(20_000),
}).strict();

const designCommentResolveCommandSchema = z.object({
  type: z.literal('design.comment.resolve'),
  nodeId: z.string().uuid(),
  commentId: z.string().uuid(),
  status: z.enum(['open', 'resolved']),
}).strict();

const designProposalDecisionCommandSchema = z.object({
  type: z.literal('design.proposal.decide'),
  nodeId: z.string().uuid(),
  proposalId: z.string().uuid(),
  status: z.enum(['approved', 'rejected']),
  note: z.string().trim().max(4_000).nullish(),
}).strict();

const remoteDesignChangesSchema = z.object({
  x: z.number().finite().min(-1_000_000).max(1_000_000),
  y: z.number().finite().min(-1_000_000).max(1_000_000),
  width: z.number().finite().min(1).max(1_000_000),
  height: z.number().finite().min(1).max(1_000_000),
  opacity: z.number().finite().min(0).max(1),
  fill: z.string().regex(/^#[0-9a-fA-F]{6}$/),
}).strict();

const designProposalCreateCommandSchema = z.object({
  type: z.literal('design.proposal.create'),
  nodeId: z.string().uuid(),
  elementId: z.string().uuid(),
  title: z.string().trim().min(1).max(180),
  description: z.string().trim().max(4_000).nullish(),
  changes: remoteDesignChangesSchema,
}).strict();

const designElementUpdateCommandSchema = z.object({
  type: z.literal('design.element.update'),
  nodeId: z.string().uuid(),
  elementId: z.string().uuid(),
  changes: remoteDesignChangesSchema,
}).strict();

const attentionDecisionCommandSchema = z.object({
  type: z.literal('attention.decide'),
  itemId: z.string().uuid(),
  decision: z.enum(['approve', 'reject']),
}).strict();

const attentionAnswerCommandSchema = z.object({
  type: z.literal('attention.answer'),
  itemId: z.string().uuid(),
  text: z.string().trim().min(1).max(4_000),
}).strict();

export const collaborationCommandSchema = z.discriminatedUnion('type', [
  attentionDecisionCommandSchema,
  attentionAnswerCommandSchema,
  taskCreateCommandSchema,
  taskUpdateCommandSchema,
  reviewDecisionCommandSchema,
  leaderMessageCommandSchema,
  agentMessageCommandSchema,
  agentInvokeCommandSchema,
  huddleCreateCommandSchema,
  huddleTurnCommandSchema,
  huddleEndCommandSchema,
  designCommentCreateCommandSchema,
  designCommentReplyCommandSchema,
  designCommentResolveCommandSchema,
  designProposalCreateCommandSchema,
  designProposalDecisionCommandSchema,
  designElementUpdateCommandSchema,
]);

export const executeCollaborationCommandSchema = z.object({
  commandId: z.string().min(8).max(128).regex(/^[a-zA-Z0-9_-]+$/),
  revision: z.number().int().nonnegative(),
  command: collaborationCommandSchema,
}).strict();

export const joinRemoteCollaborationSchema = z.object({
  inviteUri: z.string().trim().min(60).max(1_000).regex(/^orkestrai:\/\/join\/[a-zA-Z0-9_-]+#[a-zA-Z0-9_-]{43}$/),
  relayUrl: z.string().url().max(500),
  displayName: z.string().trim().min(1).max(80),
  platform: z.enum(['darwin', 'win32', 'linux', 'ios', 'android', 'web']),
}).strict();

export const sendRemoteCollaborationCommandSchema = collaborationCommandSchema;

export type CreateCollaborationShareInput = z.infer<typeof createCollaborationShareSchema>;
export type CollaborationJoinRequestInput = z.infer<typeof collaborationJoinRequestSchema>;
export type ApproveCollaborationDeviceInput = z.infer<typeof approveCollaborationDeviceSchema>;
export type ExecuteCollaborationCommandInput = z.infer<typeof executeCollaborationCommandSchema>;
export type JoinRemoteCollaborationInput = z.infer<typeof joinRemoteCollaborationSchema>;
export type SendRemoteCollaborationCommandInput = z.infer<typeof sendRemoteCollaborationCommandSchema>;
