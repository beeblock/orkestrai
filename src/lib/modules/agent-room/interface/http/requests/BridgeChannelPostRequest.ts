import { FormRequest } from '@beeblock/svelar/forms';
import { bridgeChannelPostSchema, type BridgeChannelPostInput } from '$lib/modules/agent-room/contracts/schemas/channel.schema.js';

export class BridgeChannelPostRequest extends FormRequest {
  rules() {
    return bridgeChannelPostSchema;
  }

  authorize(): boolean {
    return true;
  }

  passedValidation(data: unknown): BridgeChannelPostInput {
    return bridgeChannelPostSchema.parse(data);
  }
}
