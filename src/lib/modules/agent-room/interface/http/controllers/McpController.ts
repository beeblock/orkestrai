import { Controller } from '@beeblock/svelar/routing';
import { z } from 'zod/v3';
import { mcpService } from '$lib/modules/agent-room/application/services/McpService.js';

const addMcpSchema = z.object({
  name: z.string().trim().min(1, 'Informe o nome.'),
  command: z.string().trim().min(1, 'Informe o comando.'),
  args: z.union([z.string(), z.array(z.string())]).optional(),
});

/** Servidores MCP do workspace (.mcp.json na raiz do projeto). */
export class McpController extends Controller {
  async list(event: any) {
    try {
      return this.json({ data: await mcpService.list(event.params.id) });
    } catch (error) {
      return this.errorResponse(error, 'Falha ao listar servidores MCP.');
    }
  }

  async add(event: any) {
    try {
      const input = addMcpSchema.parse(await event.request.json());
      return this.json({ data: await mcpService.add(event.params.id, input) }, 201);
    } catch (error) {
      return this.errorResponse(error, 'Falha ao adicionar servidor MCP.');
    }
  }

  async remove(event: any) {
    try {
      const name = String(event.url.searchParams.get('name') ?? '');
      if (!name) throw new Error('Informe ?name=');
      return this.json({ data: await mcpService.remove(event.params.id, name) });
    } catch (error) {
      return this.errorResponse(error, 'Falha ao remover servidor MCP.');
    }
  }

  private errorResponse(error: unknown, fallback: string, status = 400) {
    return this.json({ error: error instanceof Error ? error.message : fallback }, status);
  }
}
