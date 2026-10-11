import type { BridgeCanvasCommandInput } from '../../contracts/schemas/bridge-canvas.schema.js';

export class BridgeCanvasCommandDto {
  constructor(public readonly request: BridgeCanvasCommandInput) {}
}
