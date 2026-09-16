import { Controller } from '@beeblock/svelar/routing';
import { FormValidationError } from '@beeblock/svelar/forms';
import { TransferCanvasNodesAction } from '../../../application/actions/TransferCanvasNodesAction.js';
import { TransferCanvasNodesDto } from '../../../application/dto/TransferCanvasNodesDto.js';
import { CanvasNodeTransferError } from '../../../application/services/CanvasNodeTransferService.js';
import { TransferCanvasNodesRequest } from '../requests/TransferCanvasNodesRequest.js';
import { CanvasNodeTransferResource } from '../resources/CanvasNodeTransferResource.js';

export class CanvasNodeTransferController extends Controller {
  async store(event: any) {
    try {
      const input = await TransferCanvasNodesRequest.validate(event);
      const result = await new TransferCanvasNodesAction().execute(TransferCanvasNodesDto.from(event.params.id, input));
      return this.json({ data: new CanvasNodeTransferResource(result).toJSON() }, 201);
    } catch (error) {
      if (error instanceof FormValidationError) return this.json({ error: 'canvas_transfer_invalid_request' }, 422);
      return this.json({ error: error instanceof CanvasNodeTransferError ? error.code : 'canvas_transfer_failed' }, 400);
    }
  }
}
