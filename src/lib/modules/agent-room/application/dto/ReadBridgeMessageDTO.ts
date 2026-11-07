import type { BridgeMessageResultInput } from '../../contracts/schemas/bridgeSchemas.js';
export class ReadBridgeMessageDTO {
  constructor(readonly workspaceId: string, readonly actorId: string | null,
    readonly input: BridgeMessageResultInput, readonly signal?: AbortSignal) {}
}
