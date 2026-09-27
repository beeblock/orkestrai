import { describe, expect, it } from 'vitest';
import { creativeConfigSchema, creativeCatalogQuerySchema } from '$lib/modules/creative-media/contracts/schemas/creative-media.schema.js';
import { parseFalContract, validateFalParameters } from '$lib/modules/creative-media/application/services/FalModelCatalogService.js';
import { falResultVideos, falVideoInput } from '$lib/modules/creative-media/infrastructure/providers/FalVideoProvider.js';
import { falBillingQuantity } from '$lib/modules/creative-media/domain/model-pricing.js';
import { matchesCreativeModality } from '$lib/modules/creative-media/domain/model-contract.js';
import { AUDIO_WORKFLOW_DRAFT } from '$lib/modules/creative-media/domain/audio-workflow.js';
import audioCatalog from '$lib/modules/creative-media/domain/fal-audio-catalog.json';
import { creativeOutputPath } from '$lib/modules/creative-media/application/services/CreativeMediaFiles.js';
import type { CreativeRun } from '$lib/modules/creative-media/domain/types.js';
import officialContracts from '../fixtures/fal-audio-contracts.json';
import higgsfieldContracts from '$lib/modules/creative-media/domain/higgsfield-video-contracts.json';

export function audioContract(kind: 'speech' | 'music' | 'effects' | 'reference' = 'speech') {
  const id = kind === 'speech' ? 'fal-ai/elevenlabs/tts/eleven-v3' : kind === 'music' ? AUDIO_WORKFLOW_DRAFT.modelId : kind === 'effects' ? 'fal-ai/elevenlabs/sound-effects/v2' : 'fal-ai/elevenlabs/voice-changer';
  const schema = kind === 'speech' ? { type: 'object', required: ['text'], properties: { text: { type: 'string', minLength: 1, maxLength: 5000 }, voice: { type: 'string', default: 'Rachel' }, language_code: { type: 'string' }, stability: { type: 'number', minimum: 0, maximum: 1 } } }
    : kind === 'reference' ? { type: 'object', required: ['audio_url'], properties: { audio_url: { type: 'string' }, voice: { type: 'string' } } }
    : { type: 'object', properties: { prompt: { type: 'string' }, music_length_ms: { type: 'integer', default: 30000, minimum: 3000, maximum: 600000 }, composition_plan: { type: 'object', additionalProperties: true }, duration_seconds: { type: 'number', minimum: 0.5, maximum: 30 }, output_format: { type: 'string' } } };
  const outputSchema = { type: 'object', properties: { audio: { type: 'object', properties: { url: { type: 'string' }, content_type: { type: 'string' } } } } };
  return parseFalContract({ endpoint_id: id, metadata: { display_name: kind, category: kind === 'reference' ? 'audio-to-audio' : 'text-to-audio', status: 'active' }, openapi: { paths: {
    [`/${id}`]: { post: { requestBody: { content: { 'application/json': { schema } } } } },
    [`/${id}/requests/{request_id}`]: { get: { responses: { 200: { content: { 'application/json': { schema: outputSchema } } } } } },
  } } });
}

describe('native audio workflow contracts', () => {
  it.each(officialContracts.models)('parses the official contract and audio result for $endpoint_id', raw => {
    const contract = parseFalContract(raw);
    expect(contract.schema.type).toBe('object');
    expect(Object.keys(contract.schema.properties ?? {}).length).toBeGreaterThan(0);
    const result = falResultVideos({ audio: { url: 'https://fal.media/sample.mp3', content_type: 'audio/mpeg', file_size: 1000 } }, contract);
    expect(result).toHaveLength(1);
    expect(result[0].mimeType).toBe('audio/mpeg');
  });
  it('validates real music, dialogue, effects and speech inputs rather than a generic video schema', () => {
    const examples: Record<string, Record<string, unknown>> = {
      'fal-ai/elevenlabs/tts/eleven-v3': { text: 'Only these words.', voice: 'Rachel', language_code: 'en' },
      'fal-ai/elevenlabs/music': { prompt: 'Instrumental acoustic soundtrack', music_length_ms: 30000, force_instrumental: true },
      'fal-ai/elevenlabs/sound-effects/v2': { text: 'A quiet door closing', duration_seconds: 2 },
      'fal-ai/elevenlabs/text-to-dialogue/eleven-v3': { inputs: [{ text: 'Welcome.', voice: 'Rachel' }, { text: 'Thank you.', voice: 'Aria' }] },
      'fal-ai/elevenlabs/voice-changer': { audio_url: 'https://fal.media/reference.mp3', voice: 'Rachel' },
      'fal-ai/minimax-music/v2.6': { prompt: 'Warm acoustic instrumental', is_instrumental: true },
    };
    for (const raw of officialContracts.models) {
      const contract = parseFalContract(raw);
      const parameters = examples[contract.id];
      const config = creativeConfigSchema.parse({ ...AUDIO_WORKFLOW_DRAFT, modelId: contract.id, parameters });
      expect(falVideoInput(config, '', {}, contract)).toEqual(parameters);
    }
    const music = parseFalContract(officialContracts.models.find(model => model.endpoint_id === AUDIO_WORKFLOW_DRAFT.modelId));
    expect(falBillingQuantity(creativeConfigSchema.parse({ ...AUDIO_WORKFLOW_DRAFT, parameters: {} }), 'minute', music)).toBeNull();
  });
  it('keeps video as the compatibility default and discovers only the requested modality', () => {
    expect(creativeConfigSchema.parse({}).modality).toBe('video');
    expect(creativeCatalogQuerySchema.parse({}).modality).toBe('video');
    expect(matchesCreativeModality('text-to-audio', 'audio')).toBe(true);
    expect(matchesCreativeModality('video-to-audio', 'audio')).toBe(true);
    expect(matchesCreativeModality('text-to-speech', 'video')).toBe(false);
    expect(matchesCreativeModality('speech-to-text', 'all')).toBe(false);
    expect(higgsfieldContracts.models.every(model => matchesCreativeModality(model.category, 'video'))).toBe(true);
    expect(higgsfieldContracts.models.every(model => !matchesCreativeModality(model.category, 'audio'))).toBe(true);
    expect(audioCatalog.models.length).toBeGreaterThan(20);
    expect(audioCatalog.models.every(model => matchesCreativeModality(model.category, 'audio'))).toBe(true);
    expect(audioCatalog.models.find(model => model.id === AUDIO_WORKFLOW_DRAFT.modelId)?.status).toBe('active');
    expect(() => creativeConfigSchema.parse({ ...AUDIO_WORKFLOW_DRAFT, provider: 'higgsfield' })).toThrow();
  });
  it('uses the exact speech contract and preserves literal text, voice and language', () => {
    const contract = audioContract();
    const config = creativeConfigSchema.parse({ ...AUDIO_WORKFLOW_DRAFT, modelId: contract.id, parameters: { text: 'Olá! [laughs] Bem-vindo.', voice: 'Aria', language_code: 'pt', stability: 0.5 } });
    expect(falVideoInput(config, '', {}, contract)).toEqual(config.parameters);
    expect(() => validateFalParameters(contract, { text: 'Hello', invented_voice: 'x' })).toThrow();
    expect(falBillingQuantity(config, '1000 characters', contract)).toBe(config.parameters.text!.toString().length / 1000);
    expect(falBillingQuantity({ ...config, parameters: {} }, 'second', contract)).toBeNull();
  });
  it.each(['audio', 'audios', 'song', 'songs', 'generation', 'generations'])('counts %s per output without requiring a music duration', unit => {
    const contract = parseFalContract(officialContracts.models.find(model => model.endpoint_id === AUDIO_WORKFLOW_DRAFT.modelId));
    const config = creativeConfigSchema.parse({ ...AUDIO_WORKFLOW_DRAFT, parameters: {} });
    expect(falBillingQuantity(config, unit, contract)).toBe(1);
    expect(falBillingQuantity({ ...config, parameters: { num_outputs: 2 } }, unit, contract)).toBe(2);
  });
  it('rounds music minutes conservatively and never uses the legacy video duration', () => {
    const contract = audioContract('music');
    const config = creativeConfigSchema.parse({ ...AUDIO_WORKFLOW_DRAFT, parameters: { music_length_ms: 61000 } });
    expect(falBillingQuantity(config, 'audio minute', contract)).toBe(2);
    expect(falBillingQuantity({ ...config, parameters: {} }, 'minute', contract)).toBe(1);
    expect(falBillingQuantity({ ...config, billingUnits: 0.1 }, 'minute', contract)).toBe(2);
    expect(falBillingQuantity(config, 'unknown-unit', contract)).toBeNull();
    expect(falBillingQuantity({ ...config, parameters: { composition_plan: { sections: [{ duration_ms: 80000 }, { duration_ms: 60000 }] } } }, 'minute', contract)).toBe(3);
  });
  it('binds audio references without leaking file paths into provider inputs', () => {
    const contract = audioContract('reference');
    const config = creativeConfigSchema.parse({ ...AUDIO_WORKFLOW_DRAFT, modelId: contract.id, parameters: { voice: 'Aria' }, mediaBindings: [{ pointer: '/audio_url', path: 'generated/audio/master.mp3' }] });
    const input = falVideoInput(config, '', { media: { '/audio_url': 'https://v3.fal.media/files/master.mp3' } }, contract);
    expect(input).toEqual({ voice: 'Aria', audio_url: 'https://v3.fal.media/files/master.mp3' });
    expect(JSON.stringify(input)).not.toContain('generated/');
  });
  it('rejects unusable raw audio and untrusted output hosts before publishing', () => {
    const contract = audioContract('music');
    const config = creativeConfigSchema.parse({ ...AUDIO_WORKFLOW_DRAFT, parameters: { output_format: 'pcm_44100' } });
    expect(() => falVideoInput(config, '', {}, contract)).toThrow('creative_audio_format_unsupported');
    contract.schema.properties!.output_format.default = 'ulaw_8000';
    expect(() => falVideoInput({ ...config, parameters: {} }, '', {}, contract)).toThrow('creative_audio_format_unsupported');
    expect(() => falResultVideos({ audio: { url: 'https://evil.example/song.mp3' } }, contract)).toThrow('creative_unsafe_provider_url');
  });
  it('resolves an audio output and preserves its real extension under the project', () => {
    const contract = audioContract('music');
    const [audio] = falResultVideos({ audio: { url: 'https://v3.fal.media/files/song.mp3' } }, contract);
    expect(audio.mimeType).toBe('audio/mpeg');
    expect(falResultVideos({ audio: { url: 'https://v3.fal.media/files/song.wav', content_type: 'audio/x-wav' } }, contract)[0].mimeType).toBe('audio/wav');
    expect(falResultVideos({ audio: { url: 'https://v3.fal.media/files/song.opus' } }, contract)[0].mimeType).toBe('audio/ogg');
    const config = creativeConfigSchema.parse(AUDIO_WORKFLOW_DRAFT);
    expect(creativeOutputPath({ id: 'run-1', snapshot: { config } } as CreativeRun, audio)).toBe('generated/audio/orkestrai-audio-run-1.mp3');
  });
});
