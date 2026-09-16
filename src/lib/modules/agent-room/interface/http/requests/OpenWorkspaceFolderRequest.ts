import { FormRequest } from '@beeblock/svelar/forms';
import { openWorkspaceFolderSchema } from '$lib/modules/agent-room/contracts/schemas/fsSchemas.js';

export class OpenWorkspaceFolderRequest extends FormRequest {
  rules() {
    return openWorkspaceFolderSchema;
  }

  authorize(): boolean {
    return true;
  }

  passedValidation(data: unknown) {
    return openWorkspaceFolderSchema.parse(data);
  }
}
