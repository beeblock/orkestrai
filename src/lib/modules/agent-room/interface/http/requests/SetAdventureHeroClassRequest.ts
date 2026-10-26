import { FormRequest } from '@beeblock/svelar/forms';
import { setAdventureHeroClassSchema, type SetAdventureHeroClassInput } from '$lib/modules/agent-room/contracts/schemas/adventure.schema.js';

export class SetAdventureHeroClassRequest extends FormRequest {
  rules() {
    return setAdventureHeroClassSchema;
  }

  authorize(): boolean {
    return true;
  }

  passedValidation(data: unknown): SetAdventureHeroClassInput {
    return setAdventureHeroClassSchema.parse(data);
  }
}
