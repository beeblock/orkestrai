import { uuidv7 } from '@beeblock/svelar/support';
import { AgentWorkspaceLeadership } from '../../domain/models/AgentWorkspaceLeadership.js';
import { AgentLeadershipHandoff } from '../../domain/models/AgentLeadershipHandoff.js';
import { AgentLeadershipReview } from '../../domain/models/AgentLeadershipReview.js';
import { AgentBoardTask } from '../../domain/models/AgentBoardTask.js';
import { LeadershipError, type LeadershipConfiguration, type LeadershipHandoff, type LeadershipReview, type LeadershipReviewSummary, type LeadershipVote } from '../../contracts/schemas/leadership.schema.js';

function iso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}
function json<T>(value: unknown, fallback: T): T {
  if (!value) return fallback;
  return JSON.parse(String(value)) as T;
}
export function mapLeadership(model: AgentWorkspaceLeadership): LeadershipConfiguration {
  return { workspaceId: model.getAttribute('workspace_id'), leaderNodeId: model.getAttribute('leader_node_id') ?? null,
    deputyNodeId: model.getAttribute('deputy_node_id') ?? null, revision: model.getAttribute('revision') };
}
export function mapLeadershipHandoff(model: AgentLeadershipHandoff): LeadershipHandoff {
  return { id: model.getAttribute('id'), fromNodeId: model.getAttribute('from_node_id') ?? null,
    toNodeId: model.getAttribute('to_node_id'), configurationRevision: model.getAttribute('configuration_revision'),
    status: model.getAttribute('status'), brief: model.getAttribute('brief') ?? null,
    acknowledgedAt: model.getAttribute('acknowledged_at') ? iso(model.getAttribute('acknowledged_at')) : null,
    createdAt: iso(model.getAttribute('created_at')) };
}
export function mapLeadershipReview(model: AgentLeadershipReview): LeadershipReview {
  return { id: model.getAttribute('id'), taskId: model.getAttribute('task_id'),
    leadershipRevision: model.getAttribute('leadership_revision'), leaderNodeId: model.getAttribute('leader_node_id'),
    deputyNodeId: model.getAttribute('deputy_node_id'), revision: model.getAttribute('revision'),
    taskRevision: model.getAttribute('task_revision'), artifacts: json(model.getAttribute('artifacts_json'), []),
    status: model.getAttribute('status'), leaderVote: json<LeadershipVote | null>(model.getAttribute('leader_vote_json'), null),
    deputyVote: json<LeadershipVote | null>(model.getAttribute('deputy_vote_json'), null),
    createdAt: iso(model.getAttribute('created_at')) };
}

export class WorkspaceLeadershipRepository {
  async configuration(workspaceId: string): Promise<AgentWorkspaceLeadership | null> {
    try { return await AgentWorkspaceLeadership.query().where('workspace_id', workspaceId).first(); }
    catch (error) {
      // Older isolated fixtures can contain the legacy node tables only.
      // Never turn a busy/failed database read into an authorization fallback.
      if (error instanceof Error && /no such table: (?:main\.)?agent_workspace_leaderships/i.test(error.message)) return null;
      throw error;
    }
  }

  async saveConfiguration(input: LeadershipConfiguration & { requestId: string }, expectedRevision: string): Promise<void> {
    const existing = await this.configuration(input.workspaceId);
    const values = { leader_node_id: input.leaderNodeId, deputy_node_id: input.deputyNodeId,
      revision: input.revision, last_request_id: input.requestId, updated_at: new Date().toISOString() };
    if (existing) {
      if (existing.getAttribute('revision') !== expectedRevision) throw new LeadershipError('leadership_stale');
      const changed = await AgentWorkspaceLeadership.query().where('id', existing.getAttribute('id')).where('revision', expectedRevision).update(values);
      if (!changed) throw new LeadershipError('leadership_stale');
    }
    else await AgentWorkspaceLeadership.create({ id: uuidv7(), workspace_id: input.workspaceId, ...values, created_at: new Date().toISOString() });
  }

  /** An explicit cross-workspace move removes these roles from the source;
   * it never leaves a configured leader pointing to a deleted node. */
  async detachMovedNodes(workspaceId: string, ids: string[]): Promise<void> {
    const stored = await this.configuration(workspaceId);
    if (!stored) return;
    const before = mapLeadership(stored);
    if (!ids.includes(before.leaderNodeId ?? '') && !ids.includes(before.deputyNodeId ?? '')) return;
    const leaderNodeId = ids.includes(before.leaderNodeId ?? '') ? null : before.leaderNodeId;
    const deputyNodeId = leaderNodeId && !ids.includes(before.deputyNodeId ?? '') ? before.deputyNodeId : null;
    await this.saveConfiguration({ workspaceId, leaderNodeId, deputyNodeId, revision: uuidv7(), requestId: uuidv7() }, before.revision);
  }
  async adoptTransferredPrimary(workspaceId: string, nodeId: string): Promise<void> {
    const stored = await this.configuration(workspaceId);
    if (!stored || stored.getAttribute('leader_node_id')) return;
    const before = mapLeadership(stored);
    await this.saveConfiguration({ ...before, leaderNodeId: nodeId, revision: uuidv7(), requestId: uuidv7() }, before.revision);
  }

  async handoff(workspaceId: string, id: string): Promise<AgentLeadershipHandoff | null> {
    return AgentLeadershipHandoff.query().where('workspace_id', workspaceId).where('id', id).first();
  }
  async handoffByRequest(workspaceId: string, requestId: string): Promise<AgentLeadershipHandoff | null> {
    return AgentLeadershipHandoff.query().where('workspace_id', workspaceId).where('request_id', requestId).first();
  }
  async handoffs(workspaceId: string): Promise<LeadershipHandoff[]> {
    return (await AgentLeadershipHandoff.query().where('workspace_id', workspaceId).orderBy('id', 'desc').limit(20).get()).map(mapLeadershipHandoff);
  }
  async createHandoff(input: { workspaceId: string; fromNodeId: string | null; toNodeId: string; revision: string; requestId: string; context: unknown }): Promise<LeadershipHandoff> {
    const at = new Date().toISOString();
    return mapLeadershipHandoff(await AgentLeadershipHandoff.create({ id: uuidv7(), workspace_id: input.workspaceId,
      from_node_id: input.fromNodeId, to_node_id: input.toNodeId, configuration_revision: input.revision,
      request_id: input.requestId, context_json: JSON.stringify(input.context), brief: null,
      status: 'queued', acknowledged_at: null, created_at: at, updated_at: at }));
  }
  async updateHandoff(workspaceId: string, id: string, changes: Record<string, unknown>): Promise<void> {
    await AgentLeadershipHandoff.query().where('workspace_id', workspaceId).where('id', id)
      .update({ ...changes, updated_at: new Date().toISOString() });
  }

  async review(workspaceId: string, id: string): Promise<LeadershipReview | null> {
    const model = await AgentLeadershipReview.query().where('workspace_id', workspaceId).where('id', id).first();
    return model ? mapLeadershipReview(model) : null;
  }
  async reviewForTask(workspaceId: string, taskId: string): Promise<LeadershipReview | null> {
    const task = await AgentBoardTask.query().where('workspace_id', workspaceId).where('id', taskId).first();
    const id = task?.getAttribute('leadership_review_id');
    return id ? this.review(workspaceId, String(id)) : null;
  }
  async reviews(workspaceId: string, limit = 100): Promise<LeadershipReview[]> {
    return (await AgentLeadershipReview.query().where('workspace_id', workspaceId).orderBy('id', 'desc').limit(limit).get()).map(mapLeadershipReview);
  }
  async reviewSummaries(workspaceId: string, ids?: string[]): Promise<LeadershipReviewSummary[]> {
    if (ids && ids.length === 0) return [];
    const query = AgentLeadershipReview.query().where('workspace_id', workspaceId)
      .select('id', 'task_id', 'leadership_revision', 'leader_node_id', 'deputy_node_id', 'revision', 'status',
        'created_at', 'leader_decision', 'deputy_decision', 'findings_count');
    if (ids) query.whereIn('id', ids);
    else query.orderBy('id', 'desc').limit(100);
    return (await query.get()).map((model) => ({ id: model.getAttribute('id'), taskId: model.getAttribute('task_id'),
      leadershipRevision: model.getAttribute('leadership_revision'), leaderNodeId: model.getAttribute('leader_node_id'),
      deputyNodeId: model.getAttribute('deputy_node_id'), revision: model.getAttribute('revision'),
      status: model.getAttribute('status'), createdAt: iso(model.getAttribute('created_at')),
      leaderDecision: model.getAttribute('leader_decision') ?? null, deputyDecision: model.getAttribute('deputy_decision') ?? null,
      findingsCount: Number(model.getAttribute('findings_count') ?? 0) }));
  }
  async createReview(input: Omit<LeadershipReview, 'id' | 'createdAt'> & { workspaceId: string }): Promise<LeadershipReview> {
    const at = new Date().toISOString();
    return mapLeadershipReview(await AgentLeadershipReview.create({ id: uuidv7(), workspace_id: input.workspaceId,
      task_id: input.taskId, leadership_revision: input.leadershipRevision, leader_node_id: input.leaderNodeId,
      deputy_node_id: input.deputyNodeId, revision: input.revision, task_revision: input.taskRevision,
      artifacts_json: JSON.stringify(input.artifacts), status: input.status,
      leader_vote_json: input.leaderVote ? JSON.stringify(input.leaderVote) : null,
      deputy_vote_json: input.deputyVote ? JSON.stringify(input.deputyVote) : null,
      leader_decision: input.leaderVote?.decision ?? null, deputy_decision: input.deputyVote?.decision ?? null,
      findings_count: (input.leaderVote?.findings.length ?? 0) + (input.deputyVote?.findings.length ?? 0),
      created_at: at, updated_at: at }));
  }
  async updateReview(workspaceId: string, id: string, changes: Record<string, unknown>): Promise<void> {
    await AgentLeadershipReview.query().where('workspace_id', workspaceId).where('id', id)
      .update({ ...changes, ...(changes.status && changes.status !== 'approved' ? { completion_pending: false } : {}), updated_at: new Date().toISOString() });
  }
  async pendingCompletions(): Promise<Array<{ workspaceId: string; reviewId: string; taskId: string }>> {
    return (await AgentLeadershipReview.query().where('completion_pending', true).limit(20)
      .select('id', 'workspace_id', 'task_id').get()).map((row) => ({
        workspaceId: row.getAttribute('workspace_id'), reviewId: row.getAttribute('id'), taskId: row.getAttribute('task_id'),
      }));
  }
}
export const workspaceLeadershipRepository = new WorkspaceLeadershipRepository();
