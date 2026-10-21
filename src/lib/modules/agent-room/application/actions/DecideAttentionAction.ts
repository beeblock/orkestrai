import { Action } from '@beeblock/svelar/actions';
import type { AgentAttentionItem } from '../../domain/types.js';
import type { DecideAttentionDto } from '../dto/DecideAttentionDto.js';
import { attentionDecisionService } from '../services/AttentionDecisionService.js';

export class DecideAttentionAction extends Action<DecideAttentionDto, AgentAttentionItem | null> {
  async execute(input: DecideAttentionDto): Promise<AgentAttentionItem | null> {
    return attentionDecisionService.decide(input.workspaceId, input.id, input.decision);
  }
}

export const decideAttentionAction = new DecideAttentionAction();
