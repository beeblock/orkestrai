import { Action } from '@beeblock/svelar/actions';
import type { CreativeSequenceDto } from '../dto/CreativeSequenceDto.js';
import { creativeSequenceService } from '../services/CreativeSequenceService.js';
export class ExecuteCreativeSequenceAction extends Action<CreativeSequenceDto, unknown> {
  async execute(dto: CreativeSequenceDto) { return creativeSequenceService.execute(dto.workspaceId, dto.input, dto.actor); }
}
