import { FormRequest } from '@beeblock/svelar/forms';
import { creativeBrandCommandSchema } from '../../../contracts/schemas/creative-brand.schema.js';
export class CreativeBrandKitRequest extends FormRequest { rules() { return creativeBrandCommandSchema; } }
