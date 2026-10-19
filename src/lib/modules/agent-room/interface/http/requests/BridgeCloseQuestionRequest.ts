import { FormRequest } from '@beeblock/svelar/forms';
import { bridgeCloseQuestionSchema, type BridgeCloseQuestionInput } from '$lib/modules/agent-room/contracts/schemas/channel.schema.js';

export class BridgeCloseQuestionRequest extends FormRequest {
  rules() {
    return bridgeCloseQuestionSchema;
  }

  authorize(): boolean {
    return true;
  }

  passedValidation(data: unknown): BridgeCloseQuestionInput {
    return bridgeCloseQuestionSchema.parse(data);
  }
}
