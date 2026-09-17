import { Controller } from '@beeblock/svelar/routing';
import { FormValidationError } from '@beeblock/svelar/forms';
import { CreativeBrandKitDto } from '../../../application/dto/CreativeBrandKitDto.js';
import { ExecuteCreativeBrandKitAction } from '../../../application/actions/ExecuteCreativeBrandKitAction.js';
import { CreativeMediaError } from '../../../domain/types.js';
import { CreativeBrandKitRequest } from '../requests/CreativeBrandKitRequest.js';
import { creativeBodyEvent } from '../requests/CreativeMediaRequest.js';
export class CreativeBrandKitController extends Controller {
  async command(event: any) {
    try {
      if (event.request.headers.has('authorization') || event.request.headers.has('x-orkestrai-agent-token') || (event.request.method !== 'GET' && event.request.headers.get('origin') !== event.url.origin)) throw new CreativeMediaError('creative_owner_required', 403);
      const input = event.request.method === 'GET' ? { command: event.url.searchParams.get('command') ?? 'list' } : await CreativeBrandKitRequest.validate(creativeBodyEvent(event));
      return this.json({ data: await new ExecuteCreativeBrandKitAction().execute(CreativeBrandKitDto.from(event.params.id, { type: 'user' }, input)) });
    } catch (error) {
      const validation = error instanceof FormValidationError || (error as Error)?.name === 'ZodError';
      return this.json({ error: error instanceof CreativeMediaError ? error.code : validation ? 'creative_invalid_input' : 'creative_request_failed' }, error instanceof CreativeMediaError ? error.status : validation ? 422 : 500);
    }
  }
}
