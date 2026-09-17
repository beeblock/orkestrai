import type { CreativeActor } from '../../domain/types.js';
import { creativeCharacterCommandSchema, type CreativeCharacterCommand } from '../../contracts/schemas/creative-character.schema.js';
export class CreativeCharacterDto {
  private constructor(readonly workspaceId: string, readonly actor: CreativeActor, readonly input: CreativeCharacterCommand) {}
  static from(workspaceId: string, actor: CreativeActor, input: unknown) { return new CreativeCharacterDto(workspaceId, actor, creativeCharacterCommandSchema.parse(input)); }
}
