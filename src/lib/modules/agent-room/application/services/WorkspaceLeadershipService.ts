import { createHash } from 'node:crypto';
import { Connection } from '@beeblock/svelar/database';
import { uuidv7 } from '@beeblock/svelar/support';
import { workspaceRepository } from '../../infrastructure/repositories/WorkspaceRepository.js';
import { workspaceLeadershipRepository, mapLeadership, mapLeadershipHandoff } from '../../infrastructure/repositories/WorkspaceLeadershipRepository.js';
import { channelRepository } from '../../infrastructure/repositories/ChannelRepository.js';
import { controlCenterRepository } from '../../infrastructure/repositories/ControlCenterRepository.js';
import { AgentLeadershipReview } from '../../domain/models/AgentLeadershipReview.js';
import { AgentBoardTask } from '../../domain/models/AgentBoardTask.js';
import { AgentMemoryEntry } from '../../domain/models/AgentMemoryEntry.js';
import { AgentLearningEntry } from '../../domain/models/AgentLearningEntry.js';
import { agentInboxService } from './AgentInboxService.js';
import { conversationHandoffTurn } from '../../infrastructure/transcript/AgentTranscript.js';
import { hasAgentAdapter } from '../adapters/registry.js';
import type { AgentMessageEnvelope, CanvasNode, TerminalNodePayload } from '../../domain/types.js';
import { LeadershipError, type LeadershipActor, type LeadershipCommand, type LeadershipConfiguration, type LeadershipSnapshot } from '../../contracts/schemas/leadership.schema.js';
import type { WorkspaceLeadershipDto } from '../dto/WorkspaceLeadershipDto.js';

type ConfigurationInput = Extract<LeadershipCommand, { command: 'configure' }>;
type HandoffContext = {
  capturedAt: string; instructions: string; instructionsTruncated: boolean; ownerNote: string;
  previousLeader: { id: string; title: string; provider: string } | null;
  sourceChannel: string | null;
  messages: Array<{ id: string; author: string; body: string; createdAt: string; truncated: boolean }>;
  tasks: Array<{ id: string; title: string; description: string; status: string; assigneeNodeId: string | null }>;
  notes: Array<{ id: string; title: string; content: string; truncated: boolean }>;
  learning: Array<{ id: string; title: string; content: string }>;
  pendingRequests: Array<{ id: string; content: string }>;
  transcriptTurn: Awaited<ReturnType<typeof conversationHandoffTurn>>;
  sources: { taskList: string; memory: string; previousNodeId: string | null; historicalContextPreserved: true; previousHandoffIds: string[] };
};
function text(value: unknown, limit: number): string { return String(value ?? '').slice(0, limit); }
export function leadershipChanged(workspaceId: string): void {
  (globalThis as { __orkestraiBroadcast?: (frame: Record<string, unknown>) => void }).__orkestraiBroadcast?.({ type: 'workspaceChanged', workspaceId });
}
function isAgent(node: CanvasNode): boolean {
  const provider = (node.payload as TerminalNodePayload).provider;
  return node.type === 'terminal' && Boolean(provider && hasAgentAdapter(provider));
}

export class WorkspaceLeadershipService {
  async envelopeRelevant(envelope: AgentMessageEnvelope): Promise<boolean> {
    const current = await this.configuration(envelope.workspaceId);
    // A superseded grant is discarded, but a still-current demotion must reach
    // a busy former leader even if another transfer happened in the meantime.
    if (envelope.metadata.leadershipRole === 'specialist') return ![current.leaderNodeId, current.deputyNodeId].includes(envelope.toNodeId);
    return current.revision === envelope.metadata.leadershipRevision;
  }
  async configuration(workspaceId: string): Promise<LeadershipConfiguration> {
    const stored = await workspaceLeadershipRepository.configuration(workspaceId);
    if (stored) return mapLeadership(stored);
    const nodes = await workspaceRepository.listNodes(workspaceId, undefined, false, true);
    const leader = nodes.find((node) => isAgent(node) && (node.payload as TerminalNodePayload).maestro)?.id ?? null;
    const deputy = nodes.find((node) => isAgent(node) && node.id !== leader && (node.payload as TerminalNodePayload).deputy)?.id ?? null;
    const revision = 'legacy:' + createHash('sha256').update(JSON.stringify([workspaceId, leader, deputy])).digest('hex');
    return { workspaceId, leaderNodeId: leader, deputyNodeId: deputy, revision };
  }

  async snapshot(workspaceId: string): Promise<LeadershipSnapshot> {
    if (!await workspaceRepository.getWorkspace(workspaceId)) throw new LeadershipError('leadership_workspace', 404);
    const [configuration, nodes, handoffs, reviews] = await Promise.all([
      this.configuration(workspaceId), workspaceRepository.listNodes(workspaceId, undefined, false, true),
      workspaceLeadershipRepository.handoffs(workspaceId), workspaceLeadershipRepository.reviewSummaries(workspaceId),
    ]);
    return { configuration, handoffs, reviews, agents: nodes.filter(isAgent).slice(0, 1_000).map((node) => ({
      id: node.id, title: text(node.title, 160), provider: text((node.payload as TerminalNodePayload).provider, 64),
      role: node.id === configuration.leaderNodeId ? 'leader' : node.id === configuration.deputyNodeId ? 'deputy' : 'specialist',
    })) };
  }

  private async authorizeConfiguration(workspaceId: string, input: ConfigurationInput, before: LeadershipConfiguration, actor: LeadershipActor): Promise<void> {
    if (actor.kind === 'owner') return;
    if ((await workspaceRepository.getWorkspace(workspaceId))?.suspendedAt) throw new LeadershipError('leadership_paused', 403);
    if (![before.leaderNodeId, before.deputyNodeId].includes(actor.nodeId)) throw new LeadershipError('leadership_coordinator_required', 403);
    const task = input.taskId ? await AgentBoardTask.query().where('workspace_id', workspaceId).where('id', input.taskId)
      .where('assignee_node_id', actor.nodeId).whereNull('archived_at').first() : null;
    if (!task || task.getAttribute('status') === 'done') throw new LeadershipError('leadership_task_required', 403);
    // An agent cannot remove a configured independent reviewer to approve its own delivery.
    if (before.deputyNodeId && input.deputyNodeId !== before.deputyNodeId) {
      const swappingPair = input.leaderNodeId === before.deputyNodeId && input.deputyNodeId === before.leaderNodeId;
      if (!swappingPair) throw new LeadershipError('leadership_preserve_deputy', 403);
    }
  }

  private async captureContext(workspaceId: string, fromNodeId: string | null, ownerNote = ''): Promise<HandoffContext> {
    const workspace = await workspaceRepository.getWorkspace(workspaceId);
    if (!workspace) throw new LeadershipError('leadership_workspace', 404);
    const nodes = await workspaceRepository.listNodes(workspaceId, undefined, false, true);
    const previous = nodes.find((node) => node.id === fromNodeId);
    const sourceChannel = fromNodeId ? `dm:${fromNodeId}` : null;
    const [messages, tasks, memories, lessons, pending] = await Promise.all([
      sourceChannel ? channelRepository.list(workspaceId, sourceChannel, { limit: 30 }) : Promise.resolve([]),
      AgentBoardTask.query().where('workspace_id', workspaceId).where('status', '!=', 'done').whereNull('archived_at').orderBy('updated_at', 'desc').limit(100).get(),
      AgentMemoryEntry.query().where('workspace_id', workspaceId).where('status', 'active').orderBy('updated_at', 'desc').limit(12).get(),
      fromNodeId ? AgentLearningEntry.query().where('workspace_id', workspaceId).where('node_id', fromNodeId).whereIn('status', ['active', 'approved']).orderBy('updated_at', 'desc').limit(12).get() : Promise.resolve([]),
      fromNodeId ? controlCenterRepository.inboxEnvelopes(fromNodeId, ['queued'], 20) : Promise.resolve([]),
    ]);
    let transcriptTurn: HandoffContext['transcriptTurn'] = null;
    if (fromNodeId) {
      try {
        const source = await agentInboxService.transcriptFor(workspaceId, fromNodeId);
        // Only public text crosses the provider boundary. Never serialize storage roots or resolved env.
        if (source.provider) transcriptTurn = await conversationHandoffTurn(source.provider, source.cwd, source.agentSessionId, source.options);
      } catch { /* Unavailable provider storage does not discard the saved workspace context. */ }
    }
    const noteNodes = nodes.filter((node) => node.type === 'note').slice(0, 12);
    return {
      capturedAt: new Date().toISOString(), instructions: text(workspace.instructions, 8_000), instructionsTruncated: String(workspace.instructions ?? '').length > 8_000, ownerNote: text(ownerNote, 8_000),
      previousLeader: previous ? { id: previous.id, title: text(previous.title, 160), provider: text((previous.payload as TerminalNodePayload).provider, 64) } : null,
      sourceChannel,
      messages: messages.reverse().map((message) => ({ id: message.id, author: message.authorKind, body: text(message.body, 4_000), createdAt: message.createdAt, truncated: message.body.length > 4_000 })),
      tasks: tasks.map((task) => ({ id: task.getAttribute('id'), title: text(task.getAttribute('title'), 300), description: text(task.getAttribute('description'), 2_000), status: task.getAttribute('status'), assigneeNodeId: task.getAttribute('assignee_node_id') ?? null })),
      notes: noteNodes.map((node) => { const content = String((node.payload as { content?: string }).content ?? '');
        return { id: node.id, title: text(node.title, 300), content: text(content, 4_000), truncated: content.length > 4_000 }; }),
      learning: [...memories.map((item) => ({ id: item.getAttribute('id'), title: text(item.getAttribute('title'), 300), content: text(item.getAttribute('content'), 2_000) })),
        ...lessons.map((item) => ({ id: item.getAttribute('id'), title: 'Approved lesson', content: text(item.getAttribute('document_json'), 2_000) }))],
      pendingRequests: pending.filter((item) => item.kind === 'owner').map((item) => ({ id: item.id, content: text(item.content, 2_000) })),
      transcriptTurn,
      sources: { taskList: 'orkestrai task list', memory: 'orkestrai memory search', previousNodeId: fromNodeId, historicalContextPreserved: true, previousHandoffIds: (await workspaceLeadershipRepository.handoffs(workspaceId)).map((h) => h.id) },
    };
  }

  private async applyConfiguration(workspaceId: string, input: ConfigurationInput, actor: LeadershipActor, context: HandoffContext | null, releases: Array<() => void>) {
    const before = await this.configuration(workspaceId);
    if (before.revision !== input.expectedRevision) throw new LeadershipError('leadership_stale');
    await this.authorizeConfiguration(workspaceId, input, before, actor);
    if (input.leaderNodeId && input.leaderNodeId === input.deputyNodeId) throw new LeadershipError('leadership_distinct_reviewers', 400);
    if (input.deputyNodeId && !input.leaderNodeId) throw new LeadershipError('leadership_leader_required', 400);
    const nodes = await workspaceRepository.listNodes(workspaceId, undefined, false, true);
    for (const id of [input.leaderNodeId, input.deputyNodeId]) {
      if (id && !nodes.some((node) => node.id === id && isAgent(node))) throw new LeadershipError('leadership_invalid_agent', 400);
    }
    if (before.leaderNodeId === input.leaderNodeId && before.deputyNodeId === input.deputyNodeId) return { configuration: before, handoff: null };
    const configuration = { workspaceId, leaderNodeId: input.leaderNodeId, deputyNodeId: input.deputyNodeId, revision: uuidv7() };
    await workspaceLeadershipRepository.saveConfiguration({ ...configuration, requestId: input.requestId }, before.revision);
    const openCards = await AgentBoardTask.query().where('workspace_id', workspaceId).where('status', '!=', 'done').whereNull('archived_at').select('id').get();
    if (openCards.length) await AgentLeadershipReview.query().where('workspace_id', workspaceId).whereIn('task_id', openCards.map((card) => card.getAttribute('id')))
      .whereIn('status', ['pending', 'collecting', 'approved']).update({ status: 'stale', completion_pending: false });
    // Keep raw read models (including remote collaboration) aligned too. The
    // repository projection additionally protects against late PTY snapshots.
    for (const node of nodes.filter(isAgent)) {
      const payload = node.payload as TerminalNodePayload;
      const maestro = node.id === configuration.leaderNodeId;
      const deputy = node.id === configuration.deputyNodeId;
      if (Boolean(payload.maestro) !== maestro || Boolean(payload.deputy) !== deputy) {
        await workspaceRepository.updateNode(node.id, { payload: { ...payload, maestro, deputy } });
      }
    }
    const handoff = input.leaderNodeId && input.leaderNodeId !== before.leaderNodeId
      ? await workspaceLeadershipRepository.createHandoff({ workspaceId, fromNodeId: before.leaderNodeId, toNodeId: input.leaderNodeId,
          revision: configuration.revision, requestId: input.requestId, context }) : null;
    if (handoff && before.leaderNodeId) {
      await AgentBoardTask.query().where('workspace_id', workspaceId).where('assignee_node_id', before.leaderNodeId)
        .where('status', '!=', 'done').whereNull('archived_at').update({ assignee_node_id: input.leaderNodeId, updated_at: new Date().toISOString() });
    }
    const participants = new Set([before.leaderNodeId, before.deputyNodeId, input.leaderNodeId, input.deputyNodeId].filter((id): id is string => Boolean(id)));
    for (const nodeId of participants) {
      const role = nodeId === configuration.leaderNodeId ? 'leader' : nodeId === configuration.deputyNodeId ? 'deputy' : 'specialist';
      const oldRole = nodeId === before.leaderNodeId ? 'leader' : nodeId === before.deputyNodeId ? 'deputy' : 'specialist';
      if (role === oldRole && role === 'specialist') continue;
      const instructions = role === 'leader'
        ? `You are the primary leader. Read current workspace instructions and explicit owner restrictions before acting; bounded handoff excerpts do not replace them. Continue the approved work using the existing team and Kanban. ${configuration.deputyNodeId ? `Independent deputy: ${configuration.deputyNodeId}. Deliveries require both recorded approvals on the same reviewed revision, with no pending findings. task done starts that review; it is not completion while review is pending.` : 'No deputy is configured; use the normal delivery flow.'} ${handoff ? `Read the durable handoff ${handoff.id} with orkestrai leadership handoff read ${handoff.id}, then acknowledge it. Do not wait for the previous leader to reply. Read pending delivery reviews in leadership status and continue their review or findings.` : ''}`
        : role === 'deputy'
          ? 'The owner appointed you as optional deputy leader. Independently validate deliveries, report concrete findings, and approve only the exact reviewed revision with no pending findings. The primary leader coordinates; keep unrelated cards progressing.'
          : 'You are now a specialist. Leadership has transferred: stop coordinating or completing the previous leader cards, which now belong to the new primary. Continue your assigned specialist work and share useful context.';
      const addendum = nodeId === before.leaderNodeId && handoff
        ? ` Submit a concise handoff brief with orkestrai leadership handoff brief ${handoff.id}; your saved conversation remains intact.` : '';
      const deferred = await agentInboxService.enqueueDeferred({ workspaceId, toNodeId: nodeId, fromNodeId: null,
        kind: 'leadership_change', content: `[orkestrai:leadership] ${instructions}${addendum}`,
        dedupKey: `leadership:${configuration.revision}:${nodeId}`, metadata: { leadershipRevision: configuration.revision, leadershipRole: role, handoffId: handoff?.id ?? null } });
      releases.push(deferred.release);
    }
    return { configuration, handoff };
  }

  async configure(workspaceId: string, input: ConfigurationInput, actor: LeadershipActor) {
    if (!await workspaceRepository.getWorkspace(workspaceId)) throw new LeadershipError('leadership_workspace', 404);
    const stored = await workspaceLeadershipRepository.configuration(workspaceId);
    if (stored?.getAttribute('last_request_id') === input.requestId) {
      const current = mapLeadership(stored);
      if (current.leaderNodeId !== input.leaderNodeId || current.deputyNodeId !== input.deputyNodeId) throw new LeadershipError('leadership_request_conflict');
      await this.authorizeConfiguration(workspaceId, input, current, actor);
      const previous = await workspaceLeadershipRepository.handoffByRequest(workspaceId, input.requestId);
      return { configuration: current, handoff: previous ? mapLeadershipHandoff(previous) : null };
    }
    const duplicate = await workspaceLeadershipRepository.handoffByRequest(workspaceId, input.requestId);
    if (duplicate) {
      if (duplicate.getAttribute('to_node_id') !== input.leaderNodeId) throw new LeadershipError('leadership_request_conflict');
      const configuration = await this.configuration(workspaceId);
      await this.authorizeConfiguration(workspaceId, input, configuration, actor);
      return { configuration, handoff: mapLeadershipHandoff(duplicate) };
    }
    const before = await this.configuration(workspaceId);
    await this.authorizeConfiguration(workspaceId, input, before, actor);
    if (before.revision !== input.expectedRevision) throw new LeadershipError('leadership_stale');
    const context = input.leaderNodeId && input.leaderNodeId !== before.leaderNodeId
      ? await this.captureContext(workspaceId, before.leaderNodeId, input.note) : null;
    const releases: Array<() => void> = [];
    const result = await Connection.transaction(() => this.applyConfiguration(workspaceId, input, actor, context, releases));
    releases.forEach((release) => release());
    leadershipChanged(workspaceId);
    return result;
  }

  async createWithRole(workspaceId: string, create: () => Promise<CanvasNode>, role: 'leader' | 'deputy', previousAsDeputy = false): Promise<CanvasNode> {
    const before = await this.configuration(workspaceId);
    const context = role === 'leader' ? await this.captureContext(workspaceId, before.leaderNodeId) : null;
    const releases: Array<() => void> = [];
    const node = await Connection.transaction(async () => {
      const created = await create();
      await this.applyConfiguration(workspaceId, { command: 'configure', requestId: uuidv7(), expectedRevision: before.revision,
        leaderNodeId: role === 'leader' ? created.id : before.leaderNodeId,
        deputyNodeId: role === 'deputy' ? created.id : previousAsDeputy ? before.leaderNodeId : before.deputyNodeId }, { kind: 'owner' }, context, releases);
      return (await workspaceRepository.getNode(created.id))!;
    });
    releases.forEach((release) => release());
    leadershipChanged(workspaceId);
    return node;
  }

  async execute(dto: WorkspaceLeadershipDto, actor: LeadershipActor): Promise<unknown> {
    const { workspaceId, input } = dto;
    if (actor.kind === 'agent' && !['handoff_read', 'review_read'].includes(input.command)
      && (await workspaceRepository.getWorkspace(workspaceId))?.suspendedAt) throw new LeadershipError('leadership_paused', 403);
    if (input.command === 'configure') return this.configure(workspaceId, input, actor);
    if (input.command === 'review_read') {
      const review = await workspaceLeadershipRepository.review(workspaceId, input.reviewId);
      if (!review) throw new LeadershipError('leadership_review_missing', 404);
      return review;
    }
    if (input.command === 'review_prepare' || input.command === 'review_decide') {
      const { leadershipReviewService } = await import('./LeadershipReviewService.js');
      return leadershipReviewService.execute(workspaceId, input as Extract<LeadershipCommand, { command: 'review_prepare' | 'review_decide' }>, actor);
    }
    const handoff = await workspaceLeadershipRepository.handoff(workspaceId, input.handoffId);
    if (!handoff) throw new LeadershipError('leadership_handoff_missing', 404);
    const record = mapLeadershipHandoff(handoff);
    if (input.command === 'handoff_read') {
      const context = JSON.parse(String(handoff.getAttribute('context_json'))) as HandoffContext;
      if (input.section === 'instructions') {
        const instructions = String((await workspaceRepository.getWorkspace(workspaceId))?.instructions ?? '');
        const start = input.offset * 8_000;
        return { handoff: record, content: instructions.slice(start, start + 8_000), nextOffset: start + 8_000 < instructions.length ? input.offset + 1 : null, currentInstructions: true };
      }
      if (input.section === 'overview') return { handoff: record, capturedAt: context.capturedAt, ownerNote: context.ownerNote,
        instructions: context.instructions, instructionsTruncated: context.instructionsTruncated, previousLeader: context.previousLeader, transcriptTurn: context.transcriptTurn,
        pendingRequests: context.pendingRequests, tasks: context.tasks.map(({ description: _description, ...task }) => task),
        sources: context.sources, sections: ['instructions', 'messages', 'tasks', 'notes', 'learning'] };
      const entries = context[input.section];
      return { handoff: record, entries: entries.slice(input.offset, input.offset + 20), nextOffset: input.offset + 20 < entries.length ? input.offset + 20 : null, sources: context.sources };
    }
    if (actor.kind !== 'agent') throw new LeadershipError('leadership_terminal_required', 403);
    if (input.command === 'handoff_brief') {
      if (actor.nodeId !== record.fromNodeId) throw new LeadershipError('leadership_handoff_author', 403);
      const releases: Array<() => void> = [];
      await Connection.transaction(async () => {
        await workspaceLeadershipRepository.updateHandoff(workspaceId, record.id, { brief: input.brief });
        const pair = await this.configuration(workspaceId);
        for (const toNodeId of new Set([record.toNodeId, pair.leaderNodeId].filter((id): id is string => Boolean(id)))) {
          const notice = await agentInboxService.enqueueDeferred({ workspaceId, toNodeId, fromNodeId: actor.nodeId, kind: 'leadership_change',
            content: `[orkestrai:leadership] Previous leader added context to handoff ${record.id}: ${input.brief}`,
            dedupKey: `leadership:brief:${record.id}:${toNodeId}:${createHash('sha256').update(input.brief).digest('hex')}`,
            metadata: { leadershipRevision: pair.revision } });
          releases.push(notice.release);
        }
      });
      releases.forEach((release) => release());
    } else {
      if (actor.nodeId !== record.toNodeId) throw new LeadershipError('leadership_handoff_recipient', 403);
      await workspaceLeadershipRepository.updateHandoff(workspaceId, record.id, { status: 'acknowledged', acknowledged_at: new Date().toISOString() });
    }
    leadershipChanged(workspaceId);
    return mapLeadershipHandoff((await workspaceLeadershipRepository.handoff(workspaceId, record.id))!);
  }
}
export const workspaceLeadershipService = new WorkspaceLeadershipService();
