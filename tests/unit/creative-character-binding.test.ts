import { describe, expect, it } from 'vitest';
import { creativeConfigSchema } from '$lib/modules/creative-media/contracts/schemas/creative-media.schema.js';
import { characterAlias, resolveCharacterMentions, suggestCharacterBinding } from '$lib/modules/creative-media/domain/character-binding.js';
import { modelMediaSlots, modelVoiceIdSlots, type FalModelContract } from '$lib/modules/creative-media/domain/model-contract.js';
import type { CreativeCharacter } from '$lib/modules/creative-media/domain/character.js';

const id = '019fedce-9755-7000-8000-000000000001';
const account = '019fedce-9755-7000-8000-000000000002';
const modelId = 'bytedance/seedance-2.5/reference-to-video';
const contract: FalModelContract = { id: modelId, name: 'Reference video', category: 'reference-to-video', status: 'active', digest: 'contract', documentationUrl: 'https://fal.ai/models/test', outputSchema: {}, schema: {
  type: 'object', properties: { image_urls: { type: 'array', maxItems: 12, items: { type: 'string' } }, audio_urls: { type: 'array', maxItems: 3, items: { type: 'string' } } },
} };
function character(): CreativeCharacter {
  const definition = { name: 'Mox aprovado', appearance: 'Red character', images: ['one.png', 'two.png'], voice: { kind: 'audio' as const, path: 'voice.wav', language: 'pt-BR', style: '' } };
  return { id, workspaceId: id, familyId: id, version: 1, revision: 2, state: 'locked', definition, snapshot: { definition, images: [], voice: null, digest: 'frozen' } };
}
const config = () => creativeConfigSchema.parse({ modelId, profileId: account });

describe('named character reference controls', () => {
  it('binds all images and voice using the actual schema without mutation', () => {
    const input = config();
    expect(suggestCharacterBinding(character(), contract, input)).toEqual({ binding: { id, alias: 'Mox_aprovado', imagePointers: ['/image_urls/0', '/image_urls/1'], voicePointer: '/audio_urls/0' } });
    expect(input).toEqual(config());
  });
  it('never overwrites existing media, characters or explicit provider parameters', () => {
    const input = config();
    input.mediaBindings = [{ pointer: '/image_urls/0', path: 'scene.png' }];
    input.parameters = { image_urls: [null, 'https://example.com/other.png'], audio_urls: ['https://example.com/voice.wav'] };
    expect(suggestCharacterBinding(character(), contract, input).binding).toMatchObject({ imagePointers: ['/image_urls/2', '/image_urls/3'], voicePointer: '/audio_urls/1' });
  });
  it('rejects insufficient capacity instead of dropping a master or assuming a voice', () => {
    const narrow = structuredClone(contract); narrow.schema.properties!.image_urls.maxItems = 1;
    expect(suggestCharacterBinding(character(), narrow, config())).toEqual({ error: 'capacity' });
    delete narrow.schema.properties!.audio_urls; narrow.schema.properties!.image_urls.maxItems = 12;
    expect(suggestCharacterBinding(character(), narrow, config())).toEqual({ error: 'model' });
    expect(suggestCharacterBinding({ ...character(), state: 'draft' }, contract, config())).toEqual({ error: 'unapproved' });
  });
  it('does not guess a mask, end frame or ambiguous nested identity input', () => {
    const ambiguous = { ...contract, schema: { properties: { end_image_url: { type: 'string' }, mask_url: { type: 'string' }, elements: { type: 'array', items: { type: 'object', properties: { frontal_image_url: { type: 'string' } } } } } } };
    expect(suggestCharacterBinding(character(), ambiguous, config())).toEqual({ error: 'capacity' });
  });
  it('requires the exact account and declared voice ID input', () => {
    const record = character();
    record.definition = { ...record.definition, voice: { kind: 'provider', voiceId: 'native-123', profileId: account, modelIds: [modelId], language: 'en-US', style: '' } };
    const native = structuredClone(contract); native.schema.properties!.voice_ids = { type: 'array', maxItems: 2, items: { type: 'string' } };
    expect(suggestCharacterBinding(record, native, config()).binding?.voicePointer).toBe('/voice_ids/0');
    expect(suggestCharacterBinding(record, native, { ...config(), profileId: id })).toEqual({ error: 'account' });
    expect(suggestCharacterBinding(record, contract, config())).toEqual({ error: 'model' });
  });
  it('handles sparse/nested array slots within schema bounds', () => {
    expect(modelMediaSlots(contract.schema, ['/image_urls/8'])).toContain('/image_urls/9');
    expect(modelMediaSlots(contract.schema, ['/image_urls/9999999'])).toHaveLength(13);
    expect(modelVoiceIdSlots({ properties: { voice_ids: { type: 'array', maxItems: 2, items: { type: 'string' } } } }, ['/voice_ids/1'])).toEqual(['/voice_ids/0', '/voice_ids/1']);
  });
  it('retains reference names and rejects removed or unknown mentions', () => {
    const existing = [{ id, alias: 'Fixed_Name', imagePointers: ['/image_urls/0'], voicePointer: '/audio_urls/0' }];
    expect(characterAlias(character(), existing)).toBe('Fixed_Name');
    expect(characterAlias(character(), [{ ...existing[0], id: account, alias: 'Mox_aprovado' }])).toBe('Mox_aprovado_2');
    expect(resolveCharacterMentions('Show @{Mox} near the cafe. user@example.com', [{ alias: 'Mox', name: 'Mox approved' }])).toBe('Show Mox approved near the cafe. user@example.com');
    expect(() => resolveCharacterMentions('Show @{Missing}', [])).toThrow('creative_reference_alias_missing');
  });
  it('rejects ambiguous duplicate aliases in the shared UI and agent contract', () => {
    const input = config();
    input.characterBindings = [
      { id, alias: 'Mox', imagePointers: ['/image_urls/0'], voicePointer: '/audio_urls/0' },
      { id: account, alias: 'Mox', imagePointers: ['/image_urls/1'], voicePointer: '/audio_urls/1' },
    ];
    expect(creativeConfigSchema.safeParse(input).success).toBe(false);
  });
});
