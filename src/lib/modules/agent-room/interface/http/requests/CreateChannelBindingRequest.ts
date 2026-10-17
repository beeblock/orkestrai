import { FormRequest } from '@beeblock/svelar/forms';
import { createChannelBindingSchema, type CreateChannelBindingInput } from '$lib/modules/agent-room/contracts/schemas/channel.schema.js';

export class CreateChannelBindingRequest extends FormRequest {
  rules() {
    return createChannelBindingSchema;
  }

  authorize(): boolean {
    return true;
  }

  passedValidation(data: unknown): CreateChannelBindingInput {
    return createChannelBindingSchema.parse(data);
  }
}
