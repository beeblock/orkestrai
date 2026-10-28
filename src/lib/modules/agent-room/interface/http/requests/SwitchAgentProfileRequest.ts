import { FormRequest } from '@beeblock/svelar/forms';
import { bridgeProfileSwitchSchema, type BridgeProfileSwitchInput } from '$lib/modules/agent-room/contracts/schemas/bridgeSchemas.js';

export class SwitchAgentProfileRequest extends FormRequest {
  rules() { return bridgeProfileSwitchSchema; }
  authorize(): boolean { return true; }
  passedValidation(data: unknown): BridgeProfileSwitchInput { return bridgeProfileSwitchSchema.parse(data); }
}
