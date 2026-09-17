import { Action } from '@beeblock/svelar/actions';
import type { CreativeRecipeDto } from '../dto/CreativeRecipeDto.js';
import { creativeRecipeService } from '../services/CreativeRecipeService.js';
export class ExecuteCreativeRecipeAction extends Action<CreativeRecipeDto, unknown> {
  async execute(dto: CreativeRecipeDto) { return creativeRecipeService.execute(dto.workspaceId, dto.input, dto.actor); }
}
