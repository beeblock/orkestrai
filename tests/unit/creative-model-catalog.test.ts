import { describe, expect, it, vi } from 'vitest';
import { creativeConfigSchema, creativePolicySchema } from '$lib/modules/creative-media/contracts/schemas/creative-media.schema.js';
import { FalModelCatalogService, parseFalContract, validateFalParameters } from '$lib/modules/creative-media/application/services/FalModelCatalogService.js';
import { falResultVideos, falVideoInput, validateFalHandle } from '$lib/modules/creative-media/infrastructure/providers/FalVideoProvider.js';
import { bindModelMedia } from '$lib/modules/creative-media/domain/model-input.js';
import { concreteSchema, modelDefaults, modelMediaSlots } from '$lib/modules/creative-media/domain/model-contract.js';
import { falBillingQuantity } from '$lib/modules/creative-media/domain/model-pricing.js';

const endpoint = 'bytedance/seedance-2.5/reference-to-video';
function model(id = endpoint) {
  return { endpoint_id: id, metadata: { display_name: 'Seedance 2.5', category: 'reference-to-video', status: 'active' }, openapi: {
    components: { schemas: { Input: { type: 'object', required: ['prompt'], properties: { prompt: { type: 'string', maxLength: 2000 }, duration: { type: 'string', enum: ['4', '5', '30', 'auto'], default: 'auto' }, resolution: { type: 'string', enum: ['480p', '720p'], default: '720p' }, generate_audio: { type: 'boolean', default: true }, image_urls: { type: 'array', maxItems: 50, items: { type: 'string' } }, sync_mode: { type: 'boolean', default: false } } }, Output: { type: 'object', properties: { video: { type: 'object', properties: { url: { type: 'string' } } } } } } },
    paths: { [`/${id}`]: { post: { requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Input' } } } } } }, [`/${id}/requests/{request_id}`]: { get: { responses: { 200: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Output' } } } } } } } },
  } };
}
const response = (models: unknown[], more = false, cursor: string | null = null) => new Response(JSON.stringify({ models, has_more: more, next_cursor: cursor }), { headers: { 'content-type': 'application/json' } });

describe('official fal model contracts', () => {
  it('keeps bounded descriptions, examples and reference annotations without turning examples into enums', () => {
    const raw = model();
    const props = raw.openapi.components.schemas.Input.properties as Record<string, unknown>;
    props.prompt_expansion_mode = { type: 'string', title: 'Prompt expansion', description: 'Rewrites the prompt, not render speed.', examples: ['disabled', 'fast', 'balanced', 'quality'], default: 'balanced' };
    props.nested = { type: 'object', properties: { reference: { $ref: '#/components/schemas/Output', description: 'Local annotation' } } };
    const contract = parseFalContract(raw);
    expect(contract.schema.properties!.prompt_expansion_mode).toMatchObject(props.prompt_expansion_mode as object);
    expect(contract.schema.properties!.nested.properties!.reference.description).toBe('Local annotation');
    expect(() => validateFalParameters(contract, { prompt: 'Scene', prompt_expansion_mode: 'future-provider-value' })).not.toThrow();
    expect(modelDefaults(contract.schema).generate_audio).toBe(true);
    props.tooLong = { type: 'string', description: 'x'.repeat(9000), examples: ['x'.repeat(9000)] };
    const bounded = parseFalContract(raw).schema.properties!.tooLong;
    expect(bounded.description).toHaveLength(8000);
    expect(bounded.examples).toBeUndefined();
    props.hostile = { type: 'string', examples: [JSON.parse('{"__proto__":{"polluted":true}}')] };
    expect(parseFalContract(raw).schema.properties!.hostile.examples).toBeUndefined();
  });
  it('resolves official schema aliases without changing the charged endpoint', () => {
    const raw = model('VEED/fabric-1.0');
    (raw.openapi as any).info = { 'x-fal-metadata': { endpointId: 'VEED/fabric-1.0' } };
    raw.endpoint_id = 'veed/fabric-1.0';
    expect(parseFalContract(raw).id).toBe('veed/fabric-1.0');
    const unavailable = model(); (unavailable.openapi as any) = { error: { code: 'expansion_failed' } };
    expect(() => parseFalContract(unavailable)).toThrow('creative_model_contract_unavailable');
  });
  it('retains audited URL/color expressions without enabling arbitrary regular expressions', () => {
    const raw = model(); (raw.openapi.components.schemas.Input.properties.prompt as any).pattern = '\\S';
    const contract = parseFalContract(raw);
    expect(() => validateFalParameters(contract, { prompt: '   ' })).toThrow('creative_model_parameters_invalid');
    expect(() => validateFalParameters(contract, { prompt: 'scene' })).not.toThrow();
  });
  it('finds nested media fields and adds the next array slot without a handwritten pointer', () => {
    const contract = parseFalContract(model());
    expect(modelMediaSlots(contract.schema)).toEqual(['/image_urls/0']);
    expect(modelMediaSlots(contract.schema, ['/image_urls/0'])).toEqual(['/image_urls/0', '/image_urls/1']);
  });
  it('unwraps nullable fields but preserves genuine input alternatives for JSON editing', () => {
    expect(concreteSchema({ default: 'auto', anyOf: [{ type: 'string' }, { type: 'null' }] })).toEqual({ type: 'string', default: 'auto' });
    expect(concreteSchema({ type: ['boolean', 'null'] }).type).toBe('boolean');
    const union = { anyOf: [{ type: 'string' }, { type: 'number' }] };
    expect(concreteSchema(union)).toEqual(union);
    expect(modelMediaSlots({ type: 'object', properties: { media: { anyOf: [{ type: 'object', properties: { image_url: { type: 'string' } } }, { type: 'object', properties: { video_url: { type: 'string' } } }] } } })).toEqual(['/media/image_url', '/media/video_url']);
  });
  it('calculates Seedance token units and refuses to guess reference-video duration', () => {
    const contract = parseFalContract(model());
    const config = creativeConfigSchema.parse({ modelId: endpoint, parameters: { duration: '5', resolution: '720p', aspect_ratio: '16:9' } });
    expect(falBillingQuantity(config, '1000 tokens', contract)).toBe(108);
    expect(falBillingQuantity({ ...config, billingUnits: 1 }, '1000 tokens', contract)).toBe(108);
    expect(falBillingQuantity({ ...config, parameters: { ...config.parameters, video_urls: ['https://example.com/input.mp4'] } }, '1000 tokens', contract)).toBeNull();
    expect(falBillingQuantity({ ...config, parameters: { duration: 'auto' } }, 'second', contract)).toBe(30);
    expect(falBillingQuantity({ ...config, billingUnits: 4 }, 'unknown-unit', contract)).toBe(4);
  });
  it('preserves every declared video output without treating a thumbnail as a video', () => {
    const contract = parseFalContract(model());
    contract.outputSchema = { type: 'object', properties: { videos: { type: 'array', items: { type: 'object', properties: { url: { type: 'string' } } } }, thumbnail_url: { type: 'string' }, preview_video: { type: 'string' } } };
    const a = 'https://v3.fal.media/files/a.mp4', b = 'https://v3.fal.media/files/b.webm';
    const videos = falResultVideos({ videos: [{ url: a }, { url: b, content_type: 'video/webm' }], thumbnail_url: 'https://v3.fal.media/files/image.png', preview_video: a }, contract);
    expect(videos.map(video => [video.url, video.mimeType])).toEqual([[a, 'video/mp4'], [b, 'video/webm']]);
    expect(() => falResultVideos({ videos: [{ url: 'http://127.0.0.1/secret' }] }, contract)).toThrow();
  });
  it('uses exact endpoint inputs without reducing every provider to Wan or Kling', () => {
    const contract = parseFalContract(model());
    const config = creativeConfigSchema.parse({ modelId: endpoint, prompt: 'A coherent shot', parameters: { ...modelDefaults(contract.schema), duration: '30', image_urls: ['https://cdn.example/photo.png'] } });
    const input = falVideoInput(config, config.prompt, {}, contract);
    expect(input).toEqual({ prompt: 'A coherent shot', duration: '30', resolution: '720p', generate_audio: true, image_urls: ['https://cdn.example/photo.png'], sync_mode: false });
    expect(input).not.toHaveProperty('cfg_scale');
    expect(input).not.toHaveProperty('negative_prompt');
    expect(() => falVideoInput(config, config.prompt, {})).toThrow('creative_model_contract_invalid');
  });
  it('ignores long non-media arrays while bounding actual video output counts', () => {
    const contract = parseFalContract(model());
    contract.outputSchema.properties!.segments = { type: 'array', items: { type: 'object', properties: { text: { type: 'string' } } } };
    expect(falResultVideos({ video: { url: 'https://v3.fal.media/files/a.mp4' }, segments: Array.from({ length: 50 }, () => ({ text: 'Transcript' })) }, contract)).toHaveLength(1);
    contract.outputSchema = { type: 'object', properties: { videos: { type: 'array', items: { type: 'object', properties: { url: { type: 'string' } } } } } };
    expect(() => falResultVideos({ videos: Array.from({ length: 11 }, (_, i) => ({ url: `https://v3.fal.media/files/${i}.mp4` })) }, contract)).toThrow('creative_invalid_provider_response');
  });
  it('rejects unrecognized parameters, wrong enums, missing required values and wrong JSON types', () => {
    const contract = parseFalContract(model());
    for (const input of [{}, { prompt: 'x', duration: 30 }, { prompt: 'x', duration: '60' }, { prompt: 'x', api_key: 'never-send-secrets' }, { prompt: 'x', image_urls: Array(51).fill('x') }]) expect(() => validateFalParameters(contract, input)).toThrow('creative_model_parameters_invalid');
  });
  it('resolves local OpenAPI references and refuses external or recursive references', () => {
    for (const ref of ['https://evil.test/schema', '#/components/schemas/Input']) {
      const raw = model(); (raw.openapi.components.schemas.Input as any).properties.loop = { $ref: ref };
      expect(() => parseFalContract(raw)).toThrow('creative_model_contract_invalid');
    }
  });
  it('does not compile arbitrary provider expressions and retains descriptions only as inert data', () => {
    const raw = model(); (raw.openapi.components.schemas.Input.properties.prompt as any).pattern = '(a+)+$';
    expect(() => parseFalContract(raw)).toThrow('creative_model_contract_invalid');
    delete (raw.openapi.components.schemas.Input.properties.prompt as any).pattern;
    (raw.openapi.components.schemas.Input as any).description = '<script>steal()</script>';
    expect(parseFalContract(raw).schema.description).toBe('<script>steal()</script>');
  });
  it('binds multiple nested images without leaking local paths or changing order', () => {
    const contract = parseFalContract(model());
    const nodeId = '01a0abcd-1234-7890-8abc-123456789012';
    const config = creativeConfigSchema.parse({ modelId: endpoint, prompt: 'A scene', parameters: { duration: '5' }, mediaBindings: [{ pointer: '/image_urls/0', nodeId }, { pointer: '/image_urls/1', path: 'assets/second.png' }] });
    const input = falVideoInput(config, config.prompt, { media: { '/image_urls/0': 'data:image/png;base64,YQ==', '/image_urls/1': 'data:image/png;base64,Yg==' } }, contract);
    expect(input.image_urls).toEqual(['data:image/png;base64,YQ==', 'data:image/png;base64,Yg==']);
    expect(JSON.stringify(input)).not.toContain('assets/second.png');
    expect(() => falVideoInput(config, config.prompt, { media: {} }, contract)).toThrow('creative_reference_required');
    const complex = {}; bindModelMedia(complex, '/elements/0/frontal_image_url', 'https://cdn.example/a.png');
    expect(complex).toEqual({ elements: [{ frontal_image_url: 'https://cdn.example/a.png' }] });
    for (const pointer of ['/__proto__/x', '/constructor/x', '/elements/99999999/url']) expect(() => bindModelMedia({}, pointer, 'x')).toThrow();
    expect(({} as any).x).toBeUndefined();
  });
  it('validates media paths, unique bindings and bounded JSON before persistence', () => {
    for (const mediaBindings of [[{ pointer: '/image_url', path: '../secret' }], [{ pointer: '/image_url', path: 'x' }, { pointer: '/image_url', path: 'y' }], [{ pointer: '/image_url' }]]) expect(creativeConfigSchema.safeParse({ modelId: endpoint, mediaBindings }).success).toBe(false);
    expect(creativeConfigSchema.safeParse({ parameters: { image_url: 'data:image/png;base64,secret' } }).success).toBe(false);
    expect(creativeConfigSchema.safeParse({ parameters: JSON.parse('{"__proto__":{"x":1}}') }).success).toBe(false);
    expect(creativePolicySchema.parse({ modelIds: [endpoint, 'fal-ai/veo3.1', 'minimax/h3-max/text-to-video'] }).modelIds).toHaveLength(3);
    for (const url of ['file:///private/secret', 'http://localhost/file', 'https://127.0.0.1/file', 'https://user:password@example.com/file', 'https://example.local/file']) {
      const config = creativeConfigSchema.parse({ modelId: endpoint, prompt: 'Scene', parameters: { image_urls: [url] } });
      expect(() => falVideoInput(config, config.prompt, {}, parseFalContract(model()))).toThrow('creative_model_parameters_invalid');
    }
  });
  it('supports every vendor queue namespace while refusing path traversal and cross-job URLs', () => {
    for (const id of [endpoint, 'minimax/h3-max/text-to-video', 'xai/grok-imagine-video/text-to-video', 'fal-ai/veo3.1']) {
      const requestId = '01234567-89ab-cdef-0123-456789abcdef'; const base = `https://queue.fal.run/${id}/requests/${requestId}`;
      expect(validateFalHandle({ requestId, statusUrl: `${base}/status`, responseUrl: base, cancelUrl: `${base}/cancel` }).requestId).toBe(requestId);
    }
  });
  it('caches discovery and contracts, verifies exact IDs and keeps metadata bounded', async () => {
    const fetch = vi.fn().mockResolvedValue(response([model()]));
    const service = new FalModelCatalogService(fetch);
    expect((await service.list())[0].id).toBe(endpoint);
    expect(await service.list()).toHaveLength(1);
    expect(fetch).toHaveBeenCalledTimes(1);
    fetch.mockResolvedValueOnce(response([model('fal-ai/new-model')]));
    expect((await service.list(true))[0].id).toBe('fal-ai/new-model');
    expect(fetch).toHaveBeenCalledTimes(2);
    const other = new FalModelCatalogService(vi.fn().mockResolvedValue(response([model('evil/model')])));
    await expect(other.contract(endpoint)).rejects.toThrow('creative_model_not_found');
    const contractService = new FalModelCatalogService(vi.fn().mockResolvedValue(response([model()])));
    const first = await contractService.contract(endpoint); first.schema.properties = {};
    expect((await contractService.contract(endpoint)).schema.properties).toHaveProperty('prompt');
  });
});
