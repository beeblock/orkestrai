import { FormRequest } from '@beeblock/svelar/forms';
import { adventureActionSchema, type AdventureAction } from '$lib/modules/agent-room/contracts/schemas/adventure.schema.js';

export class AdventureActionRequest extends FormRequest {
  rules() {
    return adventureActionSchema;
  }

  authorize(): boolean {
    return true;
  }

  passedValidation(data: unknown): AdventureAction {
    return adventureActionSchema.parse(data);
  }
}
