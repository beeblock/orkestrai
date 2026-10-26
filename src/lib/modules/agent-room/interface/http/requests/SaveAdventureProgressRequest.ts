import { FormRequest } from '@beeblock/svelar/forms';
import { saveAdventureProgressSchema, type SaveAdventureProgressInput } from '$lib/modules/agent-room/contracts/schemas/adventure.schema.js';

export class SaveAdventureProgressRequest extends FormRequest {
  rules() {
    return saveAdventureProgressSchema;
  }

  authorize(): boolean {
    return true;
  }

  passedValidation(data: unknown): SaveAdventureProgressInput {
    return saveAdventureProgressSchema.parse(data);
  }
}
