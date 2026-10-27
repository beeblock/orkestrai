import { FormAuthorizationError, FormValidationError } from '@beeblock/svelar/forms';
import { Controller, type RequestEvent } from '@beeblock/svelar/routing';
import { adventureService } from '../../../application/services/AdventureService.js';
import { AdventureError } from '../../../domain/adventure/engine.js';
import { AdventureActionRequest } from '../requests/AdventureActionRequest.js';
import { ReportAdventureRequest } from '../requests/ReportAdventureRequest.js';

export class AdventureController extends Controller {
  async show(event: RequestEvent) {
    try {
      // A screen still sending battle it fought while the server was away asks not to be paid offline for it.
      const offline = event.url.searchParams.get('offline') !== '0';
      return this.json({ data: await adventureService.state(event.params.id, { offline }) });
    } catch (error) {
      return this.failure(error, 'Could not load the Adventure.');
    }
  }

  async report(event: RequestEvent) {
    try {
      const input = await ReportAdventureRequest.validate(event);
      return this.json({ data: await adventureService.report(event.params.id, input) });
    } catch (error) {
      return this.failure(error, 'Could not record the battle.');
    }
  }

  async act(event: RequestEvent) {
    try {
      const input = await AdventureActionRequest.validate(event);
      return this.json({ data: await adventureService.act(event.params.id, input) });
    } catch (error) {
      return this.failure(error, 'Could not complete the action.');
    }
  }

  /**
   * Rule refusals carry a stable code the screens translate. Refusals are
   * final (4xx); anything else (a busy database, say) is a 500 the screens
   * try again.
   */
  private failure(error: unknown, fallback: string) {
    if (error instanceof AdventureError) return this.json({ error: error.code, code: error.code }, error.code === 'workspace' ? 404 : 400);
    if (error instanceof FormValidationError || error instanceof FormAuthorizationError || error instanceof SyntaxError) return this.json({ error: 'invalid', code: 'invalid' }, 400);
    return this.json({ error: error instanceof Error ? error.message : fallback }, 500);
  }
}
