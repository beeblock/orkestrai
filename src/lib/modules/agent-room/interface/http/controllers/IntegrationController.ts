import { Controller } from '@beeblock/svelar/routing';
import { z } from '@beeblock/svelar/validation';
import { ConnectIntegrationRequest } from '../requests/ConnectIntegrationRequest.js';
import { ExecuteIntegrationRequest } from '../requests/ExecuteIntegrationRequest.js';
import { automationIntegrationService } from '../../../application/services/AutomationIntegrationService.js';
import { integrationExecutionService } from '../../../application/services/IntegrationExecutionService.js';
import { executeIntegrationAction } from '../../../application/actions/ExecuteIntegrationAction.js';
import { integrationEventsQuerySchema } from '../../../contracts/schemas/integration.schema.js';

export class IntegrationController extends Controller {
  async index(event: any) {
    return this.json({ data: {
      integrations: await automationIntegrationService.list(event.params.id),
      catalog: automationIntegrationService.catalog(),
    } });
  }

  async store(event: any) {
    try {
      const dto = await ConnectIntegrationRequest.validate(event);
      return this.json({ data: await automationIntegrationService.connect(event.params.id, dto.input) }, 201);
    } catch (error) {
      return this.errorResponse(error);
    }
  }

  async check(event: any) {
    try {
      return this.json({ data: await automationIntegrationService.check(event.params.id, event.params.integrationId) });
    } catch (error) {
      return this.errorResponse(error);
    }
  }

  async update(event: any) {
    try {
      const input = z.object({ enabled: z.boolean() }).strict().parse(await event.request.json());
      return this.json({ data: await automationIntegrationService.setEnabled(event.params.id, event.params.integrationId, input.enabled) });
    } catch (error) {
      return this.errorResponse(error);
    }
  }

  async destroy(event: any) {
    return this.json({ data: { deleted: await automationIntegrationService.remove(event.params.id, event.params.integrationId) } });
  }

  async execute(event: any) {
    try {
      const dto = await ExecuteIntegrationRequest.validate(event);
      return this.json({ data: await executeIntegrationAction.execute({
        workspaceId: event.params.id,
        dto,
        context: { actorType: 'user', actorId: 'workspace-owner' },
      }) });
    } catch (error) {
      return this.errorResponse(error);
    }
  }

  async events(event: any) {
    try {
      const query = integrationEventsQuerySchema.parse(Object.fromEntries(event.url.searchParams));
      return this.json({ data: await integrationExecutionService.listEvents(event.params.id, query.limit, query.integrationId) });
    } catch (error) {
      return this.errorResponse(error);
    }
  }

  private errorResponse(error: unknown) {
    return this.json({ error: error instanceof Error ? error.message : 'Integration request failed.' }, 400);
  }
}
