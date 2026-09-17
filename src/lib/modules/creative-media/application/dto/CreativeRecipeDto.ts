import type { CreativeActor } from '../../domain/types.js';
import { creativeRecipeCommandSchema, type CreativeRecipeCommand } from '../../contracts/schemas/creative-recipe.schema.js';
export class CreativeRecipeDto {
  private constructor(readonly workspaceId: string, readonly actor: CreativeActor, readonly input: CreativeRecipeCommand) {}
  static from(workspaceId: string, actor: CreativeActor, input: unknown) { return new CreativeRecipeDto(workspaceId, actor, creativeRecipeCommandSchema.parse(input)); }
}
