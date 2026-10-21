import { FormRequest } from '@beeblock/svelar/forms';
import { postChannelMessageSchema, type PostChannelMessageInput } from '$lib/modules/agent-room/contracts/schemas/channel.schema.js';

export class PostChannelMessageRequest extends FormRequest {
  rules() {
    return postChannelMessageSchema;
  }

  authorize(): boolean {
    return true;
  }

  passedValidation(data: unknown): PostChannelMessageInput {
    return postChannelMessageSchema.parse(data);
  }
}
