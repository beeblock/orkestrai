import { FormRequest } from '@beeblock/svelar/forms';
import { z } from '@beeblock/svelar/validation';
import {
  transferCanvasNodesSchema,
  type TransferCanvasNodesInput,
} from '$lib/modules/agent-room/contracts/schemas/transfer-canvas-nodes.schema.js';

export class TransferCanvasNodesRequest extends FormRequest {
  rules() {
    // Svelar merges route params into the input before validating strict bodies.
    return transferCanvasNodesSchema.extend({ id: z.string().uuid() })
      .transform(({ id: _id, ...input }) => input);
  }

  authorize(): boolean {
    return true;
  }

  passedValidation(data: unknown): TransferCanvasNodesInput {
    return transferCanvasNodesSchema.parse(data);
  }
}
