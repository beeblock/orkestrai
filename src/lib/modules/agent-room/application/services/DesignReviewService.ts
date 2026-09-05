import type { ReviewDesignDto } from '../dto/DesignDtos.js';
import { workspaceRepository } from '../../infrastructure/repositories/WorkspaceRepository.js';
import { ptySessionManager } from '../../infrastructure/pty/PtySessionManager.js';
import { designDocumentService } from './DesignDocumentService.js';
import { taskBoardService } from './TaskBoardService.js';
import { isDesignExplorationPayload } from '../../domain/design-exploration.js';
import { agentTerminalDeliveryService } from './AgentTerminalDeliveryService.js';

function broadcast(workspaceId: string, nodeId: string): void {
  const send = (globalThis as { __orkestraiBroadcast?: (payload: Record<string, unknown>) => void }).__orkestraiBroadcast;
  send?.({ type: 'workspaceChanged', workspaceId, nodeId });
}

export class DesignReviewService {
  async review(dto: ReviewDesignDto) {
    const [node, document] = await Promise.all([
      workspaceRepository.getNode(dto.nodeId),
      designDocumentService.get(dto.workspaceId, dto.nodeId),
    ]);
    if (!node || node.workspaceId !== dto.workspaceId || node.type !== 'design') {
      throw new Error('design_not_found');
    }
    if (!isDesignExplorationPayload(node.payload)) {
      throw new Error('design_review_not_available');
    }
    if (document.revision !== dto.revision) throw new Error('design_review_revision_changed');
    if (document.elements.length < 10) throw new Error('design_review_empty');

    const now = new Date().toISOString();
    const payload = node.payload as Record<string, unknown>;
    const work = (payload.explorationWork ?? {}) as Record<string, unknown>;
    const nextPayload = {
      ...payload,
      explorationWork: {
        ...work,
        phase: dto.status,
        lastProgressAt: now,
      },
      visualReview: {
        status: dto.status,
        revision: dto.revision,
        note: dto.note,
        reviewedAt: now,
      },
    };
    await workspaceRepository.updateNode(node.id, { payload: nextPayload });

    const taskId = typeof work.taskId === 'string' ? work.taskId : null;
    if (dto.status === 'changes_requested' && taskId) {
      const task = (await taskBoardService.list(dto.workspaceId)).find((candidate) => candidate.id === taskId);
      if (task) {
        const reviewBlock = `### Visual review feedback\n\n${dto.note}`;
        const description = [task.description?.replace(/\n### Visual review feedback[\s\S]*$/u, '').trim(), reviewBlock]
          .filter(Boolean)
          .join('\n\n');
        await taskBoardService.update(dto.workspaceId, taskId, {
          status: 'doing',
          description,
          assigneeNodeId: task.assigneeNodeId,
        });
        await taskBoardService.redispatch(dto.workspaceId, taskId).catch(() => undefined);
      }
    }

    const nodes = await workspaceRepository.listNodes(dto.workspaceId);
    const leader = nodes.find((candidate) => candidate.type === 'terminal' && Boolean((candidate.payload as { maestro?: boolean }).maestro));
    const sessionId = leader ? String((leader.payload as { sessionId?: string }).sessionId ?? '') : '';
    const session = sessionId ? ptySessionManager.get(sessionId) : null;
    if (session && !session.exited) {
      const outcome = dto.status === 'approved' ? 'approved for expansion' : 'returned with visual feedback';
      await agentTerminalDeliveryService.deliver({
        workspaceId: dto.workspaceId,
        nodeId: leader!.id,
        sessionId: session.id,
        message: `[design review] "${node.title ?? document.name}" revision ${dto.revision} was ${outcome}. Check orkestrai design list and the linked Kanban task before continuing.`,
      }).catch(() => undefined);
    }

    broadcast(dto.workspaceId, dto.nodeId);
    return { nodeId: dto.nodeId, revision: dto.revision, visualReview: nextPayload.visualReview };
  }
}

export const designReviewService = new DesignReviewService();
