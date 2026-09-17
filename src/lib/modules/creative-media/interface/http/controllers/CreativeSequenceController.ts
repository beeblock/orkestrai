import { Controller } from '@beeblock/svelar/routing';
import { FormValidationError } from '@beeblock/svelar/forms';
import { CreativeSequenceDto } from '../../../application/dto/CreativeSequenceDto.js';
import { ExecuteCreativeSequenceAction } from '../../../application/actions/ExecuteCreativeSequenceAction.js';
import { CreativeMediaError } from '../../../domain/types.js';
import { CreativeSequenceRequest } from '../requests/CreativeSequenceRequest.js';
import { creativeBodyEvent } from '../requests/CreativeMediaRequest.js';
export class CreativeSequenceController extends Controller {
  async command(event: any) {
    try {
      if (event.request.headers.has('authorization') || event.request.headers.has('x-orkestrai-agent-token') || (event.request.method !== 'GET' && event.request.headers.get('origin') !== event.url.origin)) throw new CreativeMediaError('creative_owner_required', 403);
      const nodeId = event.url.searchParams.get('nodeId');
      if (event.request.method === 'GET' && !['list', 'read', 'runtime'].includes(event.url.searchParams.get('command') ?? (nodeId ? 'read' : 'list'))) throw new CreativeMediaError('creative_invalid_input', 405);
      const input = event.request.method === 'GET' ? { command: event.url.searchParams.get('command') ?? (nodeId ? 'read' : 'list'), ...(nodeId ? { nodeId } : {}) } : await CreativeSequenceRequest.validate(creativeBodyEvent(event));
      return this.json({ data: await new ExecuteCreativeSequenceAction().execute(CreativeSequenceDto.from(event.params.id, { type: 'user' }, input)) });
    } catch (error) {
      const validation = error instanceof FormValidationError || (error as Error)?.name === 'ZodError';
      return this.json({ error: error instanceof CreativeMediaError ? error.code : validation ? 'creative_invalid_input' : 'creative_request_failed' }, error instanceof CreativeMediaError ? error.status : validation ? 422 : 500);
    }
  }
}
