import { FormRequest } from '@beeblock/svelar/forms';
import { bridgeCanvasCommandSchema } from '../../../contracts/schemas/bridge-canvas.schema.js';
import { BridgeCanvasCommandDto } from '../../../application/dto/BridgeCanvasCommandDto.js';

export class BridgeCanvasCommandRequest extends FormRequest {
  rules() {
    return bridgeCanvasCommandSchema;
  }

  authorize(): boolean {
    return true;
  }

  passedValidation(data: unknown) {
    return new BridgeCanvasCommandDto(bridgeCanvasCommandSchema.parse(data));
  }
}
