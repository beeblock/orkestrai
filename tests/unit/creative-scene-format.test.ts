import { describe, expect, it } from 'vitest';
import { requestedAspectParameters, SCENE_IMAGE_SIZES } from '$lib/modules/creative-media/domain/scene-format.js';
import type { FalModelContract } from '$lib/modules/creative-media/domain/model-contract.js';
describe('declared scene output formats', () => {
  const contract: FalModelContract = { id: 'test/video', name: 'Test video', category: 'video', status: 'active', documentationUrl: 'https://fal.ai', outputSchema: {}, digest: 'a'.repeat(64), schema: { properties: { aspect_ratio: { type: 'string', enum: ['16:9', '9:16'] } } } };
  it('binds declared values without overwriting other inputs', () => { expect(requestedAspectParameters({ duration: '5s' }, contract, '9:16')).toEqual({ duration: '5s', aspect_ratio: '9:16' }); expect(SCENE_IMAGE_SIZES['9:16']).toEqual([1080, 1920]); });
  it('rejects unsupported and ambiguous contracts', () => {
    expect(() => requestedAspectParameters({}, contract, '1:1')).toThrow('creative_recipe_format_unsupported');
    expect(() => requestedAspectParameters({}, { ...contract, schema: { properties: {} } }, '9:16')).toThrow();
    expect(() => requestedAspectParameters({}, { ...contract, schema: { properties: { aspect_ratio: { type: 'string' }, aspectRatio: { type: 'string' } } } }, '9:16')).toThrow();
  });
});
