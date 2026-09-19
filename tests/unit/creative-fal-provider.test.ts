import { describe, expect, it, vi } from 'vitest';
import { creativeConfigSchema, creativePathSchema } from '$lib/modules/creative-media/contracts/schemas/creative-media.schema.js';
import { FalVideoProvider, falVideoInput, validateFalHandle } from '$lib/modules/creative-media/infrastructure/providers/FalVideoProvider.js';

const requestId = '01a0abcd-1234-7890-8abc-123456789012';
const base = `https://queue.fal.run/fal-ai/wan-27-t2v/text-to-video/requests/${requestId}`;
const handle = { requestId, statusUrl: `${base}/status`, responseUrl: base, cancelUrl: `${base}/cancel` };
const credential = 'synthetic-fal-key-for-tests';
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

describe('native creative video contracts', () => {
  it('keeps documented provider input types and does not send unsupported options', () => {
    const wan = creativeConfigSchema.parse({ prompt: 'A moving scene', duration: 7, seed: 42 });
    expect(falVideoInput(wan, wan.prompt, {})).toEqual({ prompt: 'A moving scene', duration: 7, aspect_ratio: '16:9', resolution: '720p', negative_prompt: '', enable_prompt_expansion: false, enable_safety_checker: true, seed: 42 });
    const kling = creativeConfigSchema.parse({ modelId: 'kling-v3-pro-image', prompt: 'A moving scene', duration: 8 });
    expect(falVideoInput(kling, kling.prompt, { start: 'data:image/png;base64,c3ludGhldGlj', end: 'data:image/png;base64,ZW5k' })).toEqual({ prompt: 'A moving scene', duration: '8', start_image_url: 'data:image/png;base64,c3ludGhldGlj', end_image_url: 'data:image/png;base64,ZW5k', generate_audio: false, negative_prompt: '', cfg_scale: 0.5 });
    expect(() => falVideoInput(kling, kling.prompt, {})).toThrow('creative_reference_required');
  });
  it('rejects invalid capabilities and path escapes before any call', () => {
    for (const path of ['../outside', '/tmp/outside', 'C:\\outside', '\\\\host\\share', 'file:///tmp/a', 'folder/../../x', 'folder\u0000file']) expect(creativePathSchema.safeParse(path).success).toBe(false);
    for (const path of ['generated/videos', 'assets/campaign', '@design/videos']) expect(creativePathSchema.safeParse(path).success).toBe(true);
    expect(creativeConfigSchema.safeParse({ modelId: 'kling-v3-pro-image', duration: 2 }).success).toBe(false);
    expect(creativeConfigSchema.safeParse({ modelId: 'kling-v3-pro-image', seed: 42 }).success).toBe(false);
    expect(creativeConfigSchema.safeParse({ modelId: 'wan-2.7-text', generateAudio: true }).success).toBe(false);
    expect(creativeConfigSchema.safeParse({ modelId: 'kling-v3-pro-image', prompt: 'x'.repeat(2501) }).success).toBe(false);
  });
  it('accepts documented queue aliases but binds every URL to the exact request', () => {
    expect(validateFalHandle(handle)).toEqual(handle);
    expect(validateFalHandle({ ...handle, responseUrl: `${base}/response` }).responseUrl).toBe(`${base}/response`);
    for (const statusUrl of ['https://evil.test/status', 'http://queue.fal.run/status', `${base}/status?token=secret`, `${base}/status#fragment`, `${base.replace(requestId, 'other-id')}/status`, `https://user:password@queue.fal.run/fal-ai/wan/requests/${requestId}/status`, `${base}/status/extra`]) {
      expect(() => validateFalHandle({ ...handle, statusUrl })).toThrow();
    }
  });
});

describe('fal video adapter', () => {
  it('batches account base prices and strips unrelated or unbounded provider data without submitting', async () => {
    const ids = ['minimax/h3/image-to-video', 'bytedance/seedance-2.5/image-to-video'];
    const fetch = vi.fn().mockResolvedValue(json({ prices: [
      { endpoint_id: ids[0], unit_price: 0.06, unit: 'second', currency: 'USD', secret: 'must-not-return' },
      { endpoint_id: 'unrequested/model', unit_price: 1, unit: 'video', currency: 'USD' },
    ] }));
    const result = await new FalVideoProvider(fetch).prices(credential, ids);
    expect(result).toEqual([{ endpointId: ids[0], unitPrice: 0.06, unit: 'second', currency: 'USD' }]);
    expect(new URL(fetch.mock.calls[0][0]).searchParams.getAll('endpoint_id')).toEqual(ids);
    expect(fetch.mock.calls[0][0]).toContain('https://api.fal.ai/v1/models/pricing?');
    expect(fetch).toHaveBeenCalledTimes(1);
    const invalid = vi.fn().mockResolvedValue(json({ prices: [{ endpoint_id: ids[0], unit_price: -1, unit: 'video', currency: 'USD' }] }));
    await expect(new FalVideoProvider(invalid).prices(credential, ids)).rejects.toThrow('creative_estimate_unavailable');
    await expect(new FalVideoProvider(fetch).prices(credential, Array(51).fill(ids[0]))).rejects.toThrow('creative_invalid_input');
  });
  it('uploads bounded references once with expiration and never forwards the account key to storage', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(json({ file_url: 'https://v3b.fal.media/files/input.png', upload_url: 'https://v3.fal.media/upload/input?signature=temporary' })).mockResolvedValueOnce(new Response(null, { status: 200 })).mockResolvedValueOnce(json({ token: 'temporary-cdn-token' })).mockResolvedValueOnce(new Response('https://v3b.fal.media/files/input.png?identity=read-only-expiring'));
    const input = 'data:image/png;base64,c3ludGhldGlj';
    const output = await new FalVideoProvider(fetch).prepareMedia(credential, { '/image_urls/0': input, '/image_urls/1': input });
    expect(output).toEqual({ '/image_urls/0': 'https://v3b.fal.media/files/input.png?identity=read-only-expiring', '/image_urls/1': 'https://v3b.fal.media/files/input.png?identity=read-only-expiring' });
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(JSON.parse(fetch.mock.calls[0][1].headers['X-Fal-Object-Lifecycle-Preference'])).toEqual({ expiration_duration_seconds: 86400, initial_acl: { default: 'forbid', rules: [] } });
    expect(JSON.stringify(fetch.mock.calls[1])).not.toContain(credential);
    expect(fetch.mock.calls[1][1].headers).toEqual({ 'Content-Type': 'image/png' });
    expect(fetch.mock.calls[3][1].headers.Authorization).toBe('Bearer temporary-cdn-token');
    expect(JSON.stringify(output)).not.toContain('signature');
    const malicious = vi.fn().mockResolvedValue(json({ file_url: 'https://v3b.fal.media/files/input.png', upload_url: 'https://evil.test/upload' }));
    await expect(new FalVideoProvider(malicious).prepareMedia(credential, { '/image_url': input })).rejects.toThrow('creative_unsafe_provider_url');
    expect(malicious).toHaveBeenCalledTimes(1);
  });
  it('submits once with retention/privacy controls and no automatic provider fallback', async () => {
    const fetch = vi.fn().mockResolvedValue(json({ request_id: requestId, status_url: handle.statusUrl, response_url: handle.responseUrl, cancel_url: handle.cancelUrl }));
    const adapter = new FalVideoProvider(fetch);
    expect(await adapter.submit(credential, creativeConfigSchema.parse({}), 'A calm ocean', {})).toEqual(handle);
    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe('https://queue.fal.run/fal-ai/wan/v2.7/text-to-video');
    expect(options.redirect).toBe('manual');
    expect(options.headers).toMatchObject({ Authorization: `Key ${credential}`, 'X-Fal-Store-IO': '0', 'X-Fal-No-Retry': '1', 'x-app-fal-disable-fallback': 'true' });
    expect(JSON.parse(options.headers['X-Fal-Object-Lifecycle-Preference'])).toEqual({ expiration_duration_seconds: 3600, initial_acl: { default: 'forbid', rules: [] } });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('never retries an uncertain submission or exposes upstream secrets in errors', async () => {
    const fetch = vi.fn().mockRejectedValue(new Error(`Socket failed with ${credential}`));
    const adapter = new FalVideoProvider(fetch);
    await expect(adapter.submit(credential, creativeConfigSchema.parse({}), 'A scene', {})).rejects.toThrow('creative_provider_unavailable');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('rejects redirect, unknown status, mismatched job and HTML responses', async () => {
    for (const response of [new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/' } }), json({ status: 'OK' }), json({ status: 'COMPLETED', request_id: 'another-request-id-123' }), new Response('<html>private content</html>')]) {
      const fetch = vi.fn().mockResolvedValue(response);
      await expect(new FalVideoProvider(fetch).status(credential, handle)).rejects.toThrow();
      expect(fetch).toHaveBeenCalledTimes(1);
    }
  });
  it('does not confuse completed-with-error with success', async () => {
    const fetch = vi.fn().mockResolvedValue(json({ status: 'COMPLETED', error: 'PRIVATE PROMPT echoed by upstream', error_type: 'content_policy_violation' }));
    expect(await new FalVideoProvider(fetch).status(credential, handle)).toEqual({ status: 'failed', queuePosition: null });
  });
  it('keeps cancellation as requested until the provider confirms the terminal state', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(json({ status: 'CANCELLATION_REQUESTED' }, 202)).mockResolvedValueOnce(json({ status: 'ALREADY_COMPLETED' }, 400)).mockResolvedValueOnce(json({ status: 'NOT_FOUND' }, 404));
    const adapter = new FalVideoProvider(fetch);
    expect(await adapter.cancel(credential, handle)).toBe('requested');
    expect(await adapter.cancel(credential, handle)).toBe('completed');
    expect(await adapter.cancel(credential, handle)).toBe('missing');
  });
  it('reads current account pricing, accounts for duration and refuses unknown billing units', async () => {
    const endpoint = 'fal-ai/wan/v2.7/text-to-video';
    const fetch = vi.fn().mockResolvedValueOnce(json({ prices: [{ endpoint_id: endpoint, unit_price: 0.05, unit: 'second', currency: 'USD' }] })).mockResolvedValueOnce(json({ total_cost: 0.25, currency: 'USD' }));
    expect(await new FalVideoProvider(fetch).estimate(credential, creativeConfigSchema.parse({}))).toEqual({ estimatedCents: 25, reservedCents: 100 });
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ estimate_type: 'unit_price', endpoints: { [endpoint]: { unit_quantity: 5 } } });
    const unknown = vi.fn().mockResolvedValue(json({ prices: [{ endpoint_id: endpoint, unit_price: 0.05, unit: 'compute_unit', currency: 'USD' }] }));
    await expect(new FalVideoProvider(unknown).estimate(credential, creativeConfigSchema.parse({}))).rejects.toMatchObject({ code: 'creative_billing_units_required', billing: { unit: 'compute_unit', unitPrice: 0.05, currency: 'USD' } });
    expect(unknown).toHaveBeenCalledTimes(1);
  });
  it('exchanges a short-lived CDN token without forwarding the API key to media hosts', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(json({ token: 'synthetic-cdn-token' })).mockResolvedValueOnce(new Response(new Uint8Array(32), { headers: { 'content-type': 'video/mp4' } }));
    const adapter = new FalVideoProvider(fetch);
    const video = { url: 'https://v3b.fal.media/files/example/video.mp4', size: 32, width: null, height: null, duration: null, fps: null };
    const response = await adapter.download(credential, video);
    await response.body?.cancel();
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ expiration_seconds: 300 });
    expect(fetch.mock.calls[1][1].headers).toEqual({ Authorization: 'Bearer synthetic-cdn-token' });
    expect(fetch.mock.calls[1][1].redirect).toBe('manual');
    expect(JSON.stringify(fetch.mock.calls[1])).not.toContain(credential);
  });
  it('accepts a confirmed zero-price quote without inventing a charge', async () => {
    const endpoint = 'fal-ai/wan/v2.7/text-to-video';
    const fetch = vi.fn().mockResolvedValueOnce(json({ prices: [{ endpoint_id: endpoint, unit_price: 0, unit: 'second', currency: 'USD' }] })).mockResolvedValueOnce(json({ total_cost: 0, currency: 'USD' }));
    expect(await new FalVideoProvider(fetch).estimate(credential, creativeConfigSchema.parse({}))).toEqual({ estimatedCents: 0, reservedCents: 0 });
  });
  it('refuses local outputs, oversized media and forwarded redirects', async () => {
    for (const url of ['http://127.0.0.1:5199/secret', 'file:///etc/passwd', 'https://v3b.fal.media.evil.test/a', 'https://user:pass@v3b.fal.media/a']) {
      const fetch = vi.fn();
      await expect(new FalVideoProvider(fetch).download(credential, { url, size: null, width: null, height: null, duration: null, fps: null })).rejects.toThrow();
      expect(fetch).not.toHaveBeenCalled();
    }
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { location: 'http://localhost/' } }));
    await expect(new FalVideoProvider(fetch).download(credential, { url: 'https://storage.googleapis.com/fal-output/a.mp4', size: null, width: null, height: null, duration: null, fps: null })).rejects.toThrow('creative_download_failed');
    expect(fetch.mock.calls[0][1].headers).toEqual({});
  });
});
