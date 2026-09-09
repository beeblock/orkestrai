import { Controller, type RequestEvent } from '@beeblock/svelar/routing';
import { coreRuntimeService } from '../../../application/services/CoreRuntimeService.js';

export class CoreRuntimeController extends Controller {
  async health(event: RequestEvent) {
    const token = event.request.headers.get('x-orkestrai-core-token');
    if (!coreRuntimeService.authorized(token)) {
      return this.json({ error: 'Unauthorized Core health request.' }, 401);
    }
    return this.json({ data: coreRuntimeService.status() });
  }
}
