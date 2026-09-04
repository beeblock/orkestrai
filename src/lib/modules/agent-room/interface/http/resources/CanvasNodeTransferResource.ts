import type { CanvasNodeTransferResult } from '../../../domain/types.js';

export class CanvasNodeTransferResource {
  constructor(private readonly transfer: CanvasNodeTransferResult) {}

  toJSON(): CanvasNodeTransferResult {
    return this.transfer;
  }
}
