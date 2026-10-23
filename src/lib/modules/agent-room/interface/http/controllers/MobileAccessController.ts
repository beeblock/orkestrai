import { Controller, type RequestEvent } from '@beeblock/svelar/routing';
import { z } from 'zod/v3';
import { mobileAccessService } from '../../../application/services/MobileAccessService.js';

const pairSchema = z.object({ port: z.number().int().min(1024).max(65535).optional() }).strict();

export class MobileAccessController extends Controller {
  async show() {
    return this.json({ data: await mobileAccessService.status() });
  }

  async pair(event: RequestEvent) {
    try {
      const input = pairSchema.parse(await event.request.json().catch(() => ({})));
      return this.json({ data: await mobileAccessService.pair(input.port) });
    } catch (error) {
      return this.json({ error: error instanceof Error ? error.message : 'Could not turn on phone access.' }, 400);
    }
  }

  async destroy() {
    return this.json({ data: await mobileAccessService.disable() });
  }

  async session() {
    return this.json({ data: await mobileAccessService.session() });
  }
}
