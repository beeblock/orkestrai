import { Controller, type RequestEvent } from '@beeblock/svelar/routing';
import { personalBotService } from '../../../application/services/PersonalBotService.js';
import { PersonalBotCommandDto } from '../../../application/dto/PersonalBotCommandDto.js';
import { PersonalBotCommandRequest } from '../requests/PersonalBotCommandRequest.js';
import { listAgentAdapters } from '../../../application/adapters/registry.js';
import { workspaceRepository } from '../../../infrastructure/repositories/WorkspaceRepository.js';
import { workspaceExecutionRuntime, withWorkspaceExecutionRuntime } from '../../../infrastructure/WslRuntime.js';

export class PersonalBotController extends Controller {
  async index(event: RequestEvent) {
    try {
      const providerId = event.url.searchParams.get('providerId');
      if (providerId) {
        const adapter = listAgentAdapters().find(item => item.id === providerId && item.createStructuredProcess);
        const workspace = await workspaceRepository.getWorkspace(event.params.id);
        if (!adapter || !workspace) return this.json({ error: 'BOT_PROVIDER_NOT_FOUND' }, 404);
        const runtime = workspaceExecutionRuntime(workspace);
        const [detection, models] = await Promise.all([
          withWorkspaceExecutionRuntime(runtime, () => adapter.detect()),
          withWorkspaceExecutionRuntime(runtime, () => adapter.listModels()),
        ]);
        return this.json({ data: { installed: detection.installed, models, efforts: adapter.efforts ?? [] } });
      }
      const groupId = event.url.searchParams.get('groupId');
      if (groupId) return this.json({ data: await personalBotService.messages(event.params.id, groupId) });
      const connectionId = event.url.searchParams.get('connectionId');
      if (connectionId) {
        if (!/^[0-9a-f-]{36}$/i.test(connectionId)) return this.json({ error: 'INVALID_CONNECTION_ID' }, 422);
        const { whatsappBotService } = await import('../../../application/services/WhatsAppBotService.js');
        return this.json({ data: await whatsappBotService.status(event.params.id, connectionId) });
      }
      if (event.url.searchParams.has('connections')) {
        const { whatsappBotService } = await import('../../../application/services/WhatsAppBotService.js');
        return this.json({ data: await whatsappBotService.list(event.params.id) });
      }
      return this.json({ data: { ...await personalBotService.list(event.params.id),
        providers: listAgentAdapters().filter(adapter => adapter.createStructuredProcess).map(adapter => ({ id: adapter.id, displayName: adapter.displayName, transportName: adapter.structuredTransportName })) } });
    } catch (error) { return this.failure(error); }
  }
  async command(event: RequestEvent) {
    try {
      const input = await PersonalBotCommandRequest.validate({ ...event, params: {} });
      return this.json({ data: await personalBotService.execute(PersonalBotCommandDto.from(event.params.id, input)) });
    } catch (error) { return this.failure(error); }
  }
  private failure(error: unknown) {
    const message = error instanceof Error ? error.message : 'PERSONAL_BOT_FAILED';
    return this.json({ error: message }, message.includes('NOT_FOUND') ? 404 : message.includes('CONFLICT') ? 409 : 422);
  }
}
