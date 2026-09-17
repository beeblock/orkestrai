import { Controller } from '@beeblock/svelar/routing';
import { FormValidationError } from '@beeblock/svelar/forms';
import { CreativeStoryboardDto } from '../../../application/dto/CreativeStoryboardDto.js';
import { ExecuteCreativeStoryboardAction } from '../../../application/actions/ExecuteCreativeStoryboardAction.js';
import { CreativeMediaError } from '../../../domain/types.js';
import { CreativeStoryboardRequest } from '../requests/CreativeStoryboardRequest.js';
import { creativeBodyEvent } from '../requests/CreativeMediaRequest.js';
export class CreativeStoryboardController extends Controller {
  async command(event: any) {
    try {
      if (event.request.headers.has('authorization') || event.request.headers.has('x-orkestrai-agent-token') || (event.request.method !== 'GET' && event.request.headers.get('origin') !== event.url.origin)) throw new CreativeMediaError('creative_owner_required', 403);
      const input = event.request.method === 'GET' ? { command: event.url.searchParams.has('nodeId') ? 'read' : 'list', ...(event.url.searchParams.has('nodeId') ? { nodeId: event.url.searchParams.get('nodeId') } : {}) } : await CreativeStoryboardRequest.validate(creativeBodyEvent(event));
      return this.json({ data: await new ExecuteCreativeStoryboardAction().execute(CreativeStoryboardDto.from(event.params.id, { type: 'user' }, input)) });
    } catch (error) {
      const validation = error instanceof FormValidationError || (error as Error)?.name === 'ZodError';
      return this.json({ error: error instanceof CreativeMediaError ? error.code : validation ? 'creative_invalid_input' : 'creative_request_failed' }, error instanceof CreativeMediaError ? error.status : validation ? 422 : 500);
    }
  }
}
