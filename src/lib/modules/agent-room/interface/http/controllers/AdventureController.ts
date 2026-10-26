import { Controller, type RequestEvent } from '@beeblock/svelar/routing';
import { adventureService } from '../../../application/services/AdventureService.js';
import { AdventureError } from '../../../domain/adventure/engine.js';
import { AdventureActionRequest } from '../requests/AdventureActionRequest.js';
import { ReportAdventureRequest } from '../requests/ReportAdventureRequest.js';

export class AdventureController extends Controller {
  async show(event: RequestEvent) {
    try {
      return this.json({ data: await adventureService.state(event.params.id) });
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

  /** Rule refusals carry a stable code the screens translate. */
  private failure(error: unknown, fallback: string) {
    if (error instanceof AdventureError) return this.json({ error: error.code, code: error.code }, 400);
    return this.json({ error: error instanceof Error ? error.message : fallback }, 400);
  }
}
