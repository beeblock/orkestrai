import type { CanvasNode } from '$lib/modules/agent-room/domain/types.js';
import { boardColumnService } from '$lib/modules/agent-room/application/services/BoardColumnService.js';
import { controlCenterService } from '$lib/modules/agent-room/application/services/ControlCenterService.js';
import { floorService } from '$lib/modules/agent-room/application/services/FloorService.js';
import { reviewCenterService } from '$lib/modules/agent-room/application/services/ReviewCenterService.js';
import { taskBoardService } from '$lib/modules/agent-room/application/services/TaskBoardService.js';
import { workspaceService } from '$lib/modules/agent-room/application/services/WorkspaceService.js';
import { usageService } from '$lib/modules/agent-room/application/services/UsageService.js';
import { designDocumentService } from '$lib/modules/agent-room/application/services/DesignDocumentService.js';
import { designCollaborationService } from '$lib/modules/agent-room/application/services/DesignCollaborationService.js';
import { huddleService } from '$lib/modules/agent-room/application/services/HuddleService.js';
import type { CollaborationScope, SharedCanvasNodeDto, SharedWorkspaceDto } from '../../domain/types.js';
import { MAX_PLAINTEXT_BYTES } from '@orkestrai/collaboration-protocol';
import { collaborationRepository } from '../../infrastructure/repositories/CollaborationRepository.js';
import { assertSharedProjectionSafe, sanitizeSharedText } from '../projections/sanitize-shared-data.js';

const SHARED_NODE_TYPES = new Set(['terminal', 'tasks', 'group', 'shape', 'controlCenter', 'reviewCenter', 'automation', 'design']);
export const MAX_SHARED_SNAPSHOT_BYTES = MAX_PLAINTEXT_BYTES - 16 * 1024;

export function scopeSharedWorkspaceSnapshot(
  snapshot: SharedWorkspaceDto,
  scopes: readonly CollaborationScope[],
): SharedWorkspaceDto {
  const canViewDesign = scopes.includes('design.view');
  const canViewActivity = scopes.includes('activity.view');
  const nodes = canViewDesign ? snapshot.nodes : snapshot.nodes.filter((node) => node.type !== 'design');
  const nodeIds = new Set(nodes.map((node) => node.id));
  return {
    ...snapshot,
    nodes,
    edges: snapshot.edges.filter((edge) => nodeIds.has(edge.sourceNodeId) && nodeIds.has(edge.targetNodeId)),
    designs: canViewDesign ? snapshot.designs : [],
    huddles: scopes.includes('huddles.view') ? snapshot.huddles : [],
    agents: canViewActivity ? snapshot.agents : snapshot.agents.map((agent) => ({ ...agent, workSummary: null })),
    activity: canViewActivity ? snapshot.activity : [],
  };
}

function snapshotBytes(snapshot: SharedWorkspaceDto): number {
  return Buffer.byteLength(JSON.stringify(snapshot));
}

export function fitSharedWorkspaceSnapshot(snapshot: SharedWorkspaceDto): SharedWorkspaceDto {
  const fit = (taskLimit: number, descriptionLimit: number, nodeLimit: number, agentLimit: number): SharedWorkspaceDto => {
    const nodes = snapshot.nodes.slice(0, nodeLimit);
    const nodeIds = new Set(nodes.map((node) => node.id));
    return {
      ...snapshot,
      nodes,
      edges: snapshot.edges.filter((edge) => nodeIds.has(edge.sourceNodeId) && nodeIds.has(edge.targetNodeId)).slice(0, nodeLimit * 2),
      columns: snapshot.columns.slice(0, 30),
      tasks: snapshot.tasks.slice(0, taskLimit).map((task) => ({
        ...task,
        title: task.title.slice(0, 180),
        description: task.description?.slice(0, descriptionLimit) ?? null,
      })),
      agents: snapshot.agents.slice(0, agentLimit).map((agent) => ({
        ...agent,
        workSummary: agent.workSummary ? {
          ...agent.workSummary,
          recentActivity: agent.workSummary.recentActivity.slice(0, 6),
        } : null,
      })),
      conversations: snapshot.conversations.slice(0, 80).map((conversation) => ({
        ...conversation,
        message: conversation.message.slice(0, descriptionLimit),
        reply: conversation.reply?.slice(0, descriptionLimit) ?? null,
        error: conversation.error?.slice(0, 240) ?? null,
      })),
      huddles: snapshot.huddles.slice(0, 20).map((huddle) => ({
        ...huddle,
        title: huddle.title.slice(0, 160),
        agenda: huddle.agenda?.slice(0, descriptionLimit) ?? null,
        participants: huddle.participants.slice(0, 12),
        turns: huddle.turns.slice(-Math.max(20, Math.min(120, nodeLimit))).map((turn) => ({ ...turn, text: turn.text.slice(0, descriptionLimit) })),
      })),
      floors: snapshot.floors.slice(0, 50),
      roles: snapshot.roles.slice(0, 100),
      reviews: snapshot.reviews.slice(0, 100).map((review) => ({ ...review, summary: review.summary?.slice(0, descriptionLimit) ?? null })),
      designs: (snapshot.designs ?? []).slice(0, 50).map((design) => ({
        ...design,
        pages: design.pages.slice(0, 100),
        elements: design.elements.slice(0, Math.max(20, nodeLimit)),
        presences: design.presences.slice(0, 20),
        comments: design.comments.slice(0, 80).map((comment) => ({ ...comment, body: comment.body.slice(0, descriptionLimit) })),
        proposals: design.proposals.slice(0, 80).map((proposal) => ({ ...proposal, description: proposal.description.slice(0, descriptionLimit) })),
      })),
      usage: snapshot.usage.slice(0, 8),
      activity: snapshot.activity.slice(0, 40),
    };
  };
  for (const limits of [[150, 1_200, 300, 150], [100, 600, 220, 120], [60, 300, 150, 80], [30, 160, 100, 50]] as const) {
    const candidate = fit(limits[0], limits[1], limits[2], limits[3]);
    if (snapshotBytes(candidate) <= MAX_SHARED_SNAPSHOT_BYTES) return candidate;
  }
  throw new Error('COLLABORATION_SNAPSHOT_TOO_LARGE');
}

function sharedNodeType(type: CanvasNode['type']): SharedCanvasNodeDto['type'] | null {
  return ({
    terminal: 'agent', tasks: 'tasks', group: 'group', shape: 'shape',
    controlCenter: 'control', reviewCenter: 'review', automation: 'automation',
    design: 'design',
  } as Partial<Record<CanvasNode['type'], SharedCanvasNodeDto['type']>>)[type] ?? null;
}

function finite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function projectNode(node: CanvasNode): SharedCanvasNodeDto | null {
  if (!SHARED_NODE_TYPES.has(node.type)) return null;
  const type = sharedNodeType(node.type);
  if (!type) return null;
  const payload = node.payload as Record<string, unknown>;
  const visual: Record<string, string | number | boolean | null> = {};
  if (node.type === 'terminal') {
    visual.provider = typeof payload.provider === 'string' ? sanitizeSharedText(payload.provider) : null;
    visual.role = typeof payload.role === 'string' ? sanitizeSharedText(payload.role) : null;
    visual.maestro = payload.maestro === true;
  } else if (node.type === 'shape') {
    for (const key of ['shape', 'fill', 'stroke', 'strokeWidth', 'opacity']) {
      const value = payload[key];
      if (typeof value === 'string') visual[key] = sanitizeSharedText(value).slice(0, 100);
      else if (typeof value === 'number' || typeof value === 'boolean') visual[key] = value;
    }
  }
  return {
    id: node.id,
    type,
    title: node.title ? sanitizeSharedText(node.title).slice(0, 160) : null,
    x: finite(node.x, 0), y: finite(node.y, 0),
    width: Math.max(80, Math.min(2_000, finite(node.width, 320))),
    height: Math.max(60, Math.min(2_000, finite(node.height, 220))),
    zIndex: Math.max(-1_000, Math.min(1_000, finite(node.zIndex, 0))),
    floorId: node.floorId,
    visual,
  };
}

export class SharedWorkspaceQuery {
  async snapshot(shareId: string): Promise<SharedWorkspaceDto> {
    const share = await collaborationRepository.findShare(shareId);
    if (!share || share.status !== 'active' || new Date(share.expiresAt).getTime() <= Date.now()) {
      throw new Error('COLLABORATION_SHARE_UNAVAILABLE');
    }
    const workspace = await workspaceService.get(share.workspaceId);
    const [rawNodes, rawEdges, columns, tasks, control, floors, reviews, huddleSnapshot] = await Promise.all([
      workspaceService.listNodes(share.workspaceId),
      workspaceService.listEdges(share.workspaceId),
      boardColumnService.list(share.workspaceId),
      taskBoardService.list(share.workspaceId),
      controlCenterService.snapshot(share.workspaceId, true),
      floorService.list(share.workspaceId),
      reviewCenterService.snapshot(share.workspaceId).catch(() => ({ reviews: [] } as unknown as Awaited<ReturnType<typeof reviewCenterService.snapshot>>)),
      huddleService.snapshot(share.workspaceId).catch(() => ({ huddles: [], selected: null, activeHuddleId: null })),
    ]);
    const nodes = rawNodes.map(projectNode).filter((node): node is SharedCanvasNodeDto => Boolean(node));
    const designDocuments = await Promise.all(rawNodes.filter((node) => node.type === 'design').map(async (node) => {
      const document = await designDocumentService.get(share.workspaceId, node.id);
      const live = designCollaborationService.snapshot(share.workspaceId, node.id, null, document);
      return { node, document, live };
    }));
    const sharedNodeIds = new Set(nodes.map((node) => node.id));
    const roleCounts = new Map<string, number>();
    for (const agent of control.agents) {
      if (agent.role) roleCounts.set(agent.role, (roleCounts.get(agent.role) ?? 0) + 1);
    }
    const projectedTasks = tasks.map((task) => ({
      id: task.id,
      title: sanitizeSharedText(task.title),
      description: task.description ? sanitizeSharedText(task.description) : null,
      status: sanitizeSharedText(task.status),
      assigneeNodeId: task.assigneeNodeId,
      assigneeTitle: task.assigneeTitle ? sanitizeSharedText(task.assigneeTitle) : null,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    }));
    const activityByAgent = new Map<string, typeof control.activity>();
    for (const event of control.activity) {
      const events = activityByAgent.get(event.nodeId) ?? [];
      if (events.length < 6) events.push(event);
      activityByAgent.set(event.nodeId, events);
    }
    const coordinationByAgent = new Map<string, NonNullable<SharedWorkspaceDto['agents'][number]['workSummary']>['coordination']>();
    for (const thread of control.communications) {
      for (const [nodeId, direction] of [[thread.fromNodeId, 'sent'], [thread.toNodeId, 'received']] as const) {
        if (!nodeId) continue;
        const previous = coordinationByAgent.get(nodeId) ?? {
          sent: 0, received: 0, replied: 0, failed: 0,
          lastPeerTitle: null, lastDirection: null, lastState: null, lastAt: null,
        };
        previous[direction] += 1;
        if (thread.state === 'replied') previous.replied += 1;
        if (thread.state === 'failed') previous.failed += 1;
        if (!previous.lastAt || thread.updatedAt > previous.lastAt) {
          const peerTitle = direction === 'sent' ? thread.toTitle : thread.fromTitle;
          previous.lastPeerTitle = peerTitle ? sanitizeSharedText(peerTitle).slice(0, 120) : null;
          previous.lastDirection = direction;
          previous.lastState = thread.state;
          previous.lastAt = thread.updatedAt;
        }
        coordinationByAgent.set(nodeId, previous);
      }
    }
    const projection: SharedWorkspaceDto = {
      shareId: share.id,
      revision: share.revision,
      workspace: {
        name: sanitizeSharedText(workspace.name),
        icon: workspace.icon && sanitizeSharedText(workspace.icon) === workspace.icon ? workspace.icon.slice(0, 200) : null,
      },
      nodes,
      edges: rawEdges.filter((edge) => sharedNodeIds.has(edge.sourceNodeId) && sharedNodeIds.has(edge.targetNodeId)).map((edge) => ({
        id: edge.id, sourceNodeId: edge.sourceNodeId, targetNodeId: edge.targetNodeId, style: edge.style,
      })),
      columns: columns.map((column) => ({
        id: column.id, key: sanitizeSharedText(column.key), name: column.name ? sanitizeSharedText(column.name) : null,
        color: column.color, position: column.position,
      })),
      tasks: projectedTasks,
      agents: control.agents.map((agent) => {
        const recent = activityByAgent.get(agent.nodeId) ?? [];
        return {
          id: agent.nodeId,
          title: sanitizeSharedText(agent.title),
          provider: agent.provider ? sanitizeSharedText(agent.provider) : null,
          role: agent.role ? sanitizeSharedText(agent.role) : null,
          state: agent.state,
          stateSince: agent.stateSince,
          currentTask: agent.currentTask ? {
            id: agent.currentTask.id,
            title: sanitizeSharedText(agent.currentTask.title),
            status: sanitizeSharedText(agent.currentTask.status),
          } : null,
          workSummary: {
            focus: agent.currentTask?.title
              ? sanitizeSharedText(agent.currentTask.title).slice(0, 180)
              : recent[0]?.objectTitle
                ? sanitizeSharedText(recent[0].objectTitle).slice(0, 180)
                : null,
            lastActiveAt: recent[0]?.createdAt ?? agent.stateSince,
            recentActivity: recent.map((event) => ({
              id: event.id,
              category: event.category,
              verb: sanitizeSharedText(event.verb).slice(0, 80),
              objectTitle: event.objectTitle ? sanitizeSharedText(event.objectTitle).slice(0, 180) : null,
              state: event.state,
              severity: event.severity,
              occurredAt: event.createdAt,
            })),
            coordination: coordinationByAgent.get(agent.nodeId) ?? {
              sent: 0, received: 0, replied: 0, failed: 0,
              lastPeerTitle: null, lastDirection: null, lastState: null, lastAt: null,
            },
          },
        };
      }),
      conversations: control.communications
        .filter((thread) => thread.events.some((event) => event.metadata.remoteShareId === share.id))
        .map((thread) => ({
          messageId: thread.messageId,
          agentNodeId: thread.toNodeId,
          agentTitle: sanitizeSharedText(thread.toTitle),
          state: thread.state,
          message: sanitizeSharedText(thread.content),
          reply: thread.reply ? sanitizeSharedText(thread.reply) : null,
          error: thread.error ? sanitizeSharedText(thread.error) : null,
          createdAt: thread.createdAt,
          updatedAt: thread.updatedAt,
        })),
      huddles: (await Promise.all(huddleSnapshot.huddles.map(async (summary) => {
        const item = await huddleService.snapshot(share.workspaceId, summary.id).then((value) => value.selected).catch(() => null);
        if (!item) return null;
        return {
          id: item.id,
          title: sanitizeSharedText(item.title).slice(0, 160),
          agenda: item.agenda ? sanitizeSharedText(item.agenda) : null,
          status: item.status,
          facilitatorNodeId: item.facilitatorNodeId,
          linkedTaskId: item.linkedTaskId,
          participants: item.participants.filter((participant) => !participant.leftAt).map((participant) => ({
            kind: participant.kind, participantId: participant.participantId,
            displayName: sanitizeSharedText(participant.displayName).slice(0, 120), role: participant.role,
          })),
          turns: item.turns.map((turn) => ({
            id: turn.id, sequence: turn.sequence, speakerKind: turn.speakerKind,
            speakerName: sanitizeSharedText(turn.speakerName).slice(0, 120), addressedNodeId: turn.addressedNodeId,
            text: sanitizeSharedText(turn.text), state: turn.state, errorCode: turn.errorCode,
            createdAt: turn.createdAt,
          })),
          startedAt: item.startedAt, endedAt: item.endedAt, updatedAt: item.updatedAt,
        };
      }))).filter((item): item is NonNullable<typeof item> => Boolean(item)),
      floors: floors.map((floor) => {
        const floorAgentIds = new Set(rawNodes.filter((node) => node.floorId === floor.id && node.type === 'terminal').map((node) => node.id));
        return {
          id: floor.id,
          name: sanitizeSharedText(floor.name),
          status: floor.status,
          activeTasks: projectedTasks.filter((task) => task.assigneeNodeId && floorAgentIds.has(task.assigneeNodeId) && task.status !== 'done').length,
          activeAgents: control.agents.filter((agent) => floorAgentIds.has(agent.nodeId) && agent.state !== 'disconnected').length,
        };
      }),
      roles: [...roleCounts.entries()].map(([name, agentCount]) => ({ name: sanitizeSharedText(name), agentCount })),
      reviews: reviews.reviews.map((review) => ({
        id: review.id,
        title: sanitizeSharedText(review.title),
        summary: review.summary ? sanitizeSharedText(review.summary) : null,
        status: review.status,
        taskTitle: review.taskTitle ? sanitizeSharedText(review.taskTitle) : null,
        assigneeTitle: review.assigneeTitle ? sanitizeSharedText(review.assigneeTitle) : null,
        evidenceCount: review.evidence.length,
        testCount: review.tests.length,
        riskCount: review.risks.length,
        decidedAt: review.decidedAt,
        createdAt: review.createdAt,
        updatedAt: review.updatedAt,
      })),
      designs: designDocuments.map(({ node, document, live }) => ({
        nodeId: node.id,
        name: sanitizeSharedText(document.name),
        revision: document.revision,
        pages: document.pages.map((page) => ({ id: page.id, name: sanitizeSharedText(page.name).slice(0, 120) })),
        elements: document.elements.map((element) => {
          const solid = element.fills.find((paint) => paint.type === 'solid');
          return {
            id: element.id,
            pageId: element.pageId,
            name: sanitizeSharedText(element.name).slice(0, 120),
            type: element.type,
            x: finite(element.x, 0),
            y: finite(element.y, 0),
            width: Math.max(1, finite(element.width, 1)),
            height: Math.max(1, finite(element.height, 1)),
            opacity: Math.max(0, Math.min(1, finite(element.opacity, 1))),
            fill: solid?.type === 'solid' && /^#[0-9a-f]{6}$/i.test(solid.color) ? solid.color : '#ffffff',
          };
        }),
        pageCount: document.pages.length,
        elementCount: document.elements.length,
        presences: live.presences.map((presence) => ({
          participantId: presence.participant.id,
          name: sanitizeSharedText(presence.participant.name).slice(0, 120),
          color: presence.participant.color,
          pageId: presence.pageId,
          elementCount: presence.elementIds.length,
        })),
        comments: document.comments.map((comment) => {
          const first = comment.messages[0];
          return {
            id: comment.id,
            pageId: comment.pageId,
            pageName: sanitizeSharedText(document.pages.find((page) => page.id === comment.pageId)?.name ?? ''),
            elementId: comment.elementId,
            elementName: comment.elementId ? sanitizeSharedText(document.elements.find((element) => element.id === comment.elementId)?.name ?? '') || null : null,
            status: comment.status,
            authorName: sanitizeSharedText(first.author.name).slice(0, 120),
            body: sanitizeSharedText(first.body),
            replyCount: Math.max(0, comment.messages.length - 1),
            updatedAt: comment.updatedAt,
          };
        }),
        proposals: document.proposals.map((proposal) => ({
          id: proposal.id,
          title: sanitizeSharedText(proposal.title),
          description: sanitizeSharedText(proposal.description),
          authorName: sanitizeSharedText(proposal.author.name).slice(0, 120),
          status: proposal.status,
          operationCount: proposal.operations.length,
          floorId: proposal.floorId,
          councilId: proposal.councilId,
          updatedAt: proposal.updatedAt,
        })),
      })),
      usage: usageService.cached().map((usage) => ({
        provider: usage.provider,
        plan: usage.plan ? sanitizeSharedText(usage.plan).slice(0, 80) : null,
        windows: usage.windows.map((window) => ({
          kind: window.kind,
          usedPercent: window.usedPercent,
          resetsAt: window.resetsAt,
        })),
        available: !usage.error && usage.windows.length > 0,
        diagnostic: usage.diagnostic ?? null,
        fetchedAt: usage.fetchedAt,
      })),
      activity: [
        ...control.agents.map((agent) => ({
          id: `agent_${agent.nodeId}_${agent.stateSince}`,
          kind: 'agent' as const,
          title: sanitizeSharedText(agent.title),
          detail: agent.currentTask ? sanitizeSharedText(agent.currentTask.title) : null,
          state: agent.state,
          occurredAt: agent.stateSince,
        })),
        ...projectedTasks.map((task) => ({
          id: `task_${task.id}_${task.updatedAt}`,
          kind: 'task' as const,
          title: task.title,
          detail: task.assigneeTitle,
          state: task.status,
          occurredAt: task.updatedAt,
        })),
        ...reviews.reviews.map((review) => ({
          id: `review_${review.id}_${review.updatedAt}`,
          kind: 'review' as const,
          title: sanitizeSharedText(review.title),
          detail: review.assigneeTitle ? sanitizeSharedText(review.assigneeTitle) : null,
          state: review.status,
          occurredAt: review.updatedAt,
        })),
      ].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)).slice(0, 40),
      generatedAt: new Date().toISOString(),
    };
    const fitted = fitSharedWorkspaceSnapshot(projection);
    assertSharedProjectionSafe(fitted);
    return fitted;
  }
}

export const sharedWorkspaceQuery = new SharedWorkspaceQuery();
