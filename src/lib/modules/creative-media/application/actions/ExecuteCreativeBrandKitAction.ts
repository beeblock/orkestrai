import { Action } from '@beeblock/svelar/actions';
import type { CreativeBrandKitDto } from '../dto/CreativeBrandKitDto.js';
import { creativeBrandKitService } from '../services/CreativeBrandKitService.js';
export class ExecuteCreativeBrandKitAction extends Action<CreativeBrandKitDto, unknown> {
  async execute(dto: CreativeBrandKitDto) { return creativeBrandKitService.execute(dto.workspaceId, dto.input, dto.actor); }
}
