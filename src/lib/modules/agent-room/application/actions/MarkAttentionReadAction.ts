import { Action } from '@beeblock/svelar/actions';
import type { MarkAttentionReadDto } from '../dto/MarkAttentionReadDto.js';
import { attentionService } from '../services/AttentionService.js';

export class MarkAttentionReadAction extends Action<MarkAttentionReadDto, { count: number; readAt: string }> {
  async execute(input: MarkAttentionReadDto): Promise<{ count: number; readAt: string }> {
    return attentionService.markAllRead(input);
  }
}
export const markAttentionReadAction = new MarkAttentionReadAction();
