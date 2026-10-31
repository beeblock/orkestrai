import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSvelarTest } from '@beeblock/svelar/testing';
import { uuidv7 } from '@beeblock/svelar/support';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { workspaceLeadershipService } from '$lib/modules/agent-room/application/services/WorkspaceLeadershipService.js';
import { leadershipReviewService } from '$lib/modules/agent-room/application/services/LeadershipReviewService.js';
import { workspaceLeadershipRepository } from '$lib/modules/agent-room/infrastructure/repositories/WorkspaceLeadershipRepository.js';
import { workspaceRepository } from '$lib/modules/agent-room/infrastructure/repositories/WorkspaceRepository.js';
import { channelRepository } from '$lib/modules/agent-room/infrastructure/repositories/ChannelRepository.js';
import { controlCenterRepository } from '$lib/modules/agent-room/infrastructure/repositories/ControlCenterRepository.js';
import { agentInboxService } from '$lib/modules/agent-room/application/services/AgentInboxService.js';
import { taskBoardService } from '$lib/modules/agent-room/application/services/TaskBoardService.js';
import { WorkspaceLeadershipDto } from '$lib/modules/agent-room/application/dto/WorkspaceLeadershipDto.js';
import type { LeadershipReview } from '$lib/modules/agent-room/contracts/schemas/leadership.schema.js';
import { WorkspaceLeadershipController } from '$lib/modules/agent-room/interface/http/controllers/WorkspaceLeadershipController.js';
import { ptySessionManager } from '$lib/modules/agent-room/infrastructure/pty/PtySessionManager.js';
import { AgentBoardTask } from '$lib/modules/agent-room/domain/models/AgentBoardTask.js';
import { workspaceService } from '$lib/modules/agent-room/application/services/WorkspaceService.js';
import { CreateCanvasNodeDto } from '$lib/modules/agent-room/application/dto/WorkspaceDtos.js';
import { providerProfileService } from '$lib/modules/agent-room/application/services/ProviderProfileService.js';
import type { TerminalNodePayload } from '$lib/modules/agent-room/domain/types.js';

const owner = { kind: 'owner' as const };
describe('Workspace leadership', () => {
  useSvelarTest({ refreshDatabase: true });
  const dirs: string[] = [];
  beforeEach(() => {
    agentInboxService.reset();
    const enqueue = agentInboxService.enqueueDeferred.bind(agentInboxService);
    vi.spyOn(agentInboxService, 'enqueueDeferred').mockImplementation(async (input) => ({
      ...await enqueue(input), release: vi.fn(), // Persist the REAL envelope; never start a provider in this fixture.
    }));
    vi.spyOn(agentInboxService, 'transcriptFor').mockResolvedValue({ provider: null, cwd: '/tmp', agentSessionId: null, options: {} });
  });
  afterEach(async () => {
    agentInboxService.reset();
    vi.restoreAllMocks();
    for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
  });
  async function team() {
    const dir = await mkdtemp(join(tmpdir(), 'orkestrai-leadership-'));
    dirs.push(dir);
    const workspace = await workspaceRepository.createWorkspace({ name: 'Leadership', workingDir: dir });
    const lead = await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'terminal', title: 'Claude Lead',
      payload: { provider: 'claude', maestro: true, profileId: 'work-account', agentSessionId: uuidv7(), args: ['--model', 'original-model'] } });
    const next = await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'terminal', title: 'Codex Lead',
      payload: { provider: 'codex', profileId: 'codex-account', agentSessionId: uuidv7(), args: ['--model', 'next-model'] } });
    const worker = await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'terminal', title: 'Worker', payload: { provider: 'claude' } });
    return { workspace, dir, lead, next, worker };
  }
  async function pair(t: Awaited<ReturnType<typeof team>>) {
    const configuration = await workspaceLeadershipService.configuration(t.workspace.id);
    return workspaceLeadershipService.configure(t.workspace.id, { command: 'configure', requestId: uuidv7(), expectedRevision: configuration.revision,
      leaderNodeId: t.lead.id, deputyNodeId: t.next.id }, owner);
  }
  async function task(t: Awaited<ReturnType<typeof team>>) {
    return taskBoardService.create(t.workspace.id, { title: 'Deliver the feature', assigneeNodeId: t.worker.id, status: 'doing', createdBy: 'test', dispatch: false });
  }
  async function vote(ws: string, review: LeadershipReview, nodeId: string, decision: 'approve' | 'changes_requested' = 'approve') {
    return leadershipReviewService.decide(ws, { command: 'review_decide', reviewId: review.id, expectedRevision: review.revision,
      decision, evidence: ['Independently tested the referenced feature'], findings: decision === 'changes_requested' ? ['Fix the broken interaction'] : [] }, { kind: 'agent', nodeId });
  }

  it('hands Claude context to Codex without overwriting either conversation, account or model', async () => {
    const t = await team();
    await channelRepository.save({ workspaceId: t.workspace.id, channel: `dm:${t.lead.id}`, authorKind: 'owner', body: 'Finish checkout and preserve the test evidence.' });
    const work = await taskBoardService.create(t.workspace.id, { title: 'Coordinate checkout', assigneeNodeId: t.lead.id, createdBy: 'test', dispatch: false });
    const before = await workspaceLeadershipService.configuration(t.workspace.id);
    const input = { command: 'configure' as const, requestId: uuidv7(), expectedRevision: before.revision, leaderNodeId: t.next.id, deputyNodeId: t.lead.id };
    const result = await workspaceLeadershipService.configure(t.workspace.id, input, owner);
    expect(result.handoff).not.toBeNull();
    expect((await workspaceRepository.getNode(t.next.id))?.payload).toEqual({ ...t.next.payload, maestro: true, deputy: false });
    expect((await workspaceRepository.getNode(t.lead.id))?.payload).toEqual({ ...t.lead.payload, maestro: false, deputy: true });
    expect((await taskBoardService.list(t.workspace.id)).find((item) => item.id === work.id)?.assigneeNodeId).toBe(t.next.id);
    const context = await workspaceLeadershipService.execute(new WorkspaceLeadershipDto(t.workspace.id, { command: 'handoff_read', handoffId: result.handoff!.id, section: 'messages', offset: 0 }), owner) as { entries: Array<{ body: string }> };
    expect(context.entries[0].body).toContain('Finish checkout');
    expect((await controlCenterRepository.inboxEnvelopes(t.next.id, ['queued'])).length).toBe(1);
    const repeated = await workspaceLeadershipService.configure(t.workspace.id, input, owner);
    expect(repeated.handoff?.id).toBe(result.handoff!.id);
    expect((await controlCenterRepository.inboxEnvelopes(t.next.id, ['queued'])).length).toBe(1);
    // A late terminal callback can retain old launch data, but cannot restore leadership.
    await workspaceRepository.updateNode(t.lead.id, { payload: { ...t.lead.payload, maestro: true } });
    expect(((await workspaceRepository.getNode(t.lead.id))?.payload as TerminalNodePayload).maestro).toBe(false);
  });

  it('keeps the single-leader completion flow when no deputy is configured', async () => {
    const t = await team();
    const work = await task(t);
    expect((await taskBoardService.update(t.workspace.id, work.id, { status: 'done' })).status).toBe('done');
  });

  it('requires two fresh independent approvals after a finding and finalizes without another model call', async () => {
    const t = await team();
    await pair(t);
    await writeFile(join(t.dir, 'feature.ts'), 'export const feature = "broken";');
    const work = await task(t);
    const waiting = await taskBoardService.update(t.workspace.id, work.id, { status: 'done' });
    expect(waiting.status).toBe('doing');
    expect(waiting.completionReview?.status).toBe('collecting');
    const first = await leadershipReviewService.prepare(t.workspace.id, { command: 'review_prepare', taskId: work.id, artifacts: [{ kind: 'file', path: 'feature.ts' }] }, { kind: 'agent', nodeId: t.worker.id });
    await vote(t.workspace.id, first, t.lead.id);
    await vote(t.workspace.id, first, t.next.id, 'changes_requested');
    await expect(vote(t.workspace.id, first, t.lead.id)).rejects.toMatchObject({ code: 'leadership_review_reprepare' });
    await writeFile(join(t.dir, 'feature.ts'), 'export const feature = "fixed";');
    const retried = await taskBoardService.update(t.workspace.id, work.id, { status: 'done' });
    expect(retried.status).toBe('doing');
    const second = (await workspaceLeadershipRepository.reviewForTask(t.workspace.id, work.id))!;
    expect(second.id).not.toBe(first.id);
    expect(second.leaderVote).toBeNull();
    await vote(t.workspace.id, second, t.next.id);
    expect((await taskBoardService.list(t.workspace.id)).find((item) => item.id === work.id)?.status).toBe('doing');
    await vote(t.workspace.id, second, t.lead.id);
    expect((await taskBoardService.list(t.workspace.id)).find((item) => item.id === work.id)?.status).toBe('done');
    expect(await workspaceLeadershipRepository.pendingCompletions()).toEqual([]);
  });

  it('does not let another agent vote or let new cards bypass the configured review', async () => {
    const t = await team();
    await pair(t);
    await writeFile(join(t.dir, 'feature.ts'), 'export const feature = true;');
    const work = await taskBoardService.create(t.workspace.id, { title: 'Attempt direct done', status: 'done', createdBy: 'test' });
    expect(work.status).toBe('doing');
    const review = await leadershipReviewService.prepare(t.workspace.id, { command: 'review_prepare', taskId: work.id, artifacts: [{ kind: 'file', path: 'feature.ts' }] }, owner);
    await expect(vote(t.workspace.id, review, t.worker.id)).rejects.toMatchObject({ code: 'leadership_reviewer_required' });
    await vote(t.workspace.id, review, t.lead.id);
    await writeFile(join(t.dir, 'feature.ts'), 'export const feature = false;');
    await expect(vote(t.workspace.id, review, t.next.id)).rejects.toMatchObject({ code: 'leadership_review_stale' });
    expect((await taskBoardService.list(t.workspace.id)).find((item) => item.id === work.id)?.status).toBe('doing');
  });

  it('rejects cross-workspace roles and rolls back a role change when its durable notification fails', async () => {
    const t = await team();
    const other = await team();
    const before = await workspaceLeadershipService.configuration(t.workspace.id);
    await expect(workspaceLeadershipService.configure(t.workspace.id, { command: 'configure', requestId: uuidv7(), expectedRevision: before.revision,
      leaderNodeId: other.lead.id, deputyNodeId: null }, owner)).rejects.toMatchObject({ code: 'leadership_invalid_agent' });
    vi.mocked(agentInboxService.enqueueDeferred).mockRejectedValueOnce(new Error('database is locked'));
    await expect(workspaceLeadershipService.configure(t.workspace.id, { command: 'configure', requestId: uuidv7(), expectedRevision: before.revision,
      leaderNodeId: t.next.id, deputyNodeId: t.lead.id }, owner)).rejects.toThrow('database is locked');
    expect((await workspaceLeadershipService.configuration(t.workspace.id)).leaderNodeId).toBe(t.lead.id);
    expect(await workspaceLeadershipRepository.handoffs(t.workspace.id)).toEqual([]);
  });
  it('creates one primary and optional deputy from the same node creation flow and ignores stale role flags', async () => {
    const t = await team();
    vi.spyOn(providerProfileService, 'resolveCreationProfile').mockResolvedValue(null);
    const created = await workspaceService.createNode(new CreateCanvasNodeDto(t.workspace.id, 'terminal', 'New primary', 0, 0, 560, 340, 0,
      { provider: 'codex', command: 'codex', maestro: true, previousLeaderAsDeputy: true } as never));
    expect((await workspaceLeadershipService.configuration(t.workspace.id))).toMatchObject({ leaderNodeId: created.id, deputyNodeId: t.lead.id });
    expect((await workspaceRepository.listNodes(t.workspace.id)).filter((node) => (node.payload as TerminalNodePayload).maestro)).toHaveLength(1);
    expect(created.payload).not.toHaveProperty('previousLeaderAsDeputy');
  });

  it('serializes simultaneous independent decisions and recovers completion after a failed write', async () => {
    const t = await team(); await pair(t);
    await writeFile(join(t.dir, 'feature.ts'), 'export const feature = true;');
    const work = await task(t);
    const review = await leadershipReviewService.prepare(t.workspace.id, { command: 'review_prepare', taskId: work.id, artifacts: [{ kind: 'file', path: 'feature.ts' }] }, owner);
    const update = vi.spyOn(taskBoardService, 'update').mockRejectedValueOnce(new Error('database is locked'));
    const results = await Promise.allSettled([vote(t.workspace.id, review, t.lead.id), vote(t.workspace.id, review, t.next.id)]);
    expect(results.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
    expect((await workspaceLeadershipRepository.pendingCompletions()).map((item) => item.taskId)).toContain(work.id);
    update.mockRestore();
    await leadershipReviewService.finalizePending();
    expect((await taskBoardService.list(t.workspace.id)).find((item) => item.id === work.id)?.status).toBe('done');
    expect(await workspaceLeadershipRepository.pendingCompletions()).toEqual([]);
  });

  it('keeps independent cards executable when another card has findings and resets approvals on criteria change', async () => {
    const t = await team(); await pair(t);
    await writeFile(join(t.dir, 'feature.ts'), 'export const feature = true;');
    const first = await task(t); const independent = await task(t);
    const review = await leadershipReviewService.prepare(t.workspace.id, { command: 'review_prepare', taskId: first.id, artifacts: [{ kind: 'file', path: 'feature.ts' }] }, owner);
    await vote(t.workspace.id, review, t.lead.id);
    await vote(t.workspace.id, review, t.next.id, 'changes_requested');
    expect(await taskBoardService.isInboxTaskActive(t.workspace.id, independent.id, t.worker.id)).toBe(true);
    await taskBoardService.update(t.workspace.id, first.id, { description: 'New acceptance criteria' });
    expect((await workspaceLeadershipRepository.reviewForTask(t.workspace.id, first.id))?.status).toBe('stale');
    await expect(vote(t.workspace.id, review, t.next.id)).rejects.toMatchObject({ code: 'leadership_review_stale' });
    const next = await taskBoardService.update(t.workspace.id, first.id, { status: 'done' });
    expect(next.completionReview).toMatchObject({ leaderDecision: null, deputyDecision: null });
    expect(next.completionReview).not.toHaveProperty('artifacts');
    expect(next.completionReview).not.toHaveProperty('leaderVote');
  });

  it('restarts the pending review for the new pair and does no work for a completed or blocked-only board', async () => {
    const t = await team(); await pair(t);
    await writeFile(join(t.dir, 'feature.ts'), 'export const feature = true;');
    const work = await task(t);
    const first = await leadershipReviewService.prepare(t.workspace.id, { command: 'review_prepare', taskId: work.id, artifacts: [{ kind: 'file', path: 'feature.ts' }] }, owner);
    await vote(t.workspace.id, first, t.lead.id);
    const config = await workspaceLeadershipService.configuration(t.workspace.id);
    await workspaceLeadershipService.configure(t.workspace.id, { command: 'configure', requestId: uuidv7(), expectedRevision: config.revision, leaderNodeId: t.next.id, deputyNodeId: t.lead.id }, owner);
    await leadershipReviewService.maintain(t.workspace.id);
    const second = (await workspaceLeadershipRepository.reviewForTask(t.workspace.id, work.id))!;
    expect(second.id).not.toBe(first.id);
    expect(second.leaderVote).toBeNull(); expect(second.deputyVote).toBeNull();
    await vote(t.workspace.id, second, t.next.id); await vote(t.workspace.id, second, t.lead.id);
    const count = (await controlCenterRepository.inboxEnvelopes(t.next.id, ['queued'])).length;
    await leadershipReviewService.maintain(t.workspace.id);
    expect((await controlCenterRepository.inboxEnvelopes(t.next.id, ['queued'])).length).toBe(count);
    const { boardColumnService } = await import('$lib/modules/agent-room/application/services/BoardColumnService.js');
    await boardColumnService.create(t.workspace.id, { name: 'Blocked' });
    await taskBoardService.update(t.workspace.id, work.id, { status: 'blocked' });
    const afterBlock = (await controlCenterRepository.inboxEnvelopes(t.next.id, ['queued'])).length;
    await leadershipReviewService.maintain(t.workspace.id);
    expect((await controlCenterRepository.inboxEnvelopes(t.next.id, ['queued'])).length).toBe(afterBlock);
  });

  it('binds bridge votes to the live terminal, rejects a claimed colleague, and rejects owner UI votes', async () => {
    const t = await team(); await pair(t);
    await writeFile(join(t.dir, 'feature.ts'), 'export const feature = true;');
    const work = await task(t);
    const review = await leadershipReviewService.prepare(t.workspace.id, { command: 'review_prepare', taskId: work.id, artifacts: [{ kind: 'file', path: 'feature.ts' }] }, owner);
    const controller = new WorkspaceLeadershipController();
    const resolve = vi.spyOn(ptySessionManager, 'resolveBridgeAgent').mockImplementation((workspace, token) => workspace === t.workspace.id && token === 'actual-terminal' ? t.lead.id : null);
    const { bridgeService } = await import('$lib/modules/agent-room/application/services/BridgeService.js');
    const token = await bridgeService.getOrCreateToken(t.workspace.id);
    const input = { command: 'review_decide', reviewId: review.id, expectedRevision: review.revision, decision: 'approve', evidence: ['Independent test'], findings: [] };
    const event = (from: string, identity: string) => ({ params: {}, url: new URL('http://localhost/api'), locals: {}, request: new Request('http://localhost/api', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'x-orkestrai-agent-token': identity, 'content-type': 'application/json' }, body: JSON.stringify({ from, input }) }) });
    expect((await controller.bridgeCommand(event(t.lead.id, '') as never)).status).toBe(403);
    expect((await controller.bridgeCommand(event(t.next.id, 'actual-terminal') as never)).status).toBe(403);
    expect((await controller.bridgeCommand(event(t.lead.id, 'actual-terminal') as never)).status).toBe(200);
    expect(resolve).toHaveBeenCalledWith(t.workspace.id, 'actual-terminal');
    await expect(leadershipReviewService.decide(t.workspace.id, input as never, owner)).rejects.toMatchObject({ code: 'leadership_terminal_required' });
  });

  it('retains a still-current demotion after two rapid leadership transfers', async () => {
    const t = await team();
    let config = await workspaceLeadershipService.configuration(t.workspace.id);
    await workspaceLeadershipService.configure(t.workspace.id, { command: 'configure', requestId: uuidv7(), expectedRevision: config.revision, leaderNodeId: t.next.id, deputyNodeId: null }, owner);
    const [demotion] = await controlCenterRepository.inboxEnvelopes(t.lead.id, ['queued']);
    config = await workspaceLeadershipService.configuration(t.workspace.id);
    await workspaceLeadershipService.configure(t.workspace.id, { command: 'configure', requestId: uuidv7(), expectedRevision: config.revision, leaderNodeId: t.worker.id, deputyNodeId: null }, owner);
    expect(await workspaceLeadershipService.envelopeRelevant(demotion)).toBe(true);
  });

  it('never lets a coordinator remove the independent reviewer and honors a workspace pause', async () => {
    const t = await team(); await pair(t);
    const work = await taskBoardService.create(t.workspace.id, { title: 'Coordinate', assigneeNodeId: t.lead.id, dispatch: false });
    const config = await workspaceLeadershipService.configuration(t.workspace.id);
    const command = { command: 'configure' as const, requestId: uuidv7(), expectedRevision: config.revision, leaderNodeId: t.lead.id, deputyNodeId: null, taskId: work.id };
    await expect(workspaceLeadershipService.configure(t.workspace.id, command, { kind: 'agent', nodeId: t.lead.id })).rejects.toMatchObject({ code: 'leadership_preserve_deputy' });
    await workspaceRepository.setWorkspaceSuspended(t.workspace.id, true);
    await expect(workspaceLeadershipService.configure(t.workspace.id, { ...command, deputyNodeId: t.next.id }, { kind: 'agent', nodeId: t.lead.id })).rejects.toMatchObject({ code: 'leadership_paused' });
  });

  it('does not permit dismissing the configured reviewer through the recruitment API', async () => {
    const t = await team(); await pair(t);
    const { bridgeService } = await import('$lib/modules/agent-room/application/services/BridgeService.js');
    await expect(bridgeService.dismiss(t.workspace.id, { from: t.lead.id, target: t.next.id })).rejects.toThrow('leadership_preserve_deputy');
    expect(await workspaceRepository.getNode(t.next.id)).not.toBeNull();
  });

  it('makes full current owner instructions available in bounded pages', async () => {
    const t = await team();
    await workspaceRepository.updateWorkspace(t.workspace.id, { instructions: 'a'.repeat(8_000) + 'Explicit owner restriction at the end' });
    const config = await workspaceLeadershipService.configuration(t.workspace.id);
    const changed = await workspaceLeadershipService.configure(t.workspace.id, { command: 'configure', requestId: uuidv7(), expectedRevision: config.revision, leaderNodeId: t.next.id, deputyNodeId: null }, owner);
    const overview = await workspaceLeadershipService.execute(new WorkspaceLeadershipDto(t.workspace.id, { command: 'handoff_read', handoffId: changed.handoff!.id, section: 'overview', offset: 0 }), owner);
    expect(overview).toMatchObject({ instructionsTruncated: true });
    const page = await workspaceLeadershipService.execute(new WorkspaceLeadershipDto(t.workspace.id, { command: 'handoff_read', handoffId: changed.handoff!.id, section: 'instructions', offset: 1 }), owner);
    expect(page).toMatchObject({ content: 'Explicit owner restriction at the end', nextOffset: null });
  });

});
