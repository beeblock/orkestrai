import { CreativeMediaError } from './types.js';
import { concreteSchema, type FalModelContract } from './model-contract.js';

export const SCENE_IMAGE_SIZES = { '16:9': [1920, 1080], '9:16': [1080, 1920], '1:1': [1080, 1080], '4:3': [1440, 1080], '3:4': [1080, 1440] } as const;
export function requestedAspectParameters(parameters: Record<string, unknown>, contract: FalModelContract, ratio: string) {
  const choices = Object.entries(contract.schema.properties ?? {}).filter(([key]) => ['aspect_ratio', 'aspectRatio'].includes(key));
  if (choices.length !== 1) throw new CreativeMediaError('creative_recipe_format_unsupported');
  const [key, raw] = choices[0], spec = concreteSchema(raw);
  if (spec.type !== 'string' || (spec.enum && !spec.enum.includes(ratio)) || (spec.const !== undefined && spec.const !== ratio)) throw new CreativeMediaError('creative_recipe_format_unsupported');
  return { ...parameters, [key]: ratio };
}
