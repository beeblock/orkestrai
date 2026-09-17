import { z } from '@beeblock/svelar/validation';
import { TrustedIntegrationHttpClient } from '$lib/modules/agent-room/infrastructure/integrations/TrustedIntegrationHttpClient.js';
import type { CreativeConfig } from '../../contracts/schemas/creative-media.schema.js';
import { CREATIVE_MODELS, MAX_CREATIVE_VIDEO_BYTES } from '../../domain/catalog.js';
import { CreativeMediaError } from '../../domain/types.js';
import type { CreativeProviderStatus, CreativeRemoteHandle, CreativeRemoteVideo, CreativeVideoProvider } from '../../application/ports/CreativeVideoProvider.js';

const queueId = z.string().regex(/^[a-zA-Z0-9_-]{16,128}$/);
const remoteSchema = z.object({ requestId: queueId, statusUrl: z.string().max(2048), responseUrl: z.string().max(2048), cancelUrl: z.string().max(2048) }).strict();
const fileSchema = z.object({
  url: z.string().max(4096), content_type: z.literal('video/mp4').nullish(),
  file_size: z.number().int().positive().max(MAX_CREATIVE_VIDEO_BYTES).nullish(),
  width: z.number().int().positive().max(16384).nullish(), height: z.number().int().positive().max(16384).nullish(),
  duration: z.number().positive().max(600).nullish(), fps: z.number().positive().max(240).nullish(),
});
const videoHosts = new Set(['v3.fal.media', 'v3b.fal.media', 'fal.media', 'storage.googleapis.com']);

function safeUrl(value: string, hosts: Set<string>): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new CreativeMediaError('creative_unsafe_provider_url', 502); }
  if (url.protocol !== 'https:' || !hosts.has(url.hostname) || url.username || url.password || url.port || url.hash) {
    throw new CreativeMediaError('creative_unsafe_provider_url', 502);
  }
  return url;
}

export function validateFalHandle(input: unknown): CreativeRemoteHandle {
  const parsed = remoteSchema.safeParse(input);
  if (!parsed.success) throw new CreativeMediaError('creative_invalid_provider_response', 502);
  const handle = parsed.data;
  let root: string | null = null;
  for (const [key, suffixes] of [['statusUrl', ['/status']], ['responseUrl', ['', '/response']], ['cancelUrl', ['/cancel']]] as const) {
    const url = safeUrl(handle[key], new Set(['queue.fal.run']));
    const marker = `/requests/${handle.requestId}`;
    const offset = url.pathname.indexOf(marker);
    const prefix = url.pathname.slice(0, offset);
    const suffix = url.pathname.slice(offset + marker.length);
    if (url.search || offset < 0 || !/^\/fal-ai\/[a-zA-Z0-9_/-]+$/.test(prefix) || !suffixes.some(value => value === suffix) || (root && root !== prefix)) {
      throw new CreativeMediaError('creative_unsafe_provider_url', 502);
    }
    root = prefix;
  }
  return handle;
}

function keyHeaders(credential: string): Record<string, string> {
  if (!/^[\x21-\x7e]{8,512}$/.test(credential)) throw new CreativeMediaError('creative_credential_missing', 403);
  return { Authorization: `Key ${credential}`, 'Content-Type': 'application/json' };
}

export function falVideoInput(config: CreativeConfig, prompt: string, refs: { start?: string; end?: string }): Record<string, unknown> {
  const model = CREATIVE_MODELS[config.modelId];
  if (!prompt.trim() || prompt.length > model.promptLimit) throw new CreativeMediaError('creative_prompt_too_long');
  if (model.startImage) {
    if (!refs.start) throw new CreativeMediaError('creative_reference_required');
    return { prompt, duration: String(config.duration), start_image_url: refs.start,
      ...(refs.end ? { end_image_url: refs.end } : {}), generate_audio: config.generateAudio,
      negative_prompt: config.negativePrompt, cfg_scale: 0.5 };
  }
  return { prompt, duration: config.duration, aspect_ratio: config.aspectRatio, resolution: config.resolution,
    negative_prompt: config.negativePrompt, enable_prompt_expansion: false, enable_safety_checker: true,
    ...(config.seed !== null ? { seed: config.seed } : {}) };
}

export class FalVideoProvider implements CreativeVideoProvider {
  private readonly http: TrustedIntegrationHttpClient;
  constructor(private readonly fetchFn: typeof fetch = fetch) { this.http = new TrustedIntegrationHttpClient(fetchFn); }

  private async request(url: string, credential: string, init: RequestInit = {}) {
    try {
      const response = await this.http.request(url, { ...init, headers: { ...keyHeaders(credential), ...init.headers }, signal: AbortSignal.timeout(25000) });
      if (!response.ok) throw new CreativeMediaError(
        response.status === 401 || response.status === 403 ? 'creative_credential_rejected'
          : response.status === 429 ? 'creative_rate_limited'
            : response.status === 422 ? 'creative_provider_rejected' : 'creative_provider_unavailable', 502,
      );
      return response.json;
    } catch (error) {
      if (error instanceof CreativeMediaError) throw error;
      // Fetch errors may contain URLs or echoed credentials. Never persist them.
      throw new CreativeMediaError('creative_provider_unavailable', 502);
    }
  }

  async estimate(credential: string, config: CreativeConfig) {
    const endpoint = CREATIVE_MODELS[config.modelId].endpoint;
    const response = await this.request(`https://api.fal.ai/v1/models/pricing?endpoint_id=${encodeURIComponent(endpoint)}`, credential);
    const parsed = z.object({ prices: z.array(z.object({ endpoint_id: z.string().max(200), unit_price: z.number().finite().positive().max(1000), unit: z.string().max(80), currency: z.literal('USD') })).max(50) }).safeParse(response);
    const price = parsed.success ? parsed.data.prices.find(value => value.endpoint_id === endpoint) : null;
    if (!price) throw new CreativeMediaError('creative_estimate_unavailable', 502);
    const unit = price.unit.toLowerCase();
    const quantity = ['second', 'seconds', 's'].includes(unit) ? config.duration : ['video', 'videos'].includes(unit) ? 1 : null;
    if (quantity === null) throw new CreativeMediaError('creative_estimate_unavailable', 502);
    const estimate = await this.request('https://api.fal.ai/v1/models/pricing/estimate', credential, {
      method: 'POST', body: JSON.stringify({ estimate_type: 'unit_price', endpoints: { [endpoint]: { unit_quantity: quantity } } }),
    });
    const result = z.object({ total_cost: z.number().finite().positive().max(1000), currency: z.literal('USD') }).safeParse(estimate);
    if (!result.success) throw new CreativeMediaError('creative_estimate_unavailable', 502);
    const estimatedCents = Math.ceil(Math.max(result.data.total_cost, price.unit_price * quantity) * 100);
    // Account pricing is a base-unit estimate, not an input-aware billing cap.
    // Reserve headroom for model-specific audio/resolution multipliers and disclose it.
    return { estimatedCents, reservedCents: estimatedCents * 4 };
  }

  async submit(credential: string, config: CreativeConfig, prompt: string, refs: { start?: string; end?: string }) {
    const input = falVideoInput(config, prompt, refs);
    const response = await this.request(`https://queue.fal.run/${CREATIVE_MODELS[config.modelId].endpoint}`, credential, {
      method: 'POST', headers: {
        'X-Fal-Store-IO': '0', 'X-Fal-No-Retry': '1', 'x-app-fal-disable-fallback': 'true',
        'X-Fal-Object-Lifecycle-Preference': JSON.stringify({ expiration_duration_seconds: 3600, initial_acl: { default: 'forbid', rules: [] } }),
      }, body: JSON.stringify(input),
    });
    const result = z.object({ request_id: queueId, status_url: z.string(), response_url: z.string(), cancel_url: z.string() }).safeParse(response);
    if (!result.success) throw new CreativeMediaError('creative_invalid_provider_response', 502);
    return validateFalHandle({ requestId: result.data.request_id, statusUrl: result.data.status_url, responseUrl: result.data.response_url, cancelUrl: result.data.cancel_url });
  }

  async status(credential: string, input: CreativeRemoteHandle): Promise<CreativeProviderStatus> {
    const handle = validateFalHandle(input);
    const response = await this.request(handle.statusUrl, credential);
    const parsed = z.object({ status: z.enum(['IN_QUEUE', 'IN_PROGRESS', 'COMPLETED']), request_id: queueId.optional(), queue_position: z.number().int().min(0).max(1000000).nullish(), error: z.string().max(20000).nullish(), error_type: z.string().max(120).nullish() }).safeParse(response);
    if (!parsed.success || (parsed.data.request_id && parsed.data.request_id !== handle.requestId)) throw new CreativeMediaError('creative_invalid_provider_response', 502);
    const data = parsed.data;
    const cancelled = data.status === 'COMPLETED' && ['cancelled', 'canceled', 'request_cancelled', 'request_canceled'].includes(data.error_type ?? '');
    return { status: cancelled ? 'cancelled' : data.error || data.error_type ? 'failed' : data.status === 'COMPLETED' ? 'completed' : data.status === 'IN_PROGRESS' ? 'running' : 'queued', queuePosition: data.queue_position ?? null };
  }

  async cancel(credential: string, input: CreativeRemoteHandle): Promise<'requested' | 'completed' | 'missing'> {
    const handle = validateFalHandle(input);
    try {
      const result = await this.http.request(handle.cancelUrl, { method: 'PUT', headers: keyHeaders(credential), signal: AbortSignal.timeout(25000) });
      const status = z.object({ status: z.enum(['CANCELLATION_REQUESTED', 'ALREADY_COMPLETED', 'NOT_FOUND']) }).safeParse(result.json);
      if (status.success) {
        if (result.status === 202 && status.data.status === 'CANCELLATION_REQUESTED') return 'requested';
        if (result.status === 400 && status.data.status === 'ALREADY_COMPLETED') return 'completed';
        if (result.status === 404 && status.data.status === 'NOT_FOUND') return 'missing';
      }
      throw new CreativeMediaError('creative_cancel_unconfirmed', 502);
    } catch { throw new CreativeMediaError('creative_cancel_unconfirmed', 502); }
  }

  async result(credential: string, input: CreativeRemoteHandle): Promise<CreativeRemoteVideo> {
    const handle = validateFalHandle(input);
    const response = await this.request(handle.responseUrl, credential);
    const parsed = z.object({ video: fileSchema }).safeParse(response);
    if (!parsed.success) throw new CreativeMediaError('creative_invalid_provider_response', 502);
    const video = parsed.data.video;
    safeUrl(video.url, videoHosts);
    return { url: video.url, size: video.file_size ?? null, width: video.width ?? null, height: video.height ?? null, duration: video.duration ?? null, fps: video.fps ?? null };
  }

  async download(credential: string, video: CreativeRemoteVideo): Promise<Response> {
    const url = safeUrl(video.url, videoHosts);
    const headers: Record<string, string> = {};
    if (url.hostname === 'v3b.fal.media' || url.hostname === 'v3.fal.media') {
      const response = await this.request('https://rest.fal.ai/storage/auth/token?storage_type=fal-cdn-v3', credential, { method: 'POST', body: JSON.stringify({ expiration_seconds: 300 }) });
      const token = z.object({ token: z.string().min(1).max(8192).regex(/^[\x21-\x7e]+$/) }).safeParse(response);
      if (!token.success) throw new CreativeMediaError('creative_invalid_provider_response', 502);
      headers.Authorization = `Bearer ${token.data.token}`;
    }
    try {
      const response = await this.fetchFn(url, { headers, redirect: 'manual', signal: AbortSignal.timeout(120000) });
      const contentType = response.headers.get('content-type')?.split(';')[0].trim();
      if (!response.ok || !response.body || !['video/mp4', 'application/octet-stream'].includes(contentType ?? '') || Number(response.headers.get('content-length') ?? 0) > MAX_CREATIVE_VIDEO_BYTES) {
        await response.body?.cancel();
        throw new CreativeMediaError('creative_download_failed', 502);
      }
      return response;
    } catch { throw new CreativeMediaError('creative_download_failed', 502); }
  }
}
