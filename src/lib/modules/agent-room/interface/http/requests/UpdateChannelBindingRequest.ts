import { FormRequest } from '@beeblock/svelar/forms';
import { updateChannelBindingSchema, type UpdateChannelBindingInput } from '$lib/modules/agent-room/contracts/schemas/channel.schema.js';

export class UpdateChannelBindingRequest extends FormRequest {
  rules() {
    return updateChannelBindingSchema;
  }

  authorize(): boolean {
    return true;
  }

  passedValidation(data: unknown): UpdateChannelBindingInput {
    return updateChannelBindingSchema.parse(data);
  }
}
