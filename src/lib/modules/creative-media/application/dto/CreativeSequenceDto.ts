import type { CreativeActor } from '../../domain/types.js';
import { creativeSequenceCommandSchema, type CreativeSequenceCommand } from '../../contracts/schemas/creative-sequence.schema.js';
export class CreativeSequenceDto {
  private constructor(readonly workspaceId: string, readonly actor: CreativeActor, readonly input: CreativeSequenceCommand) {}
  static from(workspaceId: string, actor: CreativeActor, input: unknown) { return new CreativeSequenceDto(workspaceId, actor, creativeSequenceCommandSchema.parse(input)); }
}
