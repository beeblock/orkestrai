import { FormRequest } from '@beeblock/svelar/forms';
import { decideAttentionSchema, type DecideAttentionInput } from '$lib/modules/agent-room/contracts/schemas/attention.schema.js';

export class DecideAttentionRequest extends FormRequest {
  rules() {
    return decideAttentionSchema;
  }

  authorize(): boolean {
    return true;
  }

  passedValidation(data: unknown): DecideAttentionInput {
    return decideAttentionSchema.parse(data);
  }
}
