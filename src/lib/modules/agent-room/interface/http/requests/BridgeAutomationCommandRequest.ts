import { FormRequest } from '@beeblock/svelar/forms';
import { bridgeAutomationCommandSchema } from '../../../contracts/schemas/bridge-automation.schema.js';
import { BridgeAutomationCommandDto } from '../../../application/dto/BridgeAutomationCommandDto.js';

export class BridgeAutomationCommandRequest extends FormRequest {
  rules() {
    return bridgeAutomationCommandSchema;
  }

  authorize(): boolean {
    return true;
  }

  passedValidation(data: unknown) {
    return new BridgeAutomationCommandDto(bridgeAutomationCommandSchema.parse(data));
  }
}
