import { FormRequest } from '@beeblock/svelar/forms';
import { bridgeMessageResultSchema } from '../../../contracts/schemas/bridgeSchemas.js';
export class ReadBridgeMessageRequest extends FormRequest {
  rules() { return bridgeMessageResultSchema; }
  authorize() { return true; }
  passedValidation(data: unknown) { return bridgeMessageResultSchema.parse(data); }
}
