import type { CreativeActor } from '../../domain/types.js';
import { creativeAssetCommandSchema, type CreativeAssetCommand } from '../../contracts/schemas/creative-asset.schema.js';
export class CreativeAssetReviewDto {
  private constructor(readonly workspaceId: string, readonly actor: CreativeActor, readonly input: CreativeAssetCommand) {}
  static from(workspaceId: string, actor: CreativeActor, input: unknown) { return new CreativeAssetReviewDto(workspaceId, actor, creativeAssetCommandSchema.parse(input)); }
}
