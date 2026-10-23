import { z } from 'zod/v3';
import { tokenAnalyticsService } from '$lib/modules/agent-room/application/services/TokenAnalyticsService.js';
import { Controller, type RequestEvent } from '@beeblock/svelar/routing';
import { usageService } from '$lib/modules/agent-room/application/services/UsageService.js';

/** Uso/cota dos providers (5h, semanal, mensal + reset), lido das APIs deles. */
const tokenQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(90).default(30),
  workspaceId: z.string().uuid().nullish(),
});

export class UsageController extends Controller {
  /** Tokens by day and by agent from the CLIs' local session logs. */
  async getTokens(event: RequestEvent) {
    try {
      const query = tokenQuerySchema.parse({
        days: event.url.searchParams.get('days') ?? undefined,
        workspaceId: event.url.searchParams.get('workspaceId') || null,
      });
      return this.json({ data: await tokenAnalyticsService.analytics(query) });
    } catch (error) {
      return this.errorResponse(error, 'token_analytics_failed');
    }
  }

  async getUsage(event: RequestEvent) {
    try {
      const forceRefresh = event.url.searchParams.get('refresh') === '1';
      const usage = await usageService.getAll(forceRefresh);
      return this.json({ data: usage });
    } catch (error) {
      return this.errorResponse(error, 'usage_fetch_failed');
    }
  }
}
