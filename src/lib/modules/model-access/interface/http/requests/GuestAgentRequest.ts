import { FormRequest } from '@beeblock/svelar/forms';
import { guestAgentSchema, bridgeModelAccessSchema } from '../../../contracts/schemas/model-access.schema.js';
export class GuestAgentRequest extends FormRequest { rules() { return guestAgentSchema; } authorize() { return true; } }
export class BridgeModelAccessRequest extends FormRequest { rules() { return bridgeModelAccessSchema; } authorize() { return true; } }
