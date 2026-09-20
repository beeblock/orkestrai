import { describe, it, expect, vi } from 'vitest';
import { creativeConfigSchema, creativeCatalogQuerySchema } from '$lib/modules/creative-media/contracts/schemas/creative-media.schema.js';
import { creativeModelCatalog } from '$lib/modules/creative-media/application/services/CreativeModelCatalogService.js';
import { validateFalParameters } from '$lib/modules/creative-media/application/services/FalModelCatalogService.js';
import { modelDefaults } from '$lib/modules/creative-media/domain/model-contract.js';
import { creativeProviderId } from '$lib/modules/creative-media/domain/providers.js';
import { switchCreativeModel } from '$lib/modules/creative-media/domain/creative-model-switch.js';
import { BytePlusVideoProvider, byteplusInput, byteplusHandle } from '$lib/modules/creative-media/infrastructure/providers/BytePlusVideoProvider.js';
import { HiggsfieldVideoProvider, higgsfieldHandle } from '$lib/modules/creative-media/infrastructure/providers/HiggsfieldVideoProvider.js';
import { providerUrl } from '$lib/modules/creative-media/infrastructure/providers/video-provider-http.js';

const hfId = 'c20972e2-94b0-499b-a1a0-f17b5844a322';
async function config(provider: 'byteplus' | 'higgsfield', id = provider === 'byteplus' ? 'dreamina-seedance-2-5-260628' : 'minimax/h3/image-to-video') {
  const contract = await creativeModelCatalog.contract(id, provider);
  return { contract, config: creativeConfigSchema.parse({ provider, modelId: id, prompt: 'Approved scene', parameters: modelDefaults(contract.schema) }) };
}
describe('video provider boundaries', () => {
  it('keeps old workflows on fal and refuses unknown providers', () => {
    expect(creativeConfigSchema.parse({}).provider).toBe('fal');
    expect(creativeProviderId(undefined)).toBe('fal');
    expect(() => creativeProviderId('evil')).toThrow();
    expect(creativeConfigSchema.safeParse({ provider: 'byteplus' }).success).toBe(false);
    expect(creativeCatalogQuerySchema.parse({ provider: 'byteplus', endpoint: 'dreamina-seedance-2-5-260628' }).provider).toBe('byteplus');
  });
  it('does not assume that a model ID belongs to another provider', async () => {
    await expect(creativeModelCatalog.contract('minimax/h3/image-to-video', 'byteplus')).rejects.toThrow('creative_model_not_found');
  });
  it('compiles every reviewed contract', async () => {
    for (const provider of ['byteplus', 'higgsfield'] as const) {
      const catalog = await creativeModelCatalog.discover(provider);
      expect(catalog.models.length).toBeGreaterThan(3);
      for (const model of catalog.models) {
        const contract = await creativeModelCatalog.contract(model.id, provider);
        try { validateFalParameters(contract, {}); } catch (error) { expect((error as Error).message).toBe('creative_model_parameters_invalid'); }
      }
    }
  });
  it('requires explicit remapping and preserves references when changing providers', () => {
    const id = 'd20972e2-94b0-499b-a1a0-f17b5844a322';
    const previous = creativeConfigSchema.parse({ modelId: 'minimax/h3/image-to-video', parameters: { duration: 10 }, mediaBindings: [{ pointer: '/image_url', nodeId: id }] });
    expect(() => switchCreativeModel(previous, previous.modelId, 'higgsfield')).toThrow('creative_model_mapping_required');
    const next = switchCreativeModel(previous, previous.modelId, 'higgsfield', true);
    expect(next.mediaBindings).toEqual(previous.mediaBindings);
    expect(next.requiredReferenceNodeIds).toContain(id);
    expect(next.profileId).toBeNull(); expect(next.parameters).toEqual({});
  });
  it('rejects lookalike storage domains, local addresses and credentials in URLs', () => {
    for (const url of ['https://higgsfield.ai.evil.com/a', 'https://127.0.0.1/a', 'http://cdn.higgsfield.ai/a', 'https://key@cdn.higgsfield.ai/a']) {
      expect(() => providerUrl(url, [], ['higgsfield.ai'])).toThrow('creative_unsafe_provider_url');
    }
  });
  it('preserves all thirty reference images when switching providers', () => {
    const mediaBindings = Array.from({ length: 30 }, (_, index) => ({ pointer: `/image_urls/${index}`, nodeId: `d20972e2-94b0-499b-a1a0-${String(index).padStart(12, '0')}` }));
    const previous = creativeConfigSchema.parse({ provider: 'byteplus', modelId: 'dreamina-seedance-2-5-260628', mediaBindings });
    const next = switchCreativeModel(previous, 'bytedance/seedance-2.5/reference-to-video', 'higgsfield', true);
    expect(next.requiredReferenceNodeIds).toEqual(mediaBindings.map(binding => binding.nodeId));
    expect(next.mediaBindings).toEqual(mediaBindings);
  });
});
describe('BytePlus ModelArk', () => {
  it('maps approved frames to native content without changing prompt or dimensions', async () => {
    const c = await config('byteplus'); c.config.parameters.first_image_url = 'https://assets.example/first.png'; c.config.parameters.last_image_url = 'https://assets.example/last.png';
    const input = byteplusInput(c.config, 'Exact approved dialogue', {}, c.contract);
    expect(input).toMatchObject({ model: c.config.modelId, duration: 5, resolution: '720p', ratio: 'adaptive', content: [
      { type: 'text', text: 'Exact approved dialogue' }, { type: 'image_url', image_url: { url: 'https://assets.example/first.png' }, role: 'first_frame' }, { type: 'image_url', image_url: { url: 'https://assets.example/last.png' }, role: 'last_frame' },
    ] });
    c.config.parameters.audio_urls = ['https://assets.example/voice.wav'];
    expect(() => byteplusInput(c.config, 'x', {}, c.contract)).toThrow('creative_byteplus_input_modes');
  });
  it('estimates public list prices without assuming temporary discounts', async () => {
    const c = await config('byteplus');
    expect(await new BytePlusVideoProvider().estimate('unused-key', c.config, c.contract)).toMatchObject({ estimatedCents: 116, reservedCents: 464, priceSource: 'public_list' });
  });
  it('does not upload local videos to another service or delete a finished task', async () => {
    const fetchFn = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => Response.json({ id: 'cgt-20260920-test12345', status: 'succeeded' }));
    const adapter = new BytePlusVideoProvider(fetchFn as typeof fetch);
    await expect(adapter.prepareMedia('unused-key', { '/video_urls/0': 'data:video/mp4;base64,YQ==' })).rejects.toThrow('creative_byteplus_video_url_required');
    await adapter.cancel('private-key', byteplusHandle('cgt-20260920-test12345'));
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn.mock.calls[0][1]?.method).not.toBe('DELETE');
  });
  it('checks handle origin before sending a credential', async () => {
    const fetchFn = vi.fn(); const adapter = new BytePlusVideoProvider(fetchFn);
    await expect(adapter.status('private-key', { ...byteplusHandle('cgt-20260920-test12345'), statusUrl: 'https://evil.com/status' })).rejects.toThrow('creative_unsafe_provider_url');
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
describe('Higgsfield API', () => {
  it('uploads references without forwarding the API credential to signed storage', async () => {
    const fetchFn = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => init?.method === 'PUT' ? new Response(null, { status: 200 }) : Response.json({
      public_url: 'https://media.higgsfield.ai/ref.png', upload_url: 'https://bucket.s3.amazonaws.com/ref.png?signature=test', content_type: 'image/png', upload_headers: { 'Content-Type': 'image/png', 'x-amz-tagging': 'temporary=true' },
    }));
    const result = await new HiggsfieldVideoProvider(fetchFn as typeof fetch).prepareMedia('key-id:key-secret', { '/image_url': 'data:image/png;base64,YQ==' });
    expect(result).toEqual({ '/image_url': 'https://media.higgsfield.ai/ref.png' });
    expect(fetchFn.mock.calls[1][1]).toMatchObject({ method: 'PUT', redirect: 'manual', headers: { 'Content-Type': 'image/png', 'x-amz-tagging': 'temporary=true' } });
    expect(JSON.stringify(fetchFn.mock.calls[1])).not.toContain('key-secret');
  });
  it.each(['https://evil.com/upload', 'https://127.0.0.1/upload', 'https://higgsfield.ai.evil.com/upload'])('rejects an untrusted upload destination: %s', async url => {
    const fetchFn = vi.fn(async () => Response.json({ public_url: 'https://media.higgsfield.ai/a.png', upload_url: url, content_type: 'image/png', upload_headers: {} }));
    await expect(new HiggsfieldVideoProvider(fetchFn as typeof fetch).prepareMedia('key-id:key-secret', { '/image_url': 'data:image/png;base64,YQ==' })).rejects.toThrow('creative_unsafe_provider_url');
    expect(fetchFn).toHaveBeenCalledOnce();
  });
  it('exposes dated public rates independently of an account discount', async () => {
    const fetchFn = vi.fn();
    expect(await new HiggsfieldVideoProvider(fetchFn).prices('unused', ['minimax/h3/image-to-video'])).toMatchObject([{ unitPrice: 0.13, priceSource: 'public_list', currency: 'USD' }]);
    expect(fetchFn).not.toHaveBeenCalled();
  });
  it('downloads only a permitted video URL without attaching account headers', async () => {
    const fetchFn = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => new Response('video', { headers: { 'Content-Type': 'video/mp4' } }));
    const adapter = new HiggsfieldVideoProvider(fetchFn as typeof fetch);
    await adapter.download('key-id:key-secret', { url: 'https://media.higgsfield.ai/video.mp4', mimeType: 'video/mp4', size: null, width: null, height: null, duration: null, fps: null });
    expect(JSON.stringify(fetchFn.mock.calls)).not.toContain('key-secret');
    expect(fetchFn.mock.calls[0][1]?.redirect).toBe('manual');
  });
  it('quotes the exact model parameters through the account endpoint without submitting', async () => {
    const c = await config('higgsfield'); c.config.parameters.image_url = 'https://assets.example/first.png';
    const fetchFn = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => Response.json({ usd: '0.3575', credits: '5.72' }));
    const adapter = new HiggsfieldVideoProvider(fetchFn as typeof fetch);
    expect(await adapter.estimate('key-id:key-secret', c.config, c.contract, { prompt: 'Approved words only', media: {} })).toEqual({ estimatedCents: 36, reservedCents: 36, priceSource: 'account_quote' });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0];
    expect(String(url)).toBe('https://api.higgsfield.ai/estimate/minimax/h3/image-to-video');
    expect(JSON.parse(String(init?.body))).toMatchObject({ resolution: '2K', duration: 5, prompt: 'Approved words only', image_url: c.config.parameters.image_url });
    expect(init?.headers).toMatchObject({ Authorization: 'Key key-id:key-secret' });
  });
  it.each(['queued', 'in_progress', 'completed', 'failed', 'nsfw', 'canceled'])('normalizes the %s state without echoing provider text', async status => {
    const adapter = new HiggsfieldVideoProvider(vi.fn(async () => Response.json({ request_id: hfId, status, error: 'private data' })) as typeof fetch);
    const result = await adapter.status('key-id:key-secret', higgsfieldHandle(hfId));
    expect(['queued', 'running', 'completed', 'failed', 'cancelled']).toContain(result.status);
    expect(JSON.stringify(result)).not.toContain('private data');
  });
  it('rejects a forged handle without leaking the API key', async () => {
    const fetchFn = vi.fn();
    await expect(new HiggsfieldVideoProvider(fetchFn).status('key-id:key-secret', { ...higgsfieldHandle(hfId), responseUrl: 'https://evil.com' })).rejects.toThrow('creative_unsafe_provider_url');
    expect(fetchFn).not.toHaveBeenCalled();
  });
  it('never automatically retries an ambiguous paid submission', async () => {
    const c = await config('higgsfield'); c.config.parameters.image_url = 'https://assets.example/first.png';
    const fetchFn = vi.fn(async () => { throw new Error('network error with key-id:key-secret'); });
    await expect(new HiggsfieldVideoProvider(fetchFn as typeof fetch).submit('key-id:key-secret', c.config, 'Approved scene', {}, c.contract)).rejects.toThrow('creative_provider_unavailable');
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});
