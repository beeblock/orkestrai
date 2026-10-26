import { Controller, type RequestEvent } from '@beeblock/svelar/routing';
import { adventureService } from '../../../application/services/AdventureService.js';
import type { HeroClassId } from '../../../domain/adventure/catalog.js';
import { SaveAdventureProgressRequest } from '../requests/SaveAdventureProgressRequest.js';
import { SetAdventureHeroClassRequest } from '../requests/SetAdventureHeroClassRequest.js';

export class AdventureController extends Controller {
  async show(event: RequestEvent) {
    try {
      return this.json({ data: await adventureService.read(event.params.id) });
    } catch (error) {
      return this.failure(error, 'Could not load the Adventure.');
    }
  }

  async save(event: RequestEvent) {
    try {
      const input = await SaveAdventureProgressRequest.validate(event);
      return this.json({ data: await adventureService.saveProgress(event.params.id, input) });
    } catch (error) {
      return this.failure(error, 'Could not save the Adventure.');
    }
  }

  async heroClass(event: RequestEvent) {
    try {
      const input = await SetAdventureHeroClassRequest.validate(event);
      return this.json({ data: await adventureService.setHeroClass(event.params.id, event.params.nodeId, input.classId as HeroClassId | null) });
    } catch (error) {
      return this.failure(error, 'Could not change the hero class.');
    }
  }

  private failure(error: unknown, fallback: string) {
    return this.json({ error: error instanceof Error ? error.message : fallback }, 400);
  }
}
