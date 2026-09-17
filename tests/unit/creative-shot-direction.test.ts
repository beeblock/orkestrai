import { describe, it, expect } from 'vitest';
import { shotDirectionPrompt, shotDirectionSchema, requestedDurationParameters } from '$lib/modules/creative-media/domain/shot-direction.js';
import type { FalModelContract, ModelSchema } from '$lib/modules/creative-media/domain/model-contract.js';
import { switchCreativeModel } from '$lib/modules/creative-media/domain/creative-model-switch.js';
import { creativeConfigSchema } from '$lib/modules/creative-media/contracts/schemas/creative-media.schema.js';
describe('creative shot intent and duration', () => {
  const contract = (properties: Record<string, ModelSchema>) => ({ schema: { type: 'object', properties } }) as FalModelContract;
  it('keeps legacy prompts unchanged until shot intent is explicitly selected', () => {
    expect(shotDirectionPrompt(shotDirectionSchema.parse({}))).toBe('');
    expect(shotDirectionPrompt(shotDirectionSchema.parse({ framing: 'full', motion: 'orbit' }))).toContain('Orbit around');
    expect(shotDirectionPrompt(shotDirectionSchema.parse({ framing: 'full', motion: 'orbit' }), true)).not.toContain('Orbit around');
  });
  it('maps exact declared durations without shortening or guessing ambiguous fields', () => {
    expect(requestedDurationParameters({ seed: 5 }, contract({ duration: { type: 'string', enum: ['5s', '10s'] } }), 10)).toEqual({ seed: 5, duration: '10s' });
    expect(requestedDurationParameters({}, contract({ duration_seconds: { type: 'number', minimum: 1, maximum: 120 } }), 35)).toEqual({ duration_seconds: 35 });
    expect(() => requestedDurationParameters({}, contract({ duration: { type: 'string', enum: ['5s', '10s'] } }), 8)).toThrow('creative_invalid_duration');
    expect(() => requestedDurationParameters({}, contract({ duration: { type: 'number' }, duration_seconds: { type: 'number' } }), 5)).toThrow('creative_invalid_duration');
    expect(() => requestedDurationParameters({}, contract({ duration: { type: 'integer', maximum: 15 } }), 30)).toThrow('creative_invalid_duration');
    expect(() => requestedDurationParameters({}, contract({ duration: { type: 'integer' } }), 3.5)).toThrow('creative_invalid_duration');
  });
  it('preserves file references, voice, parameters and shot across endpoint changes', () => {
    const config = creativeConfigSchema.parse({ modelId: 'fal-ai/test-a/video', parameters: { duration: 10 }, shot: { framing: 'full', motion: 'orbit' }, mediaBindings: [{ pointer: '/reference', path: 'refs/master.png' }], characterBindings: [{ id: '01950000-0000-7000-8000-000000000001', imagePointers: ['/image'], voicePointer: '/voice' }] });
    const changed = switchCreativeModel(config, 'fal-ai/test-b/video');
    expect(changed).toEqual({ ...config, modelId: 'fal-ai/test-b/video' });
    expect(() => switchCreativeModel(config, 'wan-2.7-text')).toThrow('creative_model_mapping_required');
    expect(config.mediaBindings[0].path).toBe('refs/master.png');
  });
});
