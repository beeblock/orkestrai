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

    const payload = node.payload as Record<string, unknown>;
    const work = (payload.explorationWork ?? {}) as Record<string, unknown>;
    if (dto.status === 'approved' && work.phase === 'active') {
      throw new Error('design_review_work_active');
    }
    const now = new Date().toISOString();
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

    const explorationId = typeof payload.explorationId === 'string' ? payload.explorationId : null;
    let expansionTaskId: string | null = null;
    let expansionDispatched = false;
    if (dto.status === 'approved' && explorationId) {
      const explorationNodes = await workspaceRepository.listNodes(dto.workspaceId);
      const group = explorationNodes.find((candidate) => {
        const candidatePayload = candidate.payload as Record<string, unknown>;
        return candidate.type === 'group' && candidatePayload.explorationId === explorationId;
      });
      for (const candidate of explorationNodes) {
        const candidatePayload = candidate.payload as Record<string, unknown>;
        if (candidatePayload.explorationId !== explorationId) continue;
        if (candidate.type === 'design') {
          await workspaceRepository.updateNode(candidate.id, {
            payload: {
              ...(candidate.id === node.id ? nextPayload : candidatePayload),
              deliveryTarget: candidate.id === node.id,
            },
          });
        } else if (candidate.type === 'group') {
          await workspaceRepository.updateNode(candidate.id, {
            payload: { ...candidatePayload, selectedDesignNodeId: node.id },
          });
        }
      }

      const tasks = await taskBoardService.list(dto.workspaceId);
      const reviewTask = tasks.find((task) => task.description?.includes(`orkestrai:design-review=${explorationId}`));
      if (reviewTask && reviewTask.status !== 'done') {
        await taskBoardService.update(dto.workspaceId, reviewTask.id, { status: 'done', completedBy: 'user' });
      }
      const expansionTask = tasks.find((task) => task.description?.includes(`orkestrai:design-stage=expand;exploration=${explorationId}`));
      expansionTaskId = expansionTask?.id ?? null;
      expansionDispatched = Boolean(expansionTask?.assigneeNodeId && expansionTask.status !== 'todo');

      const leader = explorationNodes.find((candidate) => candidate.type === 'terminal' && Boolean((candidate.payload as { maestro?: boolean }).maestro));
      const leaderSessionId = leader ? String((leader.payload as { sessionId?: string }).sessionId ?? '') : '';
      const leaderSession = leaderSessionId ? ptySessionManager.get(leaderSessionId) : null;
      if (
        expansionTask
        && expansionTask.status === 'todo'
        && (group?.payload as { executionMode?: unknown } | undefined)?.executionMode === 'leader'
        && leader
        && leaderSession
        && !leaderSession.exited
      ) {
        await taskBoardService.update(dto.workspaceId, expansionTask.id, { assigneeNodeId: leader.id });
        expansionDispatched = true;
      }
    }

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
    if (session && !session.exited && !expansionDispatched) {
      const outcome = dto.status === 'approved' ? 'approved for expansion' : 'returned with visual feedback';
      const nextStep = dto.status === 'approved'
        ? `The selected direction is recorded on the exploration group. Assign and execute expansion task ${expansionTaskId ?? '(not found)'} now; do not report final delivery until the Design node shows every delivery requirement complete.`
        : 'Redispatch the linked concept task and keep the delivery blocked until the requested visual changes are approved.';
      await agentTerminalDeliveryService.deliver({
        workspaceId: dto.workspaceId,
        nodeId: leader!.id,
        sessionId: session.id,
        message: `[design review] "${node.title ?? document.name}" revision ${dto.revision} was ${outcome}. ${nextStep}`,
      }).catch(() => undefined);
    }

    broadcast(dto.workspaceId, dto.nodeId);
    return { nodeId: dto.nodeId, revision: dto.revision, visualReview: nextPayload.visualReview };
  }
}

export const designReviewService = new DesignReviewService();
