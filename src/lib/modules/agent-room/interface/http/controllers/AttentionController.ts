import { DecideAttentionRequest } from '../requests/DecideAttentionRequest.js';
import { DecideAttentionDto } from '../../../application/dto/DecideAttentionDto.js';
import { decideAttentionAction } from '../../../application/actions/DecideAttentionAction.js';
import { Controller, type RequestEvent } from '@beeblock/svelar/routing';
import { attentionService } from '$lib/modules/agent-room/application/services/AttentionService.js';
import { UpdateAttentionDto } from '$lib/modules/agent-room/application/dto/UpdateAttentionDto.js';
import { updateAttentionAction } from '$lib/modules/agent-room/application/actions/UpdateAttentionAction.js';
import { ListAttentionRequest } from '../requests/ListAttentionRequest.js';
import { UpdateAttentionRequest } from '../requests/UpdateAttentionRequest.js';

export class AttentionController extends Controller {
  async index(event: RequestEvent) {
    try {
      const input = await ListAttentionRequest.validate(event);
      return this.json({ data: await attentionService.list(input) });
    } catch (error) {
      return this.failure(error, 'Could not load attention items.');
    }
  }

  async update(event: RequestEvent) {
    try {
      const input = await UpdateAttentionRequest.validate(event);
      return this.json({ data: await updateAttentionAction.execute(UpdateAttentionDto.from(event.params.id, input)) });
    } catch (error) {
      return this.failure(error, 'Could not update the attention item.');
    }
  }

  async decide(event: RequestEvent) {
    try {
      const input = await DecideAttentionRequest.validate(event);
      return this.json({ data: await decideAttentionAction.execute(DecideAttentionDto.from(event.params.id, input)) });
    } catch (error) {
      return this.failure(error, 'Could not decide the attention item.');
    }
  }

  private failure(error: unknown, fallback: string) {
    return this.json({ error: error instanceof Error ? error.message : fallback }, 400);
  }
}
