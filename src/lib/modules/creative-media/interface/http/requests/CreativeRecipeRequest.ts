import { FormRequest } from '@beeblock/svelar/forms';
import { creativeRecipeCommandSchema } from '../../../contracts/schemas/creative-recipe.schema.js';
export class CreativeRecipeRequest extends FormRequest { rules() { return creativeRecipeCommandSchema; } }
