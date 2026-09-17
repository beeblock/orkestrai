import { Controller } from '@beeblock/svelar/routing';
import { FormValidationError } from '@beeblock/svelar/forms';
import { CreativeCharacterDto } from '../../../application/dto/CreativeCharacterDto.js';
import { ExecuteCreativeCharacterAction } from '../../../application/actions/ExecuteCreativeCharacterAction.js';
import { CreativeMediaError } from '../../../domain/types.js';
import { CreativeCharacterRequest } from '../requests/CreativeCharacterRequest.js';
import { creativeBodyEvent } from '../requests/CreativeMediaRequest.js';

export class CreativeCharacterController extends Controller {
  private async respond(event: any, read: boolean) {
    try {
      if (event.request.headers.has('authorization') || event.request.headers.has('x-orkestrai-agent-token') || (!read && event.request.headers.get('origin') !== event.url.origin)) throw new CreativeMediaError('creative_owner_required', 403);
      const input = read ? { command: 'list' } : await CreativeCharacterRequest.validate(creativeBodyEvent(event));
      const data = await new ExecuteCreativeCharacterAction().execute(CreativeCharacterDto.from(event.params.id, { type: 'user' }, input));
      return this.json({ data });
    } catch (error) {
      const validation = error instanceof FormValidationError || (error as Error)?.name === 'ZodError';
      return this.json({ error: error instanceof CreativeMediaError ? error.code : validation ? 'creative_invalid_input' : 'creative_request_failed' }, error instanceof CreativeMediaError ? error.status : validation ? 422 : 500);
    }
  }
  index(event: any) { return this.respond(event, true); }
  command(event: any) { return this.respond(event, false); }
}
