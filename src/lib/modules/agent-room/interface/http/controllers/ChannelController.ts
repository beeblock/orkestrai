import { Controller, type RequestEvent } from '@beeblock/svelar/routing';
import { PostChannelMessageDto } from '../../../application/dto/ChannelDto.js';
import { postChannelMessageAction } from '../../../application/actions/PostChannelMessageAction.js';
import { channelService } from '../../../application/services/ChannelService.js';
import { listChannelMessagesSchema } from '../../../contracts/schemas/channel.schema.js';
import { PostChannelMessageRequest } from '../requests/PostChannelMessageRequest.js';

export class ChannelController extends Controller {
  async index(event: RequestEvent) {
    try {
      return this.json({ data: await channelService.listChannels(event.params.id) });
    } catch (error) {
      return this.failure(error, 'Could not load the channels.');
    }
  }

  async messages(event: RequestEvent) {
    try {
      const query = listChannelMessagesSchema.parse({
        before: event.url.searchParams.get('before') || null,
        beforeId: event.url.searchParams.get('beforeId') || null,
        limit: event.url.searchParams.get('limit') ?? undefined,
      });
      return this.json({ data: await channelService.listMessages(event.params.id, decodeURIComponent(event.params.channel), query) });
    } catch (error) {
      return this.failure(error, 'Could not load the conversation.');
    }
  }

  async store(event: RequestEvent) {
    try {
      const input = await PostChannelMessageRequest.validate(event);
      const result = await postChannelMessageAction.execute(new PostChannelMessageDto(event.params.id, decodeURIComponent(event.params.channel), input));
      return this.json({ data: result }, 201);
    } catch (error) {
      return this.failure(error, 'Could not send the message.');
    }
  }

  private failure(error: unknown, fallback: string) {
    return this.json({ error: error instanceof Error ? error.message : fallback }, 400);
  }
}
