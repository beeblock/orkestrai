import type { CreativeConfig } from '../contracts/schemas/creative-media.schema.js';
import type { CreativeCharacter } from './character.js';
import { modelMediaSlots, modelVoiceIdSlots, type FalModelContract } from './model-contract.js';

type Binding = CreativeConfig['characterBindings'][number];
type Result = { binding: Binding; error?: never } | { binding?: never; error: 'unapproved' | 'account' | 'model' | 'capacity' };

export function characterAlias(character: CreativeCharacter, existing: Binding[]): string {
  const current = existing.find(binding => binding.id === character.id)?.alias;
  if (current) return current;
  const base = character.definition.name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
  const name = /^[a-zA-Z]/.test(base) ? base : `character_${base || 'ref'}`;
  let alias = name, suffix = 2;
  while (existing.some(binding => binding.alias === alias)) alias = `${name}_${suffix++}`;
  return alias;
}

export function resolveCharacterMentions(prompt: string, references: Array<{ alias?: string; name: string }>): string {
  const aliases = new Map(references.filter(reference => reference.alias).map(reference => [reference.alias, reference.name]));
  return prompt.replace(/@\{([^}\n]+)\}/g, (_match, alias: string) => {
    const name = aliases.get(alias);
    if (!name) throw new Error('creative_reference_alias_missing');
    return name;
  });
}

function hasValue(parameters: Record<string, unknown>, pointer: string): boolean {
  let value: unknown = parameters;
  for (const key of pointer.slice(1).split('/')) {
    if (!value || typeof value !== 'object' || !Object.hasOwn(value, key)) return false;
    value = (value as Record<string, unknown>)[key];
  }
  return value !== undefined && value !== null && value !== '';
}

/** Only conventional, schema-declared inputs can be wired without a human mapping. */
export function suggestCharacterBinding(character: CreativeCharacter, contract: FalModelContract | null, config: Pick<CreativeConfig, 'profileId' | 'parameters' | 'mediaBindings' | 'characterBindings'>): Result {
  if (character.state !== 'locked' || !character.snapshot || character.definition.voice.kind === 'unassigned') return { error: 'unapproved' };
  if (!contract || contract.status !== 'active') return { error: 'model' };
  const voice = character.definition.voice;
  if (voice.kind === 'provider' && (voice.profileId !== config.profileId || !voice.modelIds.includes(contract.id))) return { error: 'account' };
  if (/^fal-ai\/kling-video\/v2\.6\//.test(contract.id) && !/^(en|zh)(?:-|$)/i.test(voice.language)) return { error: 'model' };
  const used = new Set([...config.mediaBindings.map(binding => binding.pointer), ...config.characterBindings.filter(binding => binding.id !== character.id).flatMap(binding => [...binding.imagePointers, binding.voicePointer])]);
  function reserveParameters(value: unknown, path = '', depth = 0) {
    if (depth > 16) return;
    if (value && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) reserveParameters(child, `${path}/${key}`, depth + 1);
    } else if (value !== undefined && value !== null && value !== '') used.add(path);
  }
  reserveParameters(config.parameters);
  const imagePointers: string[] = [];
  const available = (path: string) => !used.has(path) && !hasValue(config.parameters, path);
  for (const _image of character.definition.images) {
    const pointer = modelMediaSlots(contract.schema, [...used]).find(path => /^\/(?:image_urls|reference_image_urls)\/\d+$/.test(path) && available(path))
      ?? modelMediaSlots(contract.schema, [...used]).find(path => /^\/(?:image_url|start_image_url|first_frame_url)$/.test(path) && available(path));
    if (!pointer) return { error: 'capacity' };
    imagePointers.push(pointer); used.add(pointer);
  }
  const voicePointer = voice.kind === 'provider'
    ? modelVoiceIdSlots(contract.schema, [...used]).find(available)
    : modelMediaSlots(contract.schema, [...used]).find(path => /^\/(?:audio_urls|voice_urls)\/\d+$/.test(path) && available(path))
      ?? modelMediaSlots(contract.schema, [...used]).find(path => /^\/(?:audio_url|voice_url|reference_audio_url)$/.test(path) && available(path));
  return voicePointer && imagePointers.length ? { binding: { id: character.id, alias: characterAlias(character, config.characterBindings), imagePointers, voicePointer } } : { error: 'model' };
}
