import { Action } from '@beeblock/svelar/actions';
import type { CreativeProviderDto } from '../dto/CreativeProviderDto.js';
import type { CreativeProfileSave } from '../../contracts/schemas/creative-media.schema.js';
import { creativeProviderService } from '../services/CreativeProviderService.js';

export class ExecuteCreativeProviderAction extends Action<CreativeProviderDto, unknown> {
  async execute(dto: CreativeProviderDto): Promise<unknown> {
    switch (dto.command) {
      case 'save': return creativeProviderService.save(dto.input as CreativeProfileSave, dto.profileId);
      case 'policy': return creativeProviderService.savePolicy(dto.workspaceId!, dto.profileId!, dto.input);
      case 'remove': await creativeProviderService.remove(dto.profileId!); return { removed: true };
    }
  }
}
