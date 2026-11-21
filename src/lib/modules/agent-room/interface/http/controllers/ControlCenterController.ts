import { Controller } from '@beeblock/svelar/routing';
import { controlCenterService } from '$lib/modules/agent-room/application/services/ControlCenterService.js';
import { controlCenterQuerySchema } from '$lib/modules/agent-room/contracts/schemas/control-center.schema.js';

export class ControlCenterController extends Controller {
  async show(event: any) {
    try {
      const query = controlCenterQuerySchema.safeParse({
        communications: event.url?.searchParams.get('communications') ?? undefined,
        projection: event.url?.searchParams.get('projection') ?? undefined,
      });
      if (!query.success) return this.json({ error: 'INVALID_CONTROL_CENTER_QUERY' }, 400);
      return this.json({ data: await controlCenterService.snapshot(event.params.id, query.data.communications !== '0', query.data.projection) });
    } catch (error) {
      return this.json({ error: error instanceof Error ? error.message : 'Falha ao carregar a central de controle.' }, 500);
    }
  }

  async summaries() {
    try {
      return this.json({ data: await controlCenterService.summaries() });
    } catch (error) {
      return this.json({ error: error instanceof Error ? error.message : 'Falha ao carregar a atividade dos workspaces.' }, 500);
    }
  }
}
