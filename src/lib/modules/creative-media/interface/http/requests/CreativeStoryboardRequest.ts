import { FormRequest } from '@beeblock/svelar/forms';
import { creativeStoryboardCommandSchema } from '../../../contracts/schemas/creative-storyboard.schema.js';

export class CreativeStoryboardRequest extends FormRequest {
  rules() {
    return creativeStoryboardCommandSchema;
  }
}
