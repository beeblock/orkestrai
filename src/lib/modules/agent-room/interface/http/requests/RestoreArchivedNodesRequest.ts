import { FormRequest } from '@beeblock/svelar/forms';
import { restoreArchivedNodesSchema, type RestoreArchivedNodesInput } from '$lib/modules/agent-room/contracts/schemas/canvas-tidy.schema.js';

export class RestoreArchivedNodesRequest extends FormRequest {
  rules() {
    return restoreArchivedNodesSchema;
  }

  authorize(): boolean {
    return true;
  }

  passedValidation(data: unknown): RestoreArchivedNodesInput {
    return restoreArchivedNodesSchema.parse(data);
  }
}
