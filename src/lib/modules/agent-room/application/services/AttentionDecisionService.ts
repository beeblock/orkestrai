import type { AgentAttentionItem } from '../../domain/types.js';
import { attentionRepository } from '../../infrastructure/repositories/AttentionRepository.js';
import { agentLearningRepository } from '../../infrastructure/repositories/AgentLearningRepository.js';
import { AgentLearningCommandDto } from '../dto/AgentLearningCommandDto.js';
import { DecideAgentReviewDto } from '../dto/AgentReviewDto.js';
import { agentLearningService } from './AgentLearningService.js';
import { agentWorkspaceToolService } from './AgentWorkspaceToolService.js';
import { attentionService } from './AttentionService.js';
import { autonomyPolicyService } from './AutonomyPolicyService.js';
import { flowService } from './FlowService.js';
import { reviewCenterService } from './ReviewCenterService.js';

export type AttentionDecision = 'approve' | 'reject';
const OWNER = 'workspace-owner';

function stringField(action: Record<string, unknown>, key: string): string {
  const value = action[key];
  if (typeof value !== 'string' || !value) throw new Error('Este item não tem uma decisão disponível.');
  return value;
}

/**
 * Decides an attention item where it is shown: each kind delegates to the
 * service that owns the underlying request, so the same rules (gate
 * requirements, owner-only publishing, revisions) apply as on its own screen.
 */
export class AttentionDecisionService {
  /** `actorId` is recorded on gate decisions: the owner, or the remote device acting for them. */
  async decide(workspaceId: string, id: string, decision: AttentionDecision, actorId: string = OWNER): Promise<AgentAttentionItem | null> {
    const item = await attentionRepository.find(workspaceId, id);
    if (!item) throw new Error('Item de atenção não encontrado.');
    if (item.status === 'resolved') throw new Error('Este item já foi resolvido.');
    const action = item.action ?? {};
    const approve = decision === 'approve';
    switch (action.decision) {
      case 'gate':
        await autonomyPolicyService.resolveGate(workspaceId, stringField(action, 'gateId'), approve ? 'approved' : 'denied', actorId, null);
        break;
      case 'flow': {
        const nodeId = item.nodeId ?? stringField(action, 'nodeId');
        if (approve) flowService.approve(workspaceId, nodeId);
        else flowService.stop(workspaceId, nodeId);
        break;
      }
      case 'tool': {
        const toolId = stringField(action, 'toolId');
        if (approve) await agentWorkspaceToolService.publish(workspaceId, toolId, { type: 'user', id: OWNER });
        else await agentWorkspaceToolService.archive(workspaceId, toolId, { type: 'user', id: OWNER });
        break;
      }
      case 'learning': {
        const entryId = stringField(action, 'entryId');
        if (!item.nodeId) throw new Error('Este item não tem uma decisão disponível.');
        const entry = (await agentLearningRepository.list(workspaceId, item.nodeId)).find((candidate) => candidate.id === entryId);
        if (!entry) throw new Error('Aprendizado não encontrado.');
        await agentLearningService.execute(new AgentLearningCommandDto(workspaceId, {
          command: 'decide', nodeId: item.nodeId, id: entry.id, revision: entry.revision, status: approve ? 'active' : 'rejected',
        }, { type: 'user' }));
        break;
      }
      case 'review':
        await reviewCenterService.decide(workspaceId, stringField(action, 'reviewId'), new DecideAgentReviewDto(approve ? 'approved' : 'changes_requested', null));
        break;
      default:
        throw new Error('Este item não tem uma decisão disponível.');
    }
    if (item.sourceType && item.sourceId) await attentionService.resolveSource(workspaceId, item.sourceType, item.sourceId);
    return attentionRepository.find(workspaceId, id);
  }
}

export const attentionDecisionService = new AttentionDecisionService();
