import type { CreativeActor } from '../../domain/types.js';
import { creativeStoryboardCommandSchema, type CreativeStoryboardCommand } from '../../contracts/schemas/creative-storyboard.schema.js';
export class CreativeStoryboardDto {
  private constructor(readonly workspaceId: string, readonly actor: CreativeActor, readonly input: CreativeStoryboardCommand) {}
  static from(workspaceId: string, actor: CreativeActor, input: unknown) { return new CreativeStoryboardDto(workspaceId, actor, creativeStoryboardCommandSchema.parse(input)); }
}
