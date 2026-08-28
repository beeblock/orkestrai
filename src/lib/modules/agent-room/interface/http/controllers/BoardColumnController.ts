import { Controller } from '@beeblock/svelar/routing';
import { FormRequest } from '@beeblock/svelar/forms';
import { boardColumnService } from '$lib/modules/agent-room/application/services/BoardColumnService.js';
import { createBoardColumnSchema, updateBoardColumnSchema } from '$lib/modules/agent-room/contracts/schemas/taskSchemas.js';

function requestOf(schema: unknown) {
  return class extends FormRequest {
    rules() { return schema; }
    authorize() { return true; }
  };
}

export class BoardColumnController extends Controller {
  async index(event: any) {
    try {
      return this.json({ data: await boardColumnService.list(event.params.id) });
    } catch (error) {
      return this.errorResponse(error, 'Falha ao listar colunas.');
    }
  }

  async store(event: any) {
    try {
      const input = await (requestOf(createBoardColumnSchema)).validate(event);
      return this.json({ data: await boardColumnService.create(event.params.id, input) }, 201);
    } catch (error) {
      return this.errorResponse(error, 'Falha ao criar coluna.');
    }
  }

  async update(event: any) {
    try {
      const input = await (requestOf(updateBoardColumnSchema)).validate(event);
      return this.json({ data: await boardColumnService.update(event.params.id, event.params.columnId, input) });
    } catch (error) {
      return this.errorResponse(error, 'Falha ao atualizar coluna.');
    }
  }

  async destroy(event: any) {
    try {
      return this.json({ data: await boardColumnService.remove(event.params.id, event.params.columnId) });
    } catch (error) {
      return this.errorResponse(error, 'Falha ao remover coluna.');
    }
  }

  private errorResponse(error: unknown, fallback: string, status = 400) {
    const message = error instanceof Error ? error.message : fallback;
    return this.json({ error: message }, message === 'WORKSPACE_NOT_FOUND' ? 404 : status);
  }
}
