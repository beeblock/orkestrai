import { Controller } from '@beeblock/svelar/routing';
import { z } from 'zod/v3';
import { flowService } from '$lib/modules/agent-room/application/services/FlowService.js';

const runFlowSchema = z.object({
  nodeId: z.string().trim().min(1, 'Informe o no do fluxo.'),
  input: z.string().trim().default(''),
});

const flowNodeSchema = z.object({ nodeId: z.string().trim().min(1, 'Informe o no do fluxo.') });

/** Execucao de fluxos (nos 'flow' do canvas). */
export class FlowController extends Controller {
  async run(event: any) {
    try {
      const input = runFlowSchema.parse(await event.request.json());
      return this.json({ data: await flowService.run(event.params.id, input.nodeId, input.input) }, 202);
    } catch (error) {
      return this.errorResponse(error, 'Falha ao iniciar o fluxo.');
    }
  }

  async approve(event: any) {
    try {
      const input = flowNodeSchema.parse(await event.request.json());
      return this.json({ data: flowService.approve(event.params.id, input.nodeId) });
    } catch (error) {
      return this.errorResponse(error, 'Falha ao aprovar.');
    }
  }

  async stop(event: any) {
    try {
      const input = flowNodeSchema.parse(await event.request.json());
      return this.json({ data: flowService.stop(event.params.id, input.nodeId) });
    } catch (error) {
      return this.errorResponse(error, 'Falha ao parar o fluxo.');
    }
  }

  private errorResponse(error: unknown, fallback: string, status = 400) {
    return this.json({ error: error instanceof Error ? error.message : fallback }, status);
  }
}
