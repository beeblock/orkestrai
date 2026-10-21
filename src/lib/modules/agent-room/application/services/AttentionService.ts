import type {
  AgentActivity,
  AgentAttentionItem,
  AgentAttentionStatus,
  AgentActivitySeverity,
} from '../../domain/types.js';
import { LEARNING_ATTENTION_SOURCE, type AgentLesson } from '../../domain/agent-learning.js';
import { agentLearningRepository } from '../../infrastructure/repositories/AgentLearningRepository.js';
import { attentionRepository } from '../../infrastructure/repositories/AttentionRepository.js';
import { agentRoomRepository } from '../../infrastructure/repositories/AgentRoomRepository.js';
import { controlCenterRepository } from '../../infrastructure/repositories/ControlCenterRepository.js';
import { workspaceRepository } from '../../infrastructure/repositories/WorkspaceRepository.js';

const ATTENTION_STATES = new Set(['waiting_input', 'waiting_permission', 'blocked', 'error']);
// Readable titles for state items reported without a description.
const STATE_TITLES: Record<string, string> = {
  waiting_input: 'Aguardando uma resposta no terminal',
  waiting_permission: 'Aguardando uma permissão no terminal',
  blocked: 'Bloqueado',
  error: 'Erro no terminal',
};

function severityFor(activity: AgentActivity): AgentActivitySeverity {
  if (activity.severity !== 'info') return activity.severity;
  if (activity.state === 'error') return 'error';
  if (activity.state === 'blocked' || activity.state === 'waiting_permission') return 'warning';
  return 'info';
}

// A teammate's terminal dialog asking for a key press is the only state no
// agent can answer for it; everything else a team with a leader handles itself.
const OWNER_ONLY_STATES = new Set(['waiting_permission']);
// Item sources about how a teammate is doing, as opposed to owner decisions.
const TEAM_SOURCES = ['agent_state', 'notification', 'bridge'];
const TEAMMATE_STATE_LABELS: Record<string, string> = {
  waiting_input: 'esperando uma resposta',
  blocked: 'bloqueado',
  error: 'com erro',
};

/** The leader of a team, when `nodeId` is another agent of that team. */
async function teamLeaderFor(workspaceId: string, nodeId: string | null | undefined): Promise<{ leader: { id: string; title: string }; agent: { id: string; title: string } } | null> {
  if (!nodeId) return null;
  const nodes = await workspaceRepository.listNodes(workspaceId);
  const isAgent = (node: (typeof nodes)[number]) => node.type === 'terminal' && Boolean((node.payload as { provider?: unknown }).provider);
  const leader = nodes.find((node) => isAgent(node) && (node.payload as { maestro?: boolean }).maestro);
  const agent = nodes.find((node) => node.id === nodeId);
  if (!leader || !agent || agent.id === leader.id || !isAgent(agent)) return null;
  return { leader: { id: leader.id, title: leader.title ?? 'líder' }, agent: { id: agent.id, title: agent.title ?? 'agente' } };
}

function broadcast(workspaceId: string, item?: AgentAttentionItem): void {
  const send = (globalThis as { __orkestraiBroadcast?: (frame: Record<string, unknown>) => void }).__orkestraiBroadcast;
  send?.({ type: 'attentionChanged', workspaceId, item });
}

function lessonBody(item: AgentAttentionItem, lessons: Map<string, AgentLesson>): string | null {
  const lesson = item.sourceType === LEARNING_ATTENTION_SOURCE && item.sourceId ? lessons.get(item.sourceId) : null;
  return lesson?.workspaceId === item.workspaceId && lesson.correction ? lesson.correction : null;
}

export class AttentionService {
  async syncActivity(activity: AgentActivity): Promise<void> {
    const requiresAttention = activity.attentionRequired || ATTENTION_STATES.has(activity.state);
    // A message sent or received by a blocked agent does not change why it
    // waits, and must not replace its state item with one nothing resolves.
    if (requiresAttention && !activity.attentionRequired && activity.action?.startsWith('system:message_')) return;
    if (!requiresAttention) {
      const resolved = await attentionRepository.resolveAgentState(activity.workspaceId, activity.nodeId);
      if (resolved) broadcast(activity.workspaceId);
      return;
    }
    if (!OWNER_ONLY_STATES.has(activity.state) && await this.handToLeader(activity)) return;
    const item = await attentionRepository.save({
      workspaceId: activity.workspaceId,
      activityEventId: activity.id,
      nodeId: activity.nodeId,
      taskId: activity.taskId,
      category: activity.category,
      severity: severityFor(activity),
      title: activity.objectTitle ?? activity.action ?? STATE_TITLES[activity.state] ?? activity.verb,
      body: activity.outcome,
      sourceType: activity.sourceType ?? 'agent_state',
      sourceId: activity.sourceId ?? activity.nodeId,
      correlationId: activity.correlationId ?? `agent:${activity.nodeId}:${activity.category}`,
      action: {
        target: activity.taskId ? 'task' : 'node',
        workspaceId: activity.workspaceId,
        nodeId: activity.nodeId,
        taskId: activity.taskId,
      },
    });
    broadcast(activity.workspaceId, item);
  }

  /**
   * In a team with a leader, a teammate that is blocked, waiting or failing is
   * the leader's to solve: the leader is told and woken, and the owner's Needs
   * you stays for what only the owner can decide.
   */
  private async handToLeader(activity: AgentActivity): Promise<boolean> {
    const team = await teamLeaderFor(activity.workspaceId, activity.nodeId);
    if (!team) return false;
    // Only the teammate's state warnings move to the leader. Its approvals, questions
    // and reviews still wait for the owner: the work stays blocked until they decide.
    const resolved = await attentionRepository.resolveNodeSources(activity.workspaceId, activity.nodeId, TEAM_SOURCES);
    if (resolved) broadcast(activity.workspaceId);
    const what = [activity.objectTitle ?? activity.action, activity.outcome].filter((part): part is string => Boolean(part?.trim())).join(' — ');
    const { agentInboxService } = await import('./AgentInboxService.js');
    await agentInboxService.enqueue({
      workspaceId: activity.workspaceId,
      toNodeId: team.leader.id,
      fromNodeId: team.agent.id,
      kind: 'owner_copy',
      content: `Para você resolver, líder: ${team.agent.title} está ${TEAMMATE_STATE_LABELS[activity.state] ?? activity.state}${what ? `: ${what.slice(0, 600)}` : ''}.`
        + ` Destrave sem o dono: responda com orkestrai ask "${team.agent.title}" "<orientação>", redistribua o card, ajuste a ordem ou reinicie o agente.`
        + ' Leve ao dono, com orkestrai ask-owner, somente gasto de dinheiro, credenciais, publicação externa ou exclusões irreversíveis.',
      dedupKey: `teammate-state:${activity.nodeId}:${activity.state}:${(what || '').slice(0, 120)}`,
      taskId: activity.taskId ?? null,
    }).catch(() => undefined);
    return true;
  }

  /** In a team with a leader, closes what earlier versions raised to the owner about teammates. */
  async handTeammateItemsToLeader(): Promise<number> {
    let resolved = 0;
    for (const { workspaceId, nodeId } of await attentionRepository.openNodeRefs()) {
      if (!(await teamLeaderFor(workspaceId, nodeId))) continue;
      const closed = await attentionRepository.resolveNodeSources(workspaceId, nodeId, TEAM_SOURCES);
      if (closed) broadcast(workspaceId);
      resolved += closed;
    }
    return resolved;
  }

  /** An attention item that does not change the related agent's activity state. */
  async raise(input: {
    workspaceId: string;
    nodeId: string | null;
    taskId?: string | null;
    category: AgentActivity['category'];
    severity: AgentActivitySeverity;
    title: string;
    body?: string | null;
    sourceType: string;
    sourceId: string;
    correlationId: string;
    /** Overrides the default open-the-node action, e.g. to open a conversation. */
    action?: Record<string, unknown>;
  }): Promise<void> {
    // A teammate's undelivered message or alert is the leader's to handle.
    if (TEAM_SOURCES.includes(input.sourceType) && await teamLeaderFor(input.workspaceId, input.nodeId)) return;
    const item = await attentionRepository.save({
      workspaceId: input.workspaceId,
      activityEventId: null,
      nodeId: input.nodeId,
      taskId: input.taskId ?? null,
      category: input.category,
      severity: input.severity,
      title: input.title,
      body: input.body ?? null,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      correlationId: input.correlationId,
      action: input.action ? { workspaceId: input.workspaceId, nodeId: input.nodeId, taskId: input.taskId ?? null, ...input.action } : input.nodeId ? {
        target: input.taskId ? 'task' : 'node',
        workspaceId: input.workspaceId,
        nodeId: input.nodeId,
        taskId: input.taskId ?? null,
      } : undefined,
    });
    broadcast(input.workspaceId, item);
  }

  /** Like `raise`, but leaves an item that is already open, read or snoozed untouched. */
  async raiseOnce(input: Parameters<AttentionService['raise']>[0]): Promise<void> {
    if (await attentionRepository.hasUnresolved(input.workspaceId, input.correlationId)) return;
    await this.raise(input);
  }

  /** Closes the open items raised for one source once it is decided elsewhere. */
  async resolveSource(workspaceId: string, sourceType: string, sourceId: string): Promise<number> {
    const resolved = await attentionRepository.resolveBySource(workspaceId, sourceType, sourceId);
    if (resolved) broadcast(workspaceId);
    return resolved;
  }

  /** Tells the screens that a workspace's items changed in a transaction that has now committed. */
  announce(workspaceId: string): void {
    broadcast(workspaceId);
  }

  /** Closes what a removed node left open: no one can act on it any more. */
  async resolveNode(workspaceId: string, nodeId: string): Promise<number> {
    const resolved = await attentionRepository.resolveNode(workspaceId, nodeId);
    if (resolved) broadcast(workspaceId);
    return resolved;
  }

  /** Closes, at startup, the items of nodes removed before removal closed them. */
  async resolveOrphaned(): Promise<number> {
    let resolved = 0;
    for (const { workspaceId, nodeId } of await attentionRepository.openNodeRefs()) {
      if (!(await workspaceRepository.getNode(nodeId))) resolved += await this.resolveNode(workspaceId, nodeId);
    }
    return resolved;
  }

  async list(input: { workspaceId?: string | null; includeResolved?: boolean; limit?: number } = {}): Promise<AgentAttentionItem[]> {
    const items = await attentionRepository.list(input);
    const workspaces = await workspaceRepository.listWorkspaces();
    const workspaceNames = new Map(workspaces.map((workspace) => [workspace.id, workspace.name]));
    const nodeIds = new Set(items.flatMap((item) => item.nodeId ? [item.nodeId] : []));
    const taskIds = new Set(items.flatMap((item) => item.taskId ? [item.taskId] : []));
    const messageIds = [...new Set(items.flatMap((item) => (
      item.sourceType === 'bridge' && item.sourceId ? [item.sourceId] : []
    )))];
    const nodes = new Map<string, string>();
    const availableTasks = new Set<string>();
    const sourceContent = new Map<string, string>();
    const envelopes = await controlCenterRepository.findEnvelopes(messageIds);
    const envelopesById = new Map(envelopes.map((envelope) => [envelope.id, envelope]));
    // A pending lesson is decided from its whole text, not the preview kept on the item.
    const lessonIds = [...new Set(items.flatMap((item) => (item.sourceType === LEARNING_ATTENTION_SOURCE && item.sourceId ? [item.sourceId] : [])))];
    const lessons = new Map((await agentLearningRepository.findMany(lessonIds)).map((lesson) => [lesson.id, lesson]));
    await Promise.all([
      ...[...nodeIds].map(async (nodeId) => {
        const node = await workspaceRepository.getNode(nodeId);
        if (node) nodes.set(nodeId, node.title ?? node.type);
      }),
      ...[...taskIds].map(async (taskId) => {
        if (await agentRoomRepository.getTask(taskId)) availableTasks.add(taskId);
      }),
      ...items.map(async (item) => {
        if (item.sourceType !== 'bridge' || !item.sourceId) return;
        const envelope = envelopesById.get(item.sourceId);
        if (envelope?.workspaceId === item.workspaceId && envelope.content) sourceContent.set(item.id, envelope.content);
      }),
    ]);
    return items.map((item) => ({
      ...item,
      body: lessonBody(item, lessons) ?? item.body,
      workspaceName: workspaceNames.get(item.workspaceId) ?? null,
      nodeTitle: item.nodeId ? nodes.get(item.nodeId) ?? null : null,
      sourceContent: sourceContent.get(item.id) ?? null,
      actionAvailable: Boolean(
        (item.taskId && availableTasks.has(item.taskId))
        || (item.nodeId && nodes.has(item.nodeId))
      ),
    }));
  }

  async setStatus(input: {
    id: string;
    workspaceId: string;
    status: AgentAttentionStatus;
    snoozedUntil?: string | null;
  }): Promise<AgentAttentionItem> {
    const item = await attentionRepository.updateStatus(input.id, input.workspaceId, input.status, input.snoozedUntil);
    if (!item) throw new Error('Attention item not found in this workspace.');
    broadcast(input.workspaceId, item);
    return item;
  }
}

export const attentionService = new AttentionService();
