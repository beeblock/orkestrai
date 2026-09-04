import type { TransferCanvasNodesInput } from '../../contracts/schemas/transfer-canvas-nodes.schema.js';

export class TransferCanvasNodesDto {
  constructor(
    public readonly sourceWorkspaceId: string,
    public readonly destinationWorkspaceId: string,
    public readonly nodeIds: string[],
    public readonly mode: 'copy' | 'move',
  ) {}

  static from(sourceWorkspaceId: string, input: TransferCanvasNodesInput): TransferCanvasNodesDto {
    return new TransferCanvasNodesDto(
      sourceWorkspaceId,
      input.destinationWorkspaceId,
      input.nodeIds,
      input.mode,
    );
  }
}
