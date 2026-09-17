import { Action } from '@beeblock/svelar/actions';
import type { CreativeCharacterDto } from '../dto/CreativeCharacterDto.js';
import { creativeWorkflowService } from '../services/CreativeWorkflowService.js';
import { creativeCharacterService } from '../services/CreativeCharacterService.js';
export class ExecuteCreativeCharacterAction extends Action<CreativeCharacterDto, unknown> {
  async execute(dto: CreativeCharacterDto) {
    await creativeWorkflowService.assertActor(dto.workspaceId, dto.actor, !['list', 'library', 'read'].includes(dto.input.command));
    return creativeCharacterService.execute(dto.workspaceId, dto.input, dto.actor);
  }
}
