import { FormRequest } from '@beeblock/svelar/forms';
import { bridgeAskOwnerSchema, type BridgeAskOwnerInput } from '$lib/modules/agent-room/contracts/schemas/channel.schema.js';

export class BridgeAskOwnerRequest extends FormRequest {
  rules() {
    return bridgeAskOwnerSchema;
  }

  authorize(): boolean {
    return true;
  }

  passedValidation(data: unknown): BridgeAskOwnerInput {
    return bridgeAskOwnerSchema.parse(data);
  }
}
