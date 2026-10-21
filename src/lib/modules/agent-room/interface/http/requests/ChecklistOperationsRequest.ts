import { FormRequest } from '@beeblock/svelar/forms';
import { checklistOperationsSchema, type ChecklistOperationsInput } from '$lib/modules/agent-room/contracts/schemas/planNodeSchemas.js';

export class ChecklistOperationsRequest extends FormRequest {
  rules() {
    return checklistOperationsSchema;
  }

  authorize(): boolean {
    return true;
  }

  passedValidation(data: unknown): ChecklistOperationsInput {
    return checklistOperationsSchema.parse(data);
  }
}
