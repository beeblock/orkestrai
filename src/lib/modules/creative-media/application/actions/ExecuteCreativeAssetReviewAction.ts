import { Action } from '@beeblock/svelar/actions';
import type { CreativeAssetReviewDto } from '../dto/CreativeAssetReviewDto.js';
import { creativeAssetReviewService } from '../services/CreativeAssetReviewService.js';
export class ExecuteCreativeAssetReviewAction extends Action<CreativeAssetReviewDto, unknown> {
  async execute(dto: CreativeAssetReviewDto) { return creativeAssetReviewService.execute(dto.workspaceId, dto.input, dto.actor); }
}
