import { Controller } from '@beeblock/svelar/routing';
import { z } from 'zod/v3';
import { mcpMarketService, type McpMarketEntry } from '$lib/modules/agent-room/application/services/McpMarketService.js';

const installSchema = z.object({
  entry: z.object({
    key: z.string().trim().min(1),
    title: z.string(),
    description: z.string(),
    source: z.enum(['curadoria', 'registry']),
    category: z.string(),
    official: z.boolean(),
    homepage: z.string().optional(),
    url: z.string().optional(),
    command: z.string().optional(),
    args: z.array(z.string()).optional(),
    envs: z.array(z.object({ key: z.string(), label: z.string(), help: z.string().optional(), required: z.boolean().optional() })).optional(),
  }),
  env: z.record(z.string(), z.string()).optional(),
});

/** Marketplace de MCPs (curadoria + registry oficial). */
export class McpMarketController extends Controller {
  async search(event: any) {
    try {
      const query = String(event.url.searchParams.get('q') ?? '');
      return this.json({ data: await mcpMarketService.search(query) });
    } catch (error) {
      return this.errorResponse(error, 'Falha na busca de MCPs.');
    }
  }

  async install(event: any) {
    try {
      const input = installSchema.parse(await event.request.json());
      return this.json({ data: await mcpMarketService.install(event.params.id, input.entry as McpMarketEntry, input.env ?? {}) }, 201);
    } catch (error) {
      return this.errorResponse(error, 'Falha ao instalar o MCP.');
    }
  }

  private errorResponse(error: unknown, fallback: string, status = 400) {
    return this.json({ error: error instanceof Error ? error.message : fallback }, status);
  }
}
