import { Action } from '@beeblock/svelar/actions';
import type { PostChannelMessageDto } from '../dto/ChannelDto.js';
import { channelService, type OwnerPostResult } from '../services/ChannelService.js';

export class PostChannelMessageAction extends Action<PostChannelMessageDto, OwnerPostResult> {
  async execute(input: PostChannelMessageDto): Promise<OwnerPostResult> {
    return channelService.postOwner(input.workspaceId, input.channel, { body: input.input.body, replyToId: input.input.replyToId ?? null });
  }
}

export const postChannelMessageAction = new PostChannelMessageAction();
