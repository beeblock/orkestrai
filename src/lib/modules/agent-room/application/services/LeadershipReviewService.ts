import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open, realpath, stat } from 'node:fs/promises';
import { Connection } from '@beeblock/svelar/database';
import { AgentBoardTask } from '../../domain/models/AgentBoardTask.js';
import { workspaceRepository } from '../../infrastructure/repositories/WorkspaceRepository.js';
import { workspaceLeadershipRepository } from '../../infrastructure/repositories/WorkspaceLeadershipRepository.js';
import { workspaceLeadershipService, leadershipChanged } from './WorkspaceLeadershipService.js';
import { workspacePathService } from './WorkspacePathService.js';
import { designDocumentService } from './DesignDocumentService.js';
import { agentInboxService } from './AgentInboxService.js';
import { LeadershipError, type LeadershipActor, type LeadershipArtifact, type LeadershipCommand, type LeadershipConfiguration, type LeadershipReview, type LeadershipVote } from '../../contracts/schemas/leadership.schema.js';
import type { AgentMessageEnvelope } from '../../domain/types.js';

function stable(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + stable((value as Record<string, unknown>)[key])).join(',') + '}';
  return JSON.stringify(value) ?? 'null';
}
function digest(value: unknown): string { return createHash('sha256').update(stable(value)).digest('hex'); }
export function leadershipTaskRevision(task: AgentBoardTask, patch: Record<string, unknown> = {}): string {
  const keys = ['title', 'description', 'assignee_node_id', 'note_node_id', 'image_path', 'images_json', 'attachments_json'];
  return digest(Object.fromEntries(keys.map((key) => [key, Object.hasOwn(patch, key) ? patch[key] : task.getAttribute(key) ?? null])));
}

export class LeadershipReviewService {
  private readonly finalizing = new Set<string>();
  private readonly maintaining = new Set<string>();
  private readonly maintenanceCursor = new Map<string, string>();

  /** Reuse the Core heartbeat; never add a polling prompt or wake a completed board. */
  async maintain(workspaceId: string): Promise<void> {
    if (this.maintaining.has(workspaceId)) return;
    this.maintaining.add(workspaceId);
    try {
      const workspace = await workspaceRepository.getWorkspace(workspaceId);
      if (!workspace || workspace.suspendedAt) return;
      const pair = await workspaceLeadershipService.configuration(workspaceId);
      const cursor = this.maintenanceCursor.get(workspaceId);
      const active = AgentBoardTask.query().where('workspace_id', workspaceId).where('status', '!=', 'done')
        .whereNull('archived_at').whereNotNull('leadership_review_id').orderBy('id').limit(100).select('id', 'status', 'leadership_review_id');
      if (cursor) active.where('id', '>', cursor);
      const cards = await active.get();
      if (cards.length === 100) this.maintenanceCursor.set(workspaceId, String(cards.at(-1)!.getAttribute('id')));
      else this.maintenanceCursor.delete(workspaceId);
      const cardsById = new Map(cards.map((card) => [String(card.getAttribute('id')), card]));
      const reviews = await workspaceLeadershipRepository.reviewSummaries(workspaceId, cards.map((card) => String(card.getAttribute('leadership_review_id'))));
      const { ptySessionManager } = await import('../../infrastructure/pty/PtySessionManager.js');
      const { controlCenterRepository } = await import('../../infrastructure/repositories/ControlCenterRepository.js');
      for (const review of reviews) {
        const task = cardsById.get(review.taskId);
        if (!task || task.getAttribute('leadership_review_id') !== review.id || !['stale', 'collecting', 'pending'].includes(review.status)) continue;
        if (['done', 'todo', 'blocked', 'error', 'failed'].includes(String(task.getAttribute('status')))) continue;
        if (review.status === 'stale') {
          if (review.findingsCount > 0 || review.leadershipRevision === pair.revision) continue;
          // A role/criteria change starts a new review; do not reuse prior votes.
          const { taskBoardService } = await import('./TaskBoardService.js');
          await taskBoardService.update(workspaceId, review.taskId, { status: 'done', notifyCompletion: false });
          continue;
        }
        if (review.leadershipRevision !== pair.revision) continue;
        for (const [nodeId, vote] of [[review.leaderNodeId, review.leaderDecision], [review.deputyNodeId, review.deputyDecision]] as const) {
          if (vote || Date.now() - Date.parse(review.createdAt) < 90_000) continue;
          const node = await workspaceRepository.getActiveNode(workspaceId, nodeId);
          const payload = node?.payload as { sessionId?: string } | undefined;
          const session = payload?.sessionId ? ptySessionManager.get(payload.sessionId) : null;
          if (!session || session.exited || !session.waiting || Date.now() - Date.parse(session.lastActivityAt) < 60_000) continue;
          if (!ptySessionManager.canAcceptAutomaticMessage(session.id) || await agentInboxService.pendingCount(nodeId)) continue;
          const key = `joint-review-reminder:${review.id}:${session.id}`;
          if ((await controlCenterRepository.inboxByDedupKey(nodeId, key)).length) continue;
          const { agentRuntimeService } = await import('./AgentRuntimeService.js');
          const { autonomyPolicyService } = await import('./AutonomyPolicyService.js');
          if (!(await autonomyPolicyService.runWindow(workspaceId, 'leader_supervision')).allowed) continue;
          try { await agentRuntimeService.assertAutomaticWorkAllowed(nodeId); } catch { continue; }
          await agentInboxService.enqueue({ workspaceId, toNodeId: nodeId, kind: 'leadership_review', dedupKey: key,
            content: `[orkestrai:joint-review] Your independent review is still pending for task ${review.taskId}, review ${review.id}. Read it with orkestrai leadership review read ${review.id}, verify the artifacts and record your own decision. Keep other executable cards progressing.`,
            metadata: { leadershipReviewId: review.id, reviewTaskId: review.taskId } });
        }
      }
    } finally { this.maintaining.delete(workspaceId); }
  }

  async finalizePending(): Promise<void> {
    for (const pending of await workspaceLeadershipRepository.pendingCompletions()) {
      await this.finalize(pending.workspaceId, pending.reviewId, pending.taskId).catch(() => undefined);
    }
  }

  private async finalize(workspaceId: string, reviewId: string, taskId: string): Promise<unknown> {
    if (this.finalizing.has(reviewId)) return null;
    this.finalizing.add(reviewId);
    try {
      if ((await workspaceRepository.getWorkspace(workspaceId))?.suspendedAt) return null;
      const active = await workspaceLeadershipRepository.reviewForTask(workspaceId, taskId);
      if (active?.id !== reviewId || active.status !== 'approved') {
        await workspaceLeadershipRepository.updateReview(workspaceId, reviewId, { completion_pending: false });
        return null;
      }
      const task = await this.task(workspaceId, taskId);
      if (task.getAttribute('status') === 'done') {
        await workspaceLeadershipRepository.updateReview(workspaceId, reviewId, { completion_pending: false });
        return null;
      }
      const { taskBoardService } = await import('./TaskBoardService.js');
      const completed = await taskBoardService.update(workspaceId, taskId, { status: 'done', completedBy: 'joint-review', notifyCompletion: false });
      await workspaceLeadershipRepository.updateReview(workspaceId, reviewId, { completion_pending: false });
      return completed;
    } finally { this.finalizing.delete(reviewId); }
  }
  async envelopeRelevant(envelope: AgentMessageEnvelope): Promise<boolean> {
    const id = envelope.metadata.leadershipReviewId;
    if (typeof id !== 'string') return false;
    const review = await workspaceLeadershipRepository.review(envelope.workspaceId, id);
    if (!review || (await workspaceLeadershipRepository.reviewForTask(envelope.workspaceId, review.taskId))?.id !== id) return false;
    if (envelope.kind === 'leadership_criteria') {
      const task = await this.task(envelope.workspaceId, review.taskId);
      return task.getAttribute('status') !== 'done' && task.getAttribute('assignee_node_id') === envelope.toNodeId
        && leadershipTaskRevision(task) === envelope.metadata.taskRevision;
    }
    const pair = await workspaceLeadershipService.configuration(envelope.workspaceId);
    if (pair.revision !== review.leadershipRevision) return false;
    if (envelope.kind === 'leadership_findings') {
      const task = await this.task(envelope.workspaceId, review.taskId);
      return review.status === 'changes_requested' && task.getAttribute('status') !== 'done'
        && task.getAttribute('assignee_node_id') === envelope.toNodeId;
    }
    const voted = envelope.toNodeId === review.leaderNodeId ? review.leaderVote
      : envelope.toNodeId === review.deputyNodeId ? review.deputyVote : true;
    return !voted && ['collecting', 'pending'].includes(review.status);
  }
  private async task(workspaceId: string, taskId: string): Promise<AgentBoardTask> {
    const task = await AgentBoardTask.query().where('workspace_id', workspaceId).where('id', taskId).whereNull('archived_at').first();
    if (!task) throw new LeadershipError('leadership_task_missing', 404);
    return task;
  }

  async commitMetadataPatch(workspaceId: string, taskId: string, patch: Record<string, unknown>): Promise<void> {
    const releases: Array<() => void> = [];
    await Connection.transaction(async () => {
      const current = await this.task(workspaceId, taskId);
      const review = await workspaceLeadershipRepository.reviewForTask(workspaceId, taskId);
      const definitionChanged = leadershipTaskRevision(current, patch) !== leadershipTaskRevision(current);
      const withdrawn = patch.status !== undefined && patch.status !== current.getAttribute('status')
        && (current.getAttribute('status') === 'done' || ['todo', 'blocked', 'error', 'failed'].includes(String(patch.status)));
      await AgentBoardTask.query().where('workspace_id', workspaceId).where('id', taskId).update(patch);
      if (review && (withdrawn || (current.getAttribute('status') !== 'done' && definitionChanged))) {
        await workspaceLeadershipRepository.updateReview(workspaceId, review.id, { status: 'stale' });
        const changed = await this.task(workspaceId, taskId);
        const assignee = changed.getAttribute('assignee_node_id');
        if (assignee && definitionChanged && changed.getAttribute('status') !== 'done') {
          const revision = leadershipTaskRevision(changed);
          const notice = await agentInboxService.enqueueDeferred({ workspaceId, toNodeId: String(assignee), fromNodeId: null,
            kind: 'leadership_criteria', taskId, content: `[orkestrai:joint-review] Criteria changed for task ${taskId}. Its previous approvals are stale. Read the updated card, implement any required corrections, and request completion again. Keep independent work progressing.`,
            dedupKey: `review-criteria:${review.id}:${revision}`, metadata: { leadershipReviewId: review.id, taskRevision: revision } });
          releases.push(notice.release);
        }
      }
    });
    releases.forEach((release) => release());
  }

  private async artifacts(workspaceId: string, artifacts: LeadershipArtifact[]): Promise<string[]> {
    const workspace = await workspaceRepository.getWorkspace(workspaceId);
    if (!workspace) throw new LeadershipError('leadership_workspace', 404);
    const hashes: string[] = [];
    let remaining = 64 * 1024 * 1024;
    for (const artifact of artifacts) {
      if (artifact.kind === 'file') {
        const path = await workspacePathService.resolveExisting(workspace, artifact.path);
        const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
        try {
          const opened = await file.stat();
          const named = await stat(path);
          if (!opened.isFile() || opened.size > remaining) throw new LeadershipError('leadership_artifact_size', 400);
          if (opened.dev !== named.dev || opened.ino !== named.ino
            || await workspacePathService.resolveExisting(workspace, artifact.path) !== path) throw new LeadershipError('leadership_artifact_changed');
          const hash = createHash('sha256');
          const buffer = Buffer.allocUnsafe(256 * 1024);
          let offset = 0;
          while (offset < opened.size) {
            const { bytesRead } = await file.read(buffer, 0, Math.min(buffer.length, opened.size - offset), offset);
            if (!bytesRead) throw new LeadershipError('leadership_artifact_changed');
            hash.update(buffer.subarray(0, bytesRead));
            offset += bytesRead;
          }
          const after = await file.stat();
          const final = await stat(path);
          if (after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs
            || final.dev !== opened.dev || final.ino !== opened.ino || await realpath(path) !== path
            || await workspacePathService.resolveExisting(workspace, artifact.path) !== path) throw new LeadershipError('leadership_artifact_changed');
          remaining -= opened.size;
          hashes.push(digest({ kind: 'file', path: artifact.path, mode: opened.mode & 0o777, content: hash.digest('hex') }));
        } finally { await file.close(); }
      } else {
        const node = await workspaceRepository.getActiveNode(workspaceId, artifact.nodeId);
        if (!node) throw new LeadershipError('leadership_artifact_missing', 404);
        let version: unknown;
        if (node.type === 'design') version = (await designDocumentService.get(workspaceId, node.id)).revision;
        else if (['note', 'checklist', 'calendar'].includes(node.type)) {
          const serialized = stable(node.payload);
          if (serialized.length > 1_000_000) throw new LeadershipError('leadership_artifact_size', 400);
          version = digest(node.payload);
        } else if (node.type === 'terminal' && !(node.payload as { provider?: string }).provider) {
          const { shellSummary } = await import('./BridgeCanvasService.js');
          version = shellSummary(node)?.revision;
          if (!version) throw new LeadershipError('leadership_artifact_unsupported', 400);
        } else throw new LeadershipError('leadership_artifact_unsupported', 400);
        hashes.push(digest({ kind: 'node', id: node.id, title: node.title, type: node.type, version }));
      }
    }
    return hashes;
  }

  private revision(configuration: LeadershipConfiguration, taskRevision: string, hashes: string[]): string {
    return digest([configuration.revision, configuration.leaderNodeId, configuration.deputyNodeId, taskRevision, hashes]);
  }

  private async notify(workspaceId: string, review: LeadershipReview, title: string, releases: Array<() => void>): Promise<void> {
    for (const nodeId of [review.leaderNodeId, review.deputyNodeId]) {
      const message = await agentInboxService.enqueueDeferred({ workspaceId, toNodeId: nodeId, fromNodeId: null, kind: 'leadership_review',
        content: `[orkestrai:joint-review] Task ${review.taskId}: ${title}. Implementation requested completion; it remains open until BOTH current reviewers approve the SAME revision with no pending findings. ${review.artifacts.length ? `Review ${review.id}, revision ${review.revision}. Inspect and test independently, then use orkestrai leadership review approve ${review.id} --revision ${review.revision} --evidence "what you checked"; report concrete findings with review changes.` : `First land and commit the work on the main checkout if it uses a Floor. Prepare review artifacts with orkestrai leadership review prepare ${review.taskId} --file <workspace-relative-file> (or --node <native-note/design/checklist/calendar-id>).`} A changed artifact or a correction requires fresh approvals from both. Do not wait for the owner or block unrelated cards.`,
        dedupKey: `leadership-review:${review.id}:${nodeId}`, metadata: { leadershipReviewId: review.id, reviewTaskId: review.taskId } });
      releases.push(message.release);
    }
  }

  /** Central task write: with a deputy the same guard covers owner, CLI and MCP completion. */
  async commitCompletion(workspaceId: string, taskId: string, patch: Record<string, unknown>): Promise<{ pending: boolean; review: LeadershipReview | null; alreadyDone?: boolean }> {
    const configuration = await workspaceLeadershipService.configuration(workspaceId);
    const previous = await workspaceLeadershipRepository.reviewForTask(workspaceId, taskId);
    let hashes: string[] | null = null;
    if (configuration.leaderNodeId && configuration.deputyNodeId && previous?.artifacts.length) {
      try { hashes = await this.artifacts(workspaceId, previous.artifacts); }
      catch { /* A changed/missing artifact needs a new review, never an old approval. */ }
    }
    const releases: Array<() => void> = [];
    const result = await Connection.transaction(async () => {
      const current = await this.task(workspaceId, taskId);
      const pair = await workspaceLeadershipService.configuration(workspaceId);
      if (current.getAttribute('status') === 'done' && leadershipTaskRevision(current, patch) === leadershipTaskRevision(current)) {
        return { pending: false, review: previous, alreadyDone: true };
      }
      if (!pair.leaderNodeId || !pair.deputyNodeId) {
        await AgentBoardTask.query().where('id', taskId).where('workspace_id', workspaceId).update(patch);
        return { pending: false, review: null };
      }
      const latest = await workspaceLeadershipRepository.reviewForTask(workspaceId, taskId);
      const taskRevision = leadershipTaskRevision(current, patch);
      const revision = hashes ? this.revision(pair, taskRevision, hashes) : null;
      const same = latest && latest.id === previous?.id && latest.leadershipRevision === pair.revision
        && latest.taskRevision === taskRevision && latest.revision === revision;
      if (same && latest.status === 'approved' && latest.leaderVote?.decision === 'approve' && latest.deputyVote?.decision === 'approve'
        && latest.leaderVote.findings.length === 0 && latest.deputyVote.findings.length === 0) {
        await AgentBoardTask.query().where('id', taskId).where('workspace_id', workspaceId).update(patch);
        return { pending: false, review: latest };
      }
      const sameCollecting = latest && latest.leadershipRevision === pair.revision && latest.taskRevision === taskRevision && latest.status === 'collecting';
      let review = (same && latest.status === 'pending') || sameCollecting ? latest : null;
      if (!review) {
        if (latest) await workspaceLeadershipRepository.updateReview(workspaceId, latest.id, { status: 'stale' });
        const artifacts = previous?.artifacts && hashes ? previous.artifacts : [];
        review = await workspaceLeadershipRepository.createReview({ workspaceId, taskId, leadershipRevision: pair.revision,
          leaderNodeId: pair.leaderNodeId, deputyNodeId: pair.deputyNodeId, artifacts,
          revision: revision ?? this.revision(pair, taskRevision, []), taskRevision,
          status: artifacts.length ? 'pending' : 'collecting', leaderVote: null, deputyVote: null });
        await this.notify(workspaceId, review, String(current.getAttribute('title')), releases);
      }
      const openStatus = ['todo', 'done', 'blocked', 'error', 'failed'].includes(String(current.getAttribute('status'))) ? 'doing' : current.getAttribute('status');
      await AgentBoardTask.query().where('id', taskId).where('workspace_id', workspaceId)
        .update({ ...patch, status: openStatus, leadership_review_id: review!.id });
      return { pending: true, review };
    });
    releases.forEach((release) => release());
    leadershipChanged(workspaceId);
    return result;
  }

  async prepare(workspaceId: string, input: Extract<LeadershipCommand, { command: 'review_prepare' }>, actor: LeadershipActor): Promise<LeadershipReview> {
    const task = await this.task(workspaceId, input.taskId);
    const configuration = await workspaceLeadershipService.configuration(workspaceId);
    if (!configuration.leaderNodeId || !configuration.deputyNodeId) throw new LeadershipError('leadership_pair_required', 400);
    if (task.getAttribute('status') === 'done') throw new LeadershipError('leadership_task_completed', 400);
    if (actor.kind === 'agent' && ![configuration.leaderNodeId, configuration.deputyNodeId, task.getAttribute('assignee_node_id')].includes(actor.nodeId)) {
      throw new LeadershipError('leadership_review_scope', 403);
    }
    const assigneeId = task.getAttribute('assignee_node_id');
    const assignee = assigneeId ? await workspaceRepository.getActiveNode(workspaceId, String(assigneeId)) : null;
    if (assignee?.floorId) {
      const { floorService } = await import('./FloorService.js');
      const floor = await floorService.get(assignee.floorId);
      if (floor && floor.status === 'active' && !floor.landedHead) throw new LeadershipError('leadership_land_required', 409);
    }
    const noteId = task.getAttribute('note_node_id');
    const artifacts: LeadershipArtifact[] = [...input.artifacts];
    if (noteId && !artifacts.some((artifact) => artifact.kind === 'node' && artifact.nodeId === noteId)) {
      if (artifacts.length >= 100) throw new LeadershipError('leadership_artifact_size', 400);
      artifacts.push({ kind: 'node', nodeId: String(noteId) });
    }
    const taskRevision = leadershipTaskRevision(task);
    const hashes = await this.artifacts(workspaceId, artifacts);
    const releases: Array<() => void> = [];
    const review = await Connection.transaction(async () => {
      const pair = await workspaceLeadershipService.configuration(workspaceId);
      const current = await this.task(workspaceId, input.taskId);
      if (pair.revision !== configuration.revision || leadershipTaskRevision(current) !== taskRevision) throw new LeadershipError('leadership_review_stale');
      const previous = await workspaceLeadershipRepository.reviewForTask(workspaceId, input.taskId);
      if (previous) await workspaceLeadershipRepository.updateReview(workspaceId, previous.id, { status: 'stale' });
      const created = await workspaceLeadershipRepository.createReview({ workspaceId, taskId: input.taskId,
        leadershipRevision: pair.revision, leaderNodeId: pair.leaderNodeId!, deputyNodeId: pair.deputyNodeId!,
        artifacts, revision: this.revision(pair, taskRevision, hashes), taskRevision,
        status: 'pending', leaderVote: null, deputyVote: null });
      await AgentBoardTask.query().where('workspace_id', workspaceId).where('id', input.taskId)
        .update({ leadership_review_id: created.id, updated_at: new Date().toISOString() });
      await this.notify(workspaceId, created, String(current.getAttribute('title')), releases);
      return created;
    });
    releases.forEach((release) => release());
    leadershipChanged(workspaceId);
    return review;
  }

  async decide(workspaceId: string, input: Extract<LeadershipCommand, { command: 'review_decide' }>, actor: LeadershipActor) {
    if (actor.kind !== 'agent') throw new LeadershipError('leadership_terminal_required', 403);
    const original = await workspaceLeadershipRepository.review(workspaceId, input.reviewId);
    if (!original) throw new LeadershipError('leadership_review_missing', 404);
    if (input.decision === 'approve' ? input.findings.length !== 0 : input.findings.length === 0) throw new LeadershipError('leadership_findings_invalid', 400);
    if (!original.artifacts.length) throw new LeadershipError('leadership_artifacts_required', 400);
    const taskSnapshot = await this.task(workspaceId, original.taskId);
    if (taskSnapshot.getAttribute('status') === 'done') {
      const priorVote = actor.nodeId === original.leaderNodeId ? original.leaderVote : actor.nodeId === original.deputyNodeId ? original.deputyVote : null;
      if (priorVote && input.expectedRevision === original.revision && priorVote.decision === input.decision
        && stable(priorVote.evidence) === stable(input.evidence) && stable(priorVote.findings) === stable(input.findings)) return { review: original, completion: null };
      throw new LeadershipError('leadership_review_closed');
    }
    const pair = await workspaceLeadershipService.configuration(workspaceId);
    if (![pair.leaderNodeId, pair.deputyNodeId].includes(actor.nodeId)) throw new LeadershipError('leadership_reviewer_required', 403);
    if ((await workspaceRepository.getWorkspace(workspaceId))?.suspendedAt) throw new LeadershipError('leadership_paused', 403);
    const hashes = await this.artifacts(workspaceId, original.artifacts);
    if (original.revision !== this.revision(pair, leadershipTaskRevision(taskSnapshot), hashes)) {
      await workspaceLeadershipRepository.updateReview(workspaceId, original.id, { status: 'stale' });
      leadershipChanged(workspaceId);
      throw new LeadershipError('leadership_review_stale');
    }
    const releases: Array<() => void> = [];
    const voted = await Connection.transaction(async () => {
      const configuration = await workspaceLeadershipService.configuration(workspaceId);
      const review = await workspaceLeadershipRepository.review(workspaceId, original.id);
      const task = await this.task(workspaceId, original.taskId);
      const active = await workspaceLeadershipRepository.reviewForTask(workspaceId, original.taskId);
      if (!review || active?.id !== review.id || review.leadershipRevision !== configuration.revision
        || input.expectedRevision !== review.revision || review.revision !== this.revision(configuration, leadershipTaskRevision(task), hashes)
        || review.status === 'stale') throw new LeadershipError('leadership_review_stale');
      if (review.status === 'changes_requested' && input.decision === 'approve') throw new LeadershipError('leadership_review_reprepare');
      if (task.getAttribute('status') === 'done') {
        const priorVote = actor.nodeId === configuration.leaderNodeId ? review.leaderVote : review.deputyVote;
        if (priorVote?.decision === input.decision && stable(priorVote.evidence) === stable(input.evidence) && stable(priorVote.findings) === stable(input.findings)) return review;
        throw new LeadershipError('leadership_review_closed');
      }
      const role = actor.nodeId === configuration.leaderNodeId ? 'leader' : actor.nodeId === configuration.deputyNodeId ? 'deputy' : null;
      if (!role) throw new LeadershipError('leadership_reviewer_required', 403);
      const existing = role === 'leader' ? review.leaderVote : review.deputyVote;
      if (existing?.decision === input.decision && stable(existing.evidence) === stable(input.evidence) && stable(existing.findings) === stable(input.findings)) return review;
      const vote: LeadershipVote = { nodeId: actor.nodeId, decision: input.decision, evidence: input.evidence, findings: input.findings, at: new Date().toISOString() };
      const leaderVote = role === 'leader' ? vote : review.leaderVote;
      const deputyVote = role === 'deputy' ? vote : review.deputyVote;
      const status = [leaderVote, deputyVote].some((item) => item?.decision === 'changes_requested') ? 'changes_requested'
        : leaderVote?.decision === 'approve' && deputyVote?.decision === 'approve' ? 'approved' : 'pending';
      await workspaceLeadershipRepository.updateReview(workspaceId, review.id, { [`${role}_vote_json`]: JSON.stringify(vote),
        [`${role}_decision`]: vote.decision, status,
        completion_pending: status === 'approved',
        findings_count: (leaderVote?.findings.length ?? 0) + (deputyVote?.findings.length ?? 0) });
      if (input.decision === 'changes_requested') {
        const assignee = task.getAttribute('assignee_node_id');
        if (assignee) {
          const queued = await agentInboxService.enqueueDeferred({ workspaceId, toNodeId: String(assignee), fromNodeId: actor.nodeId,
            kind: 'leadership_findings', taskId: review.taskId,
            content: `[orkestrai:joint-review] Fix findings for task ${review.taskId}: ${input.findings.join('; ')}. Review ${review.id}. After correcting, task done starts a fresh revision for BOTH reviewers. Keep independent cards progressing.`,
            dedupKey: `review-findings:${review.id}:${actor.nodeId}:${digest(input.findings)}`, metadata: { leadershipReviewId: review.id } });
          releases.push(queued.release);
        }
      }
      return { ...review, leaderVote, deputyVote, status } as LeadershipReview;
    });
    releases.forEach((release) => release());
    let completion: unknown = null;
    if (voted.status === 'approved') {
      completion = await this.finalize(workspaceId, voted.id, voted.taskId);
    }
    leadershipChanged(workspaceId);
    return { review: await workspaceLeadershipRepository.reviewForTask(workspaceId, voted.taskId), completion };
  }

  execute(workspaceId: string, input: Extract<LeadershipCommand, { command: 'review_prepare' | 'review_decide' }>, actor: LeadershipActor) {
    return input.command === 'review_prepare' ? this.prepare(workspaceId, input, actor) : this.decide(workspaceId, input, actor);
  }
}
export const leadershipReviewService = new LeadershipReviewService();
