import { FormRequest } from '@beeblock/svelar/forms';
import { creativeCharacterCommandSchema } from '../../../contracts/schemas/creative-character.schema.js';
export class CreativeCharacterRequest extends FormRequest { rules() { return creativeCharacterCommandSchema; } }
