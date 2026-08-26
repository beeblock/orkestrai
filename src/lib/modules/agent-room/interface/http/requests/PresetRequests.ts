import { FormRequest } from '@beeblock/svelar/forms';
import {
  applyPresetSchema,
  type ApplyPresetInput,
} from '$lib/modules/agent-room/contracts/schemas/presetSchemas.js';

export class ApplyPresetRequest extends FormRequest {
  rules() {
    return applyPresetSchema;
  }

  authorize(): boolean {
    return true;
  }

  passedValidation(data: unknown): ApplyPresetInput {
    return applyPresetSchema.parse(data);
  }
}
