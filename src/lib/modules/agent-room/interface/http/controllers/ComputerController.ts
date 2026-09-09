import { Controller, type RequestEvent } from '@beeblock/svelar/routing';
import { readFile } from 'node:fs/promises';
import { computerNodeConfigSchema } from '../../../contracts/schemas/computer.schema.js';
import { computerService } from '../../../application/services/ComputerService.js';
import { ExecuteComputerCommandAction } from '../../../application/actions/ExecuteComputerCommandAction.js';
import { ComputerCommandRequest } from '../requests/ComputerCommandRequest.js';

export class ComputerController extends Controller {
  async index(event: RequestEvent) {
    try {
      return this.json({ data: await computerService.snapshot(event.params.id) });
    } catch (error) {
      return this.failure(error, 'Could not inspect this computer.');
    }
  }

  async configure(event: RequestEvent) {
    try {
      const config = computerNodeConfigSchema.parse(await event.request.json());
      return this.json({ data: await computerService.configure(event.params.id, event.params.nodeId, config) });
    } catch (error) {
      return this.failure(error, 'Could not update desktop control.');
    }
  }

  async command(event: RequestEvent) {
    try {
      const dto = await ComputerCommandRequest.validate(event);
      return this.json({ data: await new ExecuteComputerCommandAction().execute({
        workspaceId: event.params.id,
        dto,
        context: { actorType: 'user', actorId: 'workspace-owner' },
      }) });
    } catch (error) {
      return this.failure(error, 'Could not execute the computer command.');
    }
  }

  async evidence(event: RequestEvent) {
    try {
      const path = await computerService.evidence(event.params.id, event.params.evidenceId);
      return new Response(await readFile(path), { headers: { 'content-type': 'image/png', 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' } });
    } catch {
      return new Response('Computer evidence not found.', { status: 404 });
    }
  }

  private failure(error: unknown, fallback: string) {
    return this.json({ error: error instanceof Error ? error.message : fallback }, 400);
  }
}
