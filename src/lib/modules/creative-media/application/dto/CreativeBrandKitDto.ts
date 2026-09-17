import type { CreativeActor } from '../../domain/types.js';
import { creativeBrandCommandSchema, type CreativeBrandCommand } from '../../contracts/schemas/creative-brand.schema.js';
export class CreativeBrandKitDto {
  private constructor(readonly workspaceId: string, readonly actor: CreativeActor, readonly input: CreativeBrandCommand) {}
  static from(workspaceId: string, actor: CreativeActor, input: unknown) { return new CreativeBrandKitDto(workspaceId, actor, creativeBrandCommandSchema.parse(input)); }
}
