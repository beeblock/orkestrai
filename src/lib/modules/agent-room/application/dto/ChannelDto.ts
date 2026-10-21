import type { PostChannelMessageInput } from '../../contracts/schemas/channel.schema.js';

export class PostChannelMessageDto {
  constructor(
    public readonly workspaceId: string,
    public readonly channel: string,
    public readonly input: PostChannelMessageInput,
  ) {}
}
