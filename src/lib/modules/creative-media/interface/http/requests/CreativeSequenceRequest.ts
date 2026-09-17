import { FormRequest } from '@beeblock/svelar/forms';
import { creativeSequenceCommandSchema } from '../../../contracts/schemas/creative-sequence.schema.js';
export class CreativeSequenceRequest extends FormRequest { rules() { return creativeSequenceCommandSchema; } }
