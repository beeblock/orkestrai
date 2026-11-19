import { FormRequest } from '@beeblock/svelar/forms';
import { personalBotCommandSchema } from '../../../contracts/schemas/personal-bot.schema.js';

export class PersonalBotCommandRequest extends FormRequest {
  rules() {
    return personalBotCommandSchema;
  }

  authorize(): boolean { return true; }
  passedValidation(data: unknown) { return personalBotCommandSchema.parse(data); }
}
