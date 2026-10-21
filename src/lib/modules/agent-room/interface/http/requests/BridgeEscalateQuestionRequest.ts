import { FormRequest } from '@beeblock/svelar/forms';
import { bridgeEscalateQuestionSchema, type BridgeEscalateQuestionInput } from '$lib/modules/agent-room/contracts/schemas/channel.schema.js';

export class BridgeEscalateQuestionRequest extends FormRequest {
  rules() {
    return bridgeEscalateQuestionSchema;
  }

  authorize(): boolean {
    return true;
  }

  passedValidation(data: unknown): BridgeEscalateQuestionInput {
    return bridgeEscalateQuestionSchema.parse(data);
  }
}
