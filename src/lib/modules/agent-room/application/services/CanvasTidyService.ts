import { workspaceRepository } from '../../infrastructure/repositories/WorkspaceRepository.js';
import { settingsService } from './SettingsService.js';
import { findFreeCanvasPosition } from '../../domain/canvas-placement.js';
import { shownOnFloor } from '../../domain/canvas-floors.js';
import { arrangeGroupMembers, fitGroupFrame } from '$lib/components/agent-room/canvas/layout.js';
import type { CanvasNode, ImageNodePayload, ImageWorkflowNodePayload } from '../../domain/types.js';

type CanvasEdge = Awaited<ReturnType<typeof workspaceRepository.listEdges>>[number];

/** Group that collects the images an agent generated, next to that agent. */
export const GENERATED_IMAGES_GROUP = 'generated-images';

function neighbours(id: string, edges: CanvasEdge[]): string[] {
  return edges.flatMap((edge) => edge.sourceNodeId === id ? [edge.targetNodeId] : edge.targetNodeId === id ? [edge.sourceNodeId] : []);
}

const IMAGES_LABEL: Record<string, { owned: (agent: string) => string; plain: string }> = {
  'pt-BR': { owned: (agent) => `${agent} · imagens`, plain: 'Imagens geradas' },
  es: { owned: (agent) => `${agent} · imágenes`, plain: 'Imágenes generadas' },
  en: { owned: (agent) => `${agent} · images`, plain: 'Generated images' },
};

function broadcast(workspaceId: string): void {
  const send = (globalThis as { __orkestraiBroadcast?: (payload: Record<string, unknown>) => void }).__orkestraiBroadcast;
  send?.({ type: 'workspaceChanged', workspaceId });
}

/**
 * Takes finished scaffolding off the board. A finished image workflow and the
 * notes that only briefed it are archived (hidden, kept, restorable) and its
 * images gather in one tidy group beside the agent that made them.
 */
export class CanvasTidyService {
  async enabled(): Promise<boolean> {
    return (await settingsService.get('tidyFinishedWork')) !== 'false';
  }

  /** Notes connected to the finished workflows whose every link is a finished workflow or an agent. */
  scaffoldNotes(targets: Set<string>, nodes: CanvasNode[], edges: CanvasEdge[], finished: Set<string>): string[] {
    const byId = new Map(nodes.map((node) => [node.id, node]));
    return nodes
      .filter((node) => node.type === 'note')
      .filter((note) => {
        const linked = neighbours(note.id, edges).map((id) => byId.get(id)).filter((node): node is CanvasNode => Boolean(node));
        if (!linked.some((node) => targets.has(node.id))) return false;
        return linked.every((node) => (node.type === 'imageWorkflow' && finished.has(node.id)) || node.type === 'terminal');
      })
      .map((note) => note.id);
  }

  async tidyWorkflows(workspaceId: string, workflowIds: string[]): Promise<{ archived: string[]; gathered: string[] }> {
    const [nodes, edges] = await Promise.all([
      workspaceRepository.listNodes(workspaceId, undefined, false, true),
      workspaceRepository.listEdges(workspaceId),
    ]);
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const finished = new Set(nodes
      .filter((node) => node.type === 'imageWorkflow' && (node.payload as ImageWorkflowNodePayload).status === 'succeeded')
      .map((node) => node.id));
    const targets = new Set(workflowIds.filter((id) => finished.has(id)));
    if (!targets.size) return { archived: [], gathered: [] };

    // Each workflow's images go to the agent that ran it (or the agent wired to it).
    const outputsByAgent = new Map<string, CanvasNode[]>();
    for (const workflowId of targets) {
      const workflow = byId.get(workflowId)!;
      const payload = workflow.payload as ImageWorkflowNodePayload;
      const wired = neighbours(workflowId, edges).map((id) => byId.get(id)).find((node) => node?.type === 'terminal');
      const executor = [...(payload.history ?? [])].reverse().find((run) => run.executorNodeId)?.executorNodeId ?? null;
      const agentId = (executor && byId.get(executor)?.type === 'terminal' ? executor : wired?.id) ?? '';
      const outputs = nodes.filter((node) => node.type === 'image' && (node.payload as ImageNodePayload).generatedBy?.workflowNodeId === workflowId);
      outputsByAgent.set(agentId, [...(outputsByAgent.get(agentId) ?? []), ...outputs]);
    }

    const label = IMAGES_LABEL[await settingsService.get('uiLanguage')] ?? IMAGES_LABEL.en;
    const gathered: string[] = [];
    for (const [agentId, outputs] of outputsByAgent) {
      if (!outputs.length) continue;
      const agent = agentId ? byId.get(agentId) ?? null : null;
      const floorId = agent?.floorId ?? outputs[0].floorId ?? null;
      let group = nodes.find((node) => node.type === 'group'
        && (node.payload as { workflowKind?: string }).workflowKind === GENERATED_IMAGES_GROUP
        && (node.payload as { ownerNodeId?: string | null }).ownerNodeId === (agentId || null)
        && (node.floorId ?? null) === floorId) ?? null;
      if (!group) {
        const anchor = agent ?? outputs[0];
        const occupied = nodes.filter((node) => shownOnFloor(node, floorId) && !targets.has(node.id) && !outputs.some((output) => output.id === node.id) && node.type !== 'group')
          .map((node) => ({ x: node.x, y: node.y, width: node.width, height: node.height }));
        const size = { width: 700, height: 600 };
        const spot = findFreeCanvasPosition(occupied, { x: anchor.x + anchor.width + 96, y: anchor.y, ...size }, { gap: 64 });
        group = await workspaceRepository.createNode({
          workspaceId,
          type: 'group',
          title: agent?.title ? label.owned(agent.title) : label.plain,
          x: spot.x,
          y: spot.y,
          ...size,
          zIndex: -1,
          floorId,
          payload: { workflowKind: GENERATED_IMAGES_GROUP, ownerNodeId: agentId || null, members: [] },
        });
      }
      const groupPayload = group.payload as { members?: string[] };
      const memberIds = [...new Set([...(groupPayload.members ?? []), ...outputs.map((node) => node.id)])];
      const members = memberIds.map((id) => byId.get(id) ?? outputs.find((node) => node.id === id)).filter((node): node is CanvasNode => Boolean(node));
      const places = arrangeGroupMembers(members.map((node) => ({ id: node.id, x: node.x, y: node.y, width: node.width, height: node.height })), { x: group.x, y: group.y });
      for (const member of members) {
        const place = places.get(member.id);
        if (place && (place.x !== member.x || place.y !== member.y)) await workspaceRepository.updateNode(member.id, { x: place.x, y: place.y });
      }
      const frame = fitGroupFrame(members.map((node) => ({ id: node.id, ...(places.get(node.id) ?? { x: node.x, y: node.y }), width: node.width, height: node.height })));
      await workspaceRepository.updateNode(group.id, {
        ...(frame ? { x: frame.x, y: frame.y, width: Math.round(frame.width), height: Math.round(frame.height) } : {}),
        payload: { ...(group.payload as Record<string, unknown>), members: memberIds },
      });
      gathered.push(...outputs.map((node) => node.id));
    }

    const archived = [...targets, ...this.scaffoldNotes(targets, nodes, edges, finished)];
    for (const id of archived) await workspaceRepository.setNodeArchived(workspaceId, id, true);
    broadcast(workspaceId);
    return { archived, gathered };
  }

  /** Every finished image workflow on the board at once, for boards that piled up before. */
  async tidyFinished(workspaceId: string): Promise<{ archived: string[]; gathered: string[] }> {
    const nodes = await workspaceRepository.listNodes(workspaceId, undefined, false, true);
    const finished = nodes
      .filter((node) => node.type === 'imageWorkflow' && (node.payload as ImageWorkflowNodePayload).status === 'succeeded')
      .map((node) => node.id);
    return this.tidyWorkflows(workspaceId, finished);
  }

  async listArchived(workspaceId: string) {
    const nodes = await workspaceRepository.listArchivedNodes(workspaceId);
    return nodes.map((node) => ({ id: node.id, type: node.type, title: node.title ?? '', archivedAt: node.archivedAt }));
  }

  async restore(workspaceId: string, nodeIds: string[]): Promise<number> {
    for (const id of nodeIds) await workspaceRepository.setNodeArchived(workspaceId, id, false);
    broadcast(workspaceId);
    return nodeIds.length;
  }
}

export const canvasTidyService = new CanvasTidyService();
