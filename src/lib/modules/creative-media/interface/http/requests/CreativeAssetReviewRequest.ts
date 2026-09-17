import { FormRequest } from '@beeblock/svelar/forms';
import { creativeAssetCommandSchema } from '../../../contracts/schemas/creative-asset.schema.js';
export class CreativeAssetReviewRequest extends FormRequest { rules() { return creativeAssetCommandSchema; } }
