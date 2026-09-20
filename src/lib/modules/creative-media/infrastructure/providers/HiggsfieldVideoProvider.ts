import { z } from 'zod';
import type { CreativeConfig } from '../../contracts/schemas/creative-media.schema.js';
import type { FalModelContract, FalModelPrice } from '../../domain/model-contract.js';
import catalog from '../../domain/higgsfield-video-contracts.json';
import { genericFalInput } from '../../domain/model-input.js';
import { CreativeMediaError } from '../../domain/types.js';
import { videoMimeFromPath } from '../../domain/video-format.js';
import { validateFalParameters } from '../../application/services/FalModelCatalogService.js';
import type { CreativeEstimateContext, CreativeRemoteHandle, CreativeRemoteVideo, CreativeVideoProvider } from '../../application/ports/CreativeVideoProvider.js';
import { downloadProviderVideo, providerUrl, VideoProviderHttp } from './video-provider-http.js';

const ORIGIN = 'https://api.higgsfield.ai';
const storageSuffixes = ['higgsfield.ai', 'cloudfront.net', 'amazonaws.com', 'r2.cloudflarestorage.com'];
const idSchema = z.string().uuid();
const stateSchema = z.object({ request_id: idSchema, status: z.enum(['queued', 'in_progress', 'completed', 'failed', 'nsfw', 'canceled']) });
export function higgsfieldHandle(id: string): CreativeRemoteHandle {
  if (!idSchema.safeParse(id).success) throw new CreativeMediaError('creative_invalid_provider_response', 502);
  const root = `${ORIGIN}/requests/${id}`;
  return { requestId: id, statusUrl: `${root}/status`, responseUrl: `${root}/status`, cancelUrl: `${root}/cancel` };
}
function checkedHandle(handle: CreativeRemoteHandle) {
  const expected = higgsfieldHandle(handle.requestId);
  if (Object.keys(expected).some(key => handle[key as keyof CreativeRemoteHandle] !== expected[key as keyof CreativeRemoteHandle])) throw new CreativeMediaError('creative_unsafe_provider_url', 502);
  return expected;
}
export function higgsfieldInput(config: CreativeConfig, prompt: string, media: Record<string, string>, contract?: FalModelContract) {
  if (config.provider !== 'higgsfield' || !contract) throw new CreativeMediaError('creative_provider_mismatch');
  const input = genericFalInput(config, prompt, media, contract);
  validateFalParameters(contract, input);
  return input;
}
export class HiggsfieldVideoProvider implements CreativeVideoProvider {
  private readonly http: VideoProviderHttp;
  readonly estimateNeedsMedia = true;
  constructor(private readonly fetchFn: typeof fetch = fetch) { this.http = new VideoProviderHttp(ORIGIN, 'Key', fetchFn); }

  async prices(_credential: string, ids: string[]): Promise<FalModelPrice[]> {
    return catalog.models.flatMap(model => ids.includes(model.id) && model.publicPrice
      ? [{ endpointId: model.id, ...model.publicPrice, currency: 'USD' as const, priceSource: 'public_list' as const, priceVerifiedAt: catalog.fetchedAt.slice(0, 10) }] : []);
  }

  async prepareMedia(credential: string, media: Record<string, string>) {
    const result: Record<string, string> = {}, uploaded = new Map<string, string>();
    for (const [pointer, value] of Object.entries(media)) {
      const previous = uploaded.get(value);
      if (previous) { result[pointer] = previous; continue; }
      const match = /^data:(image\/(?:jpeg|png|webp|gif)|audio\/(?:wav|x-wav)|video\/mp4);base64,([a-zA-Z0-9+/=]+)$/.exec(value);
      if (!match || value.length > 90 * 1024 * 1024) throw new CreativeMediaError('creative_reference_invalid');
      const response = await this.http.request('/files/generate-upload-url', credential, { method: 'POST', body: JSON.stringify({ content_type: match[1] }) });
      const parsed = z.object({ public_url: z.string().max(8192), upload_url: z.string().max(8192), content_type: z.string().max(100), upload_headers: z.record(z.string().max(2000)).refine(value => Object.keys(value).length <= 10) }).safeParse(response.json);
      if (!parsed.success || parsed.data.content_type !== match[1]) throw new CreativeMediaError('creative_invalid_provider_response', 502);
      const upload = providerUrl(parsed.data.upload_url, [], storageSuffixes);
      const output = providerUrl(parsed.data.public_url, [], storageSuffixes);
      const headers = parsed.data.upload_headers;
      if (Object.keys(headers).some(key => !/^(?:content-type|x-amz-[a-z-]+)$/i.test(key)) || Object.values(headers).some(value => /[\r\n]/.test(value))) throw new CreativeMediaError('creative_invalid_provider_response', 502);
      try {
        const response = await this.fetchFn(upload, { method: 'PUT', headers, body: Buffer.from(match[2], 'base64'), redirect: 'manual', signal: AbortSignal.timeout(120000) });
        await response.body?.cancel();
        if (!response.ok) throw new Error();
      } catch { throw new CreativeMediaError('creative_reference_upload_failed', 502); }
      result[pointer] = output.href; uploaded.set(value, output.href);
    }
    return result;
  }
  async estimate(credential: string, config: CreativeConfig, contract?: FalModelContract, context?: CreativeEstimateContext) {
    if (!context) throw new CreativeMediaError('creative_estimate_unavailable');
    const media = await this.prepareMedia(credential, context.media);
    const input = higgsfieldInput(config, context.prompt, media, contract);
    const response = await this.http.request(`/estimate/${config.modelId}`, credential, { method: 'POST', body: JSON.stringify(input) });
    const parsed = z.object({ usd: z.string().regex(/^\d{1,4}(?:\.\d{1,8})?$/) }).safeParse(response.json);
    if (!parsed.success || Number(parsed.data.usd) > 1000) throw new CreativeMediaError('creative_estimate_unavailable', 502);
    const estimatedCents = Math.ceil(Number(parsed.data.usd) * 100);
    return { estimatedCents, reservedCents: estimatedCents, priceSource: 'account_quote' as const };
  }
  async submit(credential: string, config: CreativeConfig, prompt: string, refs: { media?: Record<string, string> }, contract?: FalModelContract) {
    const body = higgsfieldInput(config, prompt, refs.media ?? {}, contract);
    const response = await this.http.request(`/${config.modelId}`, credential, { method: 'POST', body: JSON.stringify(body) });
    const parsed = stateSchema.extend({ status_url: z.string(), cancel_url: z.string() }).safeParse(response.json);
    if (!parsed.success) throw new CreativeMediaError('creative_invalid_provider_response', 502);
    return checkedHandle({ ...higgsfieldHandle(parsed.data.request_id), statusUrl: parsed.data.status_url, cancelUrl: parsed.data.cancel_url });
  }
  async status(credential: string, handle: CreativeRemoteHandle) {
    const response = await this.http.request(checkedHandle(handle).statusUrl, credential);
    const parsed = stateSchema.safeParse(response.json);
    if (!parsed.success || parsed.data.request_id !== handle.requestId) throw new CreativeMediaError('creative_invalid_provider_response', 502);
    const statuses = { queued: 'queued', in_progress: 'running', completed: 'completed', failed: 'failed', nsfw: 'failed', canceled: 'cancelled' } as const;
    return { status: statuses[parsed.data.status], queuePosition: null };
  }
  async cancel(credential: string, handle: CreativeRemoteHandle): Promise<'requested' | 'completed' | 'missing'> {
    const response = await this.http.request(checkedHandle(handle).cancelUrl, credential, { method: 'POST' }, [400, 404]);
    if (response.status === 202) return 'requested';
    if (response.status === 404) return 'missing';
    if (response.status === 400) return 'completed';
    throw new CreativeMediaError('creative_cancel_unconfirmed', 502);
  }
  async result(credential: string, handle: CreativeRemoteHandle): Promise<CreativeRemoteVideo> {
    const response = await this.http.request(checkedHandle(handle).responseUrl, credential);
    const parsed = stateSchema.extend({ video: z.object({ url: z.string().max(8192) }) }).safeParse(response.json);
    if (!parsed.success || parsed.data.request_id !== handle.requestId || parsed.data.status !== 'completed') throw new CreativeMediaError('creative_invalid_provider_response', 502);
    const url = providerUrl(parsed.data.video.url, [], storageSuffixes).href;
    return { url, mimeType: videoMimeFromPath(url), size: null, width: null, height: null, duration: null, fps: null };
  }
  download(_credential: string, video: CreativeRemoteVideo) { return downloadProviderVideo(this.fetchFn, video, [], storageSuffixes); }
}
