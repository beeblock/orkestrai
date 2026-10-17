import { Controller, type RequestEvent } from '@beeblock/svelar/routing';
import { channelBindingService } from '../../../application/services/ChannelBindingService.js';
import { CreateChannelBindingRequest } from '../requests/CreateChannelBindingRequest.js';
import { UpdateChannelBindingRequest } from '../requests/UpdateChannelBindingRequest.js';

export class ChannelBindingController extends Controller {
  async index(event: RequestEvent) {
    try {
      return this.json({ data: await channelBindingService.list(event.params.id, event.url.searchParams.get('nodeId') ?? undefined) });
    } catch (error) {
      return this.failure(error, 'Could not load the channel connections.');
    }
  }

  async store(event: RequestEvent) {
    try {
      const input = await CreateChannelBindingRequest.validate(event);
      return this.json({ data: await channelBindingService.create(event.params.id, input) }, 201);
    } catch (error) {
      return this.failure(error, 'Could not connect the agent to the chat.');
    }
  }

  async update(event: RequestEvent) {
    try {
      const input = await UpdateChannelBindingRequest.validate(event);
      return this.json({ data: await channelBindingService.setEnabled(event.params.id, event.params.bindingId, input.enabled) });
    } catch (error) {
      return this.failure(error, 'Could not update the channel connection.');
    }
  }

  async destroy(event: RequestEvent) {
    try {
      return this.json({ data: { removed: await channelBindingService.remove(event.params.id, event.params.bindingId) } });
    } catch (error) {
      return this.failure(error, 'Could not remove the channel connection.');
    }
  }

  private failure(error: unknown, fallback: string) {
    return this.json({ error: error instanceof Error ? error.message : fallback }, 400);
  }
}
