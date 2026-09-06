import { uuidv7 } from '@beeblock/svelar/support';
import type {
  AgentActivity,
  AgentActivityCategory,
  AgentActivitySeverity,
  AgentActivityState,
  AgentMessageDeliveryEvent,
  AgentMessageDeliveryState,
  AgentMessageThread,
  ControlCenterSnapshot,
} from '../../domain/types.js';
import { AgentBoardTask } from '../../domain/models/AgentBoardTask.js';
import { AgentFloor } from '../../domain/models/AgentFloor.js';
import { controlCenterRepository } from '../../infrastructure/repositories/ControlCenterRepository.js';
import { workspaceRepository } from '../../infrastructure/repositories/WorkspaceRepository.js';
import { ptySessionManager } from '../../infrastructure/pty/PtySessionManager.ts';
import { attentionService } from './AttentionService.js';

const ACTIVITY_STATES: AgentActivityState[] = [
  'starting',
  'working',
  'waiting_input',
  'waiting_permission',
  'blocked',
  'idle',
  'done',
  'error',
  'disconnected',
];

type RecordActivityInput = {
  workspaceId: string;
  nodeId: string;
  state: AgentActivityState;
  action?: string | null;
  taskId?: string | null;
  metadata?: Record<string, unknown>;
  category?: AgentActivityCategory;
  verb?: string;
  objectType?: string | null;
  objectId?: string | null;
  objectTitle?: string | null;
  outcome?: string | null;
  severity?: AgentActivitySeverity;
  correlationId?: string | null;
  sourceType?: string | null;
  sourceId?: string | null;
  attentionRequired?: boolean;
};

type RecordDeliveryInput = {
  messageId?: string;
  workspaceId: string;
  fromNodeId?: string | null;
  toNodeId: string;
  state: AgentMessageDeliveryState;
  content: string;
  reply?: string | null;
  error?: string | null;
  metadata?: Record<string, unknown>;
};

type BlockedTaskRecovery = {
  workspaceId: string;
  nodeId: string;
  taskId: string;
  sessionId: string | null;
  previousState: AgentActivityState;
  previousAction: string | null;
};

function broadcast(payload: Record<string, unknown>): void {
  const send = (globalThis as { __orkestraiBroadcast?: (frame: Record<string, unknown>) => void }).__orkestraiBroadcast;
  send?.(payload);
}

function emptyCounts(): Record<AgentActivityState, number> {
  return Object.fromEntries(ACTIVITY_STATES.map((state) => [state, 0])) as Record<AgentActivityState, number>;
}

function projectMessages(
  events: AgentMessageDeliveryEvent[],
  titles: Map<string, string>,
): AgentMessageThread[] {
  const threads = new Map<string, AgentMessageThread>();
  for (const event of events) {
    const existing = threads.get(event.messageId);
    if (!existing) {
      threads.set(event.messageId, {
        messageId: event.messageId,
        workspaceId: event.workspaceId,
        fromNodeId: event.fromNodeId,
        fromTitle: event.fromNodeId ? titles.get(event.fromNodeId) ?? null : null,
        toNodeId: event.toNodeId,
        toTitle: titles.get(event.toNodeId) ?? event.toNodeId.slice(0, 8),
        state: event.state,
        content: event.content,
        reply: event.reply,
        error: event.error,
        createdAt: event.createdAt,
        updatedAt: event.createdAt,
        events: [event],
      });
      continue;
    }
    existing.state = event.state;
    existing.reply = event.reply ?? existing.reply;
    existing.error = event.error ?? existing.error;
    existing.updatedAt = event.createdAt;
    existing.events.push(event);
  }
  return [...threads.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 100);
}

export class ControlCenterService {
  private latest = new Map<string, AgentActivity>();
  private writes = new Map<string, Promise<AgentActivity | null>>();

  /**
   * PTY lifecycle events do not know which Kanban card owns the terminal.
   * Enrich them here so a resumed session supersedes stale task-scoped
   * blocked/error events in Workbench and resolves obsolete attention items.
   */
  async recordLifecycleActivity(input: RecordActivityInput): Promise<AgentActivity | null> {
    if (input.taskId) return this.recordActivity(input);
    const candidates = await AgentBoardTask.query()
      .where('workspace_id', input.workspaceId)
      .where('assignee_node_id', input.nodeId)
      .orderBy('updated_at', 'desc')
      .get();
    const task = candidates.find((candidate) => {
      const status = String(candidate.getAttribute('status'));
      return !candidate.getAttribute('archived_at') && status !== 'todo' && status !== 'done';
    });
    if (!task) return this.recordActivity(input);
    const taskId = String(task.getAttribute('id'));
    const previous = await controlCenterRepository.latestSemanticTaskActivity(input.nodeId, taskId);
    const event = await this.recordActivity({
      ...input,
      taskId,
      metadata: {
        ...input.metadata,
        taskTitle: String(task.getAttribute('title')),
        lifecycle: true,
      },
    });
    if (
      event
      && input.state === 'starting'
      && previous?.taskId === taskId
      && ['blocked', 'waiting_permission', 'error'].includes(previous.state)
    ) {
      const sessionId = typeof input.metadata?.sessionId === 'string' ? input.metadata.sessionId : null;
      const lifecycle = globalThis as unknown as {
        __orkestraiRecoverBlockedTask?: (recovery: BlockedTaskRecovery) => void;
        __orkestraiPendingTaskRecoveries?: BlockedTaskRecovery[];
      };
      const recovery: BlockedTaskRecovery = {
        workspaceId: input.workspaceId,
        nodeId: input.nodeId,
        taskId,
        sessionId,
        previousState: previous.state,
        previousAction: previous.action,
      };
      if (lifecycle.__orkestraiRecoverBlockedTask) {
        lifecycle.__orkestraiRecoverBlockedTask(recovery);
      } else {
        const pending = lifecycle.__orkestraiPendingTaskRecoveries ?? [];
        if (!pending.some((item) => item.taskId === taskId && item.sessionId === sessionId)) pending.push(recovery);
        lifecycle.__orkestraiPendingTaskRecoveries = pending.slice(-100);
      }
    }
    return event;
  }

  async recordActivity(input: RecordActivityInput): Promise<AgentActivity | null> {
    const key = `${input.workspaceId}:${input.nodeId}`;
    const previousWrite = this.writes.get(key) ?? Promise.resolve(null);
    const write = previousWrite.then(async () => {
      const previous = this.latest.get(key) ?? await controlCenterRepository.latestActivity(input.nodeId);
      const action = input.action?.trim() || null;
      const taskId = input.taskId ?? null;
      if (
        previous?.state === input.state
        && previous.action === action
        && previous.taskId === taskId
        && previous.category === (input.category ?? previous.category)
        && previous.verb === (input.verb ?? previous.verb)
        && previous.outcome === (input.outcome ?? previous.outcome)
        && previous.severity === (input.severity ?? previous.severity)
        && previous.attentionRequired === (input.attentionRequired ?? previous.attentionRequired)
      ) return null;
      const node = await workspaceRepository.getNode(input.nodeId);
      if (!node || node.workspaceId !== input.workspaceId) return null;
      let event: AgentActivity;
      try {
        event = await controlCenterRepository.appendActivity({ ...input, action, taskId });
      } catch (error) {
        if ((error as { code?: string }).code === 'SQLITE_CONSTRAINT_FOREIGNKEY') return null;
        throw error;
      }
      this.latest.set(key, event);
      await attentionService.syncActivity(event);
      broadcast({ type: 'controlCenterChanged', workspaceId: input.workspaceId, nodeId: input.nodeId, event });
      return event;
    }).finally(() => {
      if (this.writes.get(key) === write) this.writes.delete(key);
    });
    this.writes.set(key, write);
    return write;
  }

  async recordDelivery(input: RecordDeliveryInput): Promise<AgentMessageDeliveryEvent> {
    const event = await controlCenterRepository.appendDelivery({
      ...input,
      messageId: input.messageId ?? uuidv7(),
    });
    broadcast({
      type: 'messageDelivery',
      workspaceId: input.workspaceId,
      messageId: event.messageId,
      state: event.state,
      event,
    });
    if (event.state === 'failed' && event.metadata.cancelled !== true) {
      await this.recordActivity({
        workspaceId: event.workspaceId,
        nodeId: event.toNodeId,
        state: 'error',
        action: 'system:message_failed',
        category: 'message',
        verb: 'failed',
        objectType: 'message',
        objectId: event.messageId,
        objectTitle: event.content.slice(0, 120),
        outcome: event.error,
        severity: 'error',
        correlationId: typeof event.metadata.correlationId === 'string' ? event.metadata.correlationId : `message:${event.messageId}`,
        sourceType: 'bridge',
        sourceId: event.messageId,
        attentionRequired: true,
        metadata: event.metadata,
      });
    }
    return event;
  }

  async settleWorkspace(workspaceId: string): Promise<void> {
    const prefix = `${workspaceId}:`;
    while (true) {
      const pending = [...this.writes.entries()]
        .filter(([key]) => key.startsWith(prefix))
        .map(([, write]) => write);
      if (pending.length === 0) break;
      await Promise.allSettled(pending);
    }
    for (const key of this.latest.keys()) {
      if (key.startsWith(prefix)) this.latest.delete(key);
    }
  }

  async snapshot(workspaceId: string, includeCommunications = true): Promise<ControlCenterSnapshot> {
    const [nodes, activeFloors, activityEvents, deliveryEvents, taskModels] = await Promise.all([
      workspaceRepository.listNodes(workspaceId),
      AgentFloor.query().where('workspace_id', workspaceId).where('status', 'active').get(),
      controlCenterRepository.listActivity(workspaceId),
      includeCommunications ? controlCenterRepository.listDeliveries(workspaceId) : Promise.resolve([]),
      AgentBoardTask.query().where('workspace_id', workspaceId).get(),
    ]);
    const terminalNodes = nodes.filter((node) => node.type === 'terminal');
    const floorNames = new Map(activeFloors.map((floor) => [
      String(floor.getAttribute('id')),
      String(floor.getAttribute('name')),
    ]));
    const titles = new Map(terminalNodes.map((node) => [node.id, node.title ?? 'Terminal']));
    const latestByNode = new Map<string, AgentActivity>();
    for (const event of activityEvents) latestByNode.set(event.nodeId, event);

    const tasks = taskModels
      .filter((task) => !task.getAttribute('archived_at') && task.getAttribute('status') !== 'done')
      .map((task) => ({
        id: String(task.getAttribute('id')),
        title: String(task.getAttribute('title')),
        status: String(task.getAttribute('status')),
        assigneeNodeId: task.getAttribute('assignee_node_id') as string | null,
        updatedAt: String(task.getAttribute('updated_at')),
      }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

    const counts = emptyCounts();
    const agents = terminalNodes.map((node) => {
      const payload = node.payload as {
        provider?: string;
        role?: string | null;
        sessionId?: string;
      };
      const session = payload.sessionId ? ptySessionManager.get(payload.sessionId) : null;
      const alive = Boolean(session && !session.exited);
      const latest = latestByNode.get(node.id);
      const state: AgentActivityState = alive
        ? latest?.state ?? (session?.waiting ? 'idle' : 'working')
        : 'disconnected';
      counts[state] += 1;
      const task = tasks.find((candidate) => candidate.assigneeNodeId === node.id) ?? null;
      return {
        nodeId: node.id,
        title: node.title ?? 'Terminal',
        provider: payload.provider ?? session?.provider ?? null,
        role: payload.role ?? null,
        floorId: node.floorId,
        floorName: node.floorId ? floorNames.get(node.floorId) ?? null : null,
        state,
        stateSince: latest?.createdAt ?? node.updatedAt,
        lastAction: latest?.action ?? null,
        lastActionData: latest?.metadata ?? {},
        currentTask: task ? { id: task.id, title: task.title, status: task.status } : null,
        sessionAlive: alive,
      };
    });

    return {
      workspaceId,
      counts,
      agents,
      activity: [...activityEvents].reverse().slice(0, 300),
      communications: projectMessages(deliveryEvents, titles),
      generatedAt: new Date().toISOString(),
    };
  }

  async summaries(): Promise<Record<string, ControlCenterSnapshot>> {
    const workspaces = await workspaceRepository.listWorkspaces();
    const entries = await Promise.all(workspaces.map(async (workspace) => [workspace.id, await this.snapshot(workspace.id, false)] as const));
    return Object.fromEntries(entries);
  }
}

export const controlCenterService = new ControlCenterService();

const lifecycle = globalThis as unknown as {
  __orkestraiRecordActivity?: (input: RecordActivityInput) => void;
};
lifecycle.__orkestraiRecordActivity = (input) => {
  void controlCenterService.recordLifecycleActivity(input).catch((error) => {
    console.error('[orkestrai:activity] Falha ao registrar estado do agente:', error);
  });
};
