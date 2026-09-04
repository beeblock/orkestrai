import { Action } from '@beeblock/svelar/actions';
import type { TransferCanvasNodesDto } from '../dto/TransferCanvasNodesDto.js';
import { canvasNodeTransferService } from '../services/CanvasNodeTransferService.js';
import type { CanvasNodeTransferResult } from '../../domain/types.js';

export class TransferCanvasNodesAction extends Action<TransferCanvasNodesDto, CanvasNodeTransferResult> {
  async execute(input: TransferCanvasNodesDto): Promise<CanvasNodeTransferResult> {
    return canvasNodeTransferService.transfer(input);
  }
}
