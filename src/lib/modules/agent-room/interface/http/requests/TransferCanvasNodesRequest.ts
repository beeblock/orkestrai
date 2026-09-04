import { FormRequest } from '@beeblock/svelar/forms';
import {
  transferCanvasNodesSchema,
  type TransferCanvasNodesInput,
} from '$lib/modules/agent-room/contracts/schemas/transfer-canvas-nodes.schema.js';

export class TransferCanvasNodesRequest extends FormRequest {
  rules() {
    return transferCanvasNodesSchema;
  }

  authorize(): boolean {
    return true;
  }

  passedValidation(data: unknown): TransferCanvasNodesInput {
    return transferCanvasNodesSchema.parse(data);
  }
}
