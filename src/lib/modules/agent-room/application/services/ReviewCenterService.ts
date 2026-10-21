import { AgentBoardTask } from '../../domain/models/AgentBoardTask.js';
import type {
  AgentReviewCommentData,
  AgentReviewData,
  ReviewCenterSnapshot,
  ReviewDecisionResult,
} from '../../contracts/schemas/review-schemas.schema.js';
import { AgentReviewResource } from '../../interface/http/resources/AgentReviewResource.js';
import { reviewCenterRepository } from '../../infrastructure/repositories/ReviewCenterRepository.js';
import { workspaceRepository } from '../../infrastructure/repositories/WorkspaceRepository.js';
import { CreateAgentReviewCommentDto, CreateAgentReviewDto, DecideAgentReviewDto } from '../dto/AgentReviewDto.js';
import { gitService } from './GitService.js';
import { bridgeService } from './BridgeService.js';
import { attentionService } from './AttentionService.js';

export const REVIEW_ATTENTION_SOURCE = 'review';

function broadcast(workspaceId: string): void {
  const send = (globalThis as { __orkestraiBroadcast?: (frame: Record<string, unknown>) => void }).__orkestraiBroadcast;
  send?.({ type: 'gitReviewChanged', workspaceId });
}

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return new Date(String(value)).toISOString();
}

export class ReviewCenterService {
  private async requireWorkspace(workspaceId: string): Promise<void> {
    if (!await workspaceRepository.getWorkspace(workspaceId)) throw new Error('Workspace não encontrado.');
  }

  private async projectReview(
    model: Awaited<ReturnType<typeof reviewCenterRepository.findReview>> extends infer T ? NonNullable<T> : never,
    revision: string,
    titles: Map<string, string>,
    taskTitles: Map<string, string>,
  ): Promise<AgentReviewData> {
    const base = new AgentReviewResource(model).toJSON();
    const comments = await reviewCenterRepository.listComments(base.id);
    return {
      ...base,
      taskTitle: base.taskId ? taskTitles.get(base.taskId) ?? null : null,
      assigneeTitle: base.assigneeNodeId ? titles.get(base.assigneeNodeId) ?? null : null,
      comments: comments.map((comment): AgentReviewCommentData => ({
        id: String(comment.getAttribute('id')),
        reviewId: String(comment.getAttribute('review_id')),
        workspaceId: String(comment.getAttribute('workspace_id')),
        authorNodeId: comment.getAttribute('author_node_id') as string | null,
        authorTitle: comment.getAttribute('author_node_id')
          ? titles.get(String(comment.getAttribute('author_node_id'))) ?? null
          : null,
        filePath: String(comment.getAttribute('file_path')),
        lineNumber: comment.getAttribute('line_number') as number | null,
        side: comment.getAttribute('side') as AgentReviewCommentData['side'],
        body: String(comment.getAttribute('body')),
        revision: String(comment.getAttribute('revision')),
        status: comment.getAttribute('status') as 'open' | 'resolved',
        stale: String(comment.getAttribute('revision')) !== revision,
        createdAt: iso(comment.getAttribute('created_at')),
        updatedAt: iso(comment.getAttribute('updated_at')),
      })),
    };
  }

  async snapshot(workspaceId: string): Promise<ReviewCenterSnapshot> {
    await this.requireWorkspace(workspaceId);
    const [git, reviewModels, nodes, taskModels] = await Promise.all([
      gitService.status(workspaceId),
      reviewCenterRepository.listReviews(workspaceId),
      workspaceRepository.listNodes(workspaceId, undefined, true),
      AgentBoardTask.query().where('workspace_id', workspaceId).orderBy('updated_at', 'desc').get(),
    ]);
    const titles = new Map(nodes.map((node) => [node.id, node.title ?? node.type]));
    const taskTitles = new Map(taskModels.map((task) => [String(task.getAttribute('id')), String(task.getAttribute('title'))]));
    const reviews = await Promise.all(reviewModels.map((review) => this.projectReview(review, git.revision, titles, taskTitles)));
    return {
      git,
      reviews,
      agents: nodes.filter((node) => node.type === 'terminal').map((node) => ({
        id: node.id,
        title: node.title ?? 'Terminal',
        role: (node.payload as { role?: string | null }).role ?? null,
        provider: (node.payload as { provider?: string | null }).provider ?? null,
      })),
      tasks: taskModels.map((task) => ({
        id: String(task.getAttribute('id')),
        title: String(task.getAttribute('title')),
        status: String(task.getAttribute('status')),
        assigneeNodeId: task.getAttribute('assignee_node_id') as string | null,
      })),
    };
  }

  async create(workspaceId: string, dto: CreateAgentReviewDto): Promise<AgentReviewData> {
    const snapshot = await this.snapshot(workspaceId);
    if (!snapshot.git.isRepo) throw new Error('Este workspace não é um repositório Git.');
    if (dto.taskId && !snapshot.tasks.some((task) => task.id === dto.taskId)) throw new Error('Tarefa não encontrada neste workspace.');
    if (dto.assigneeNodeId && !snapshot.agents.some((agent) => agent.id === dto.assigneeNodeId)) throw new Error('Agente não encontrado neste workspace.');
    const changedPaths = new Set(snapshot.git.changes.map((change) => change.path));
    if (dto.selectedPaths.some((path) => !changedPaths.has(path))) throw new Error('Um dos arquivos selecionados não pertence ao snapshot Git atual.');
    const model = await reviewCenterRepository.createReview(workspaceId, snapshot.git.revision, dto);
    broadcast(workspaceId);
    const created = (await this.snapshot(workspaceId)).reviews.find((review) => review.id === model.getAttribute('id'))!;
    await attentionService.raise({
      workspaceId, nodeId: created.assigneeNodeId ?? null, taskId: created.taskId ?? null, category: 'review', severity: 'info',
      title: created.title.slice(0, 200), body: null,
      sourceType: REVIEW_ATTENTION_SOURCE, sourceId: created.id, correlationId: `${REVIEW_ATTENTION_SOURCE}:${created.id}`,
      action: { target: 'review', decision: 'review', reviewId: created.id },
    }).catch(() => undefined);
    return created;
  }

  async decide(workspaceId: string, reviewId: string, dto: DecideAgentReviewDto): Promise<ReviewDecisionResult> {
    const review = await reviewCenterRepository.findReview(reviewId);
    if (!review || review.getAttribute('workspace_id') !== workspaceId) throw new Error('Review não encontrado neste workspace.');
    await reviewCenterRepository.decideReview(reviewId, dto);
    await attentionService.resolveSource(workspaceId, REVIEW_ATTENTION_SOURCE, reviewId).catch(() => 0);
    const snapshot = await this.snapshot(workspaceId);
    const projected = snapshot.reviews.find((item) => item.id === reviewId)!;
    let feedback: ReviewDecisionResult['feedback'] = null;
    if ((dto.status === 'changes_requested' || dto.status === 'rejected') && projected.assigneeNodeId) {
      const comments = projected.comments.filter((comment) => comment.status === 'open');
      const lines = [
        `Review: ${projected.title}`,
        dto.status === 'rejected' ? 'Decision: rejected.' : 'Decision: changes requested.',
        dto.note ? `Note: ${dto.note}` : '',
        comments.length ? 'Open comments:' : '',
        ...comments.map((comment) => `- ${comment.filePath}${comment.lineNumber ? `:${comment.lineNumber}` : ''}: ${comment.body}`),
      ].filter(Boolean);
      try {
        await bridgeService.sendOneWay(workspaceId, { to: projected.assigneeNodeId, message: lines.join('\n'), kind: 'git-review' });
        feedback = { delivered: true, error: null };
      } catch (error) {
        feedback = { delivered: false, error: error instanceof Error ? error.message : 'Falha ao enviar feedback.' };
      }
    }
    broadcast(workspaceId);
    return { review: projected, feedback };
  }

  async addComment(workspaceId: string, reviewId: string, dto: CreateAgentReviewCommentDto): Promise<AgentReviewData> {
    const review = await reviewCenterRepository.findReview(reviewId);
    if (!review || review.getAttribute('workspace_id') !== workspaceId) throw new Error('Review não encontrado neste workspace.');
    const snapshot = await this.snapshot(workspaceId);
    if (dto.authorNodeId && !snapshot.agents.some((agent) => agent.id === dto.authorNodeId)) throw new Error('Autor não encontrado neste workspace.');
    if (!review.getAttribute('selected_paths_json')?.includes(dto.filePath) && !snapshot.git.changes.some((change) => change.path === dto.filePath)) {
      throw new Error('Arquivo não pertence a este review.');
    }
    await reviewCenterRepository.createComment(review, snapshot.git.revision, dto);
    broadcast(workspaceId);
    return (await this.snapshot(workspaceId)).reviews.find((item) => item.id === reviewId)!;
  }

  async resolveComment(workspaceId: string, reviewId: string, commentId: string, resolved: boolean): Promise<AgentReviewData> {
    const review = await reviewCenterRepository.findReview(reviewId);
    if (!review || review.getAttribute('workspace_id') !== workspaceId) throw new Error('Review não encontrado neste workspace.');
    if (!await reviewCenterRepository.resolveComment(reviewId, commentId, resolved)) throw new Error('Comentário não encontrado.');
    broadcast(workspaceId);
    return (await this.snapshot(workspaceId)).reviews.find((item) => item.id === reviewId)!;
  }
}

export const reviewCenterService = new ReviewCenterService();
