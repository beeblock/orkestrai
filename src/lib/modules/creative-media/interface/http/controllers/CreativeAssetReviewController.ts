import { Controller } from '@beeblock/svelar/routing';
import { FormValidationError } from '@beeblock/svelar/forms';
import { CreativeAssetReviewDto } from '../../../application/dto/CreativeAssetReviewDto.js';
import { ExecuteCreativeAssetReviewAction } from '../../../application/actions/ExecuteCreativeAssetReviewAction.js';
import { CreativeMediaError } from '../../../domain/types.js';
import { CreativeAssetReviewRequest } from '../requests/CreativeAssetReviewRequest.js';
import { creativeBodyEvent } from '../requests/CreativeMediaRequest.js';
export class CreativeAssetReviewController extends Controller {
  async command(event: any) {
    try {
      if (event.request.headers.has('authorization') || event.request.headers.has('x-orkestrai-agent-token') || (event.request.method !== 'GET' && event.request.headers.get('origin') !== event.url.origin)) throw new CreativeMediaError('creative_owner_required', 403);
      const input = event.request.method === 'GET' ? { command: event.url.searchParams.has('nodeId') ? 'inspect' : 'list', ...(event.url.searchParams.has('nodeId') ? { nodeId: event.url.searchParams.get('nodeId') } : {}) } : await CreativeAssetReviewRequest.validate(creativeBodyEvent(event));
      return this.json({ data: await new ExecuteCreativeAssetReviewAction().execute(CreativeAssetReviewDto.from(event.params.id, { type: 'user' }, input)) });
    } catch (error) {
      const validation = error instanceof FormValidationError || (error as Error)?.name === 'ZodError';
      return this.json({ error: error instanceof CreativeMediaError ? error.code : validation ? 'creative_invalid_input' : 'creative_request_failed' }, error instanceof CreativeMediaError ? error.status : validation ? 422 : 500);
    }
  }
}
