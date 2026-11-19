import { personalBotCommandSchema, type PersonalBotCommand } from '../../contracts/schemas/personal-bot.schema.js';
export class PersonalBotCommandDto {
  private constructor(readonly workspaceId: string, readonly input: PersonalBotCommand, readonly actorNodeId: string | null) {}
  static from(workspaceId: string, input: unknown, actorNodeId: string | null = null) { return new PersonalBotCommandDto(workspaceId, personalBotCommandSchema.parse(input), actorNodeId); }
}
