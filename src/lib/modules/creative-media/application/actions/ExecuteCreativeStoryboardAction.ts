import { Action } from '@beeblock/svelar/actions';

import type { CreativeStoryboardDto } from '../dto/CreativeStoryboardDto.js';
import { creativeStoryboardService } from '../services/CreativeStoryboardService.js';
export class ExecuteCreativeStoryboardAction extends Action<CreativeStoryboardDto, unknown> {
  execute(dto: CreativeStoryboardDto) { return creativeStoryboardService.execute(dto.workspaceId, dto.input, dto.actor); }
}
