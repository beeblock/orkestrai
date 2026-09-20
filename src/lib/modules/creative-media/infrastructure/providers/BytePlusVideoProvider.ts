import { z } from 'zod';
import type { CreativeConfig } from '../../contracts/schemas/creative-media.schema.js';
import type { FalModelContract, FalModelPrice } from '../../domain/model-contract.js';
import { BYTEPLUS_MODELS } from '../../domain/byteplus-models.js';
import { genericFalInput } from '../../domain/model-input.js';
import { CreativeMediaError } from '../../domain/types.js';
import { validateFalParameters } from '../../application/services/FalModelCatalogService.js';
import type { CreativeRemoteHandle, CreativeRemoteVideo, CreativeVideoProvider } from '../../application/ports/CreativeVideoProvider.js';
import { downloadProviderVideo, providerUrl, VideoProviderHttp } from './video-provider-http.js';

const ORIGIN = 'https://ark.ap-southeast.bytepluses.com';
const TASKS = '/api/v3/contents/generations/tasks';
const idSchema = z.string().regex(/^cgt-[a-zA-Z0-9-]{8,100}$/);
const stateSchema = z.object({ id: idSchema, status: z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled', 'expired']) });
export function byteplusHandle(id: string): CreativeRemoteHandle {
  if (!idSchema.safeParse(id).success) throw new CreativeMediaError('creative_invalid_provider_response', 502);
  const url = `${ORIGIN}${TASKS}/${id}`;
  return { requestId: id, statusUrl: url, responseUrl: url, cancelUrl: url };
}
function checkedHandle(handle: CreativeRemoteHandle) {
  const expected = byteplusHandle(handle.requestId);
  if (Object.keys(expected).some(key => expected[key as keyof CreativeRemoteHandle] !== handle[key as keyof CreativeRemoteHandle])) throw new CreativeMediaError('creative_unsafe_provider_url', 502);
  return expected;
}
export function byteplusInput(config: CreativeConfig, prompt: string, media: Record<string, string>, contract?: FalModelContract) {
  if (config.provider !== 'byteplus' || !contract || !BYTEPLUS_MODELS.some(model => model.id === config.modelId)) throw new CreativeMediaError('creative_provider_mismatch');
  const input = genericFalInput(config, prompt, media, contract);
  validateFalParameters(contract, input);
  const { prompt: text, first_image_url, last_image_url, image_urls, video_urls, audio_urls, ...parameters } = input;
  const images = (image_urls ?? []) as string[], videos = (video_urls ?? []) as string[], audio = (audio_urls ?? []) as string[];
  if (last_image_url && !first_image_url) throw new CreativeMediaError('creative_reference_required');
  if (first_image_url && (images.length || videos.length || audio.length)) throw new CreativeMediaError('creative_byteplus_input_modes');
  const is25 = config.modelId === BYTEPLUS_MODELS[0].id;
  if (is25 && first_image_url && input.ratio !== 'adaptive') throw new CreativeMediaError('creative_byteplus_input_modes');
  if (!is25 && audio.length && !images.length && !videos.length) throw new CreativeMediaError('creative_reference_required');
  const content: Record<string, unknown>[] = [{ type: 'text', text }];
  const add = (type: string, url: unknown, role: string) => { if (url) content.push({ type, [type]: { url }, role }); };
  add('image_url', first_image_url, 'first_frame'); add('image_url', last_image_url, 'last_frame');
  for (const url of images) add('image_url', url, 'reference_image');
  for (const url of videos) add('video_url', url, 'reference_video');
  for (const url of audio) add('audio_url', url, 'reference_audio');
  return { model: config.modelId, content, ...parameters, ...(is25 && (images.length || videos.length || audio.length) ? { omni_reference_task_type: 'reference' } : {}) };
}
export class BytePlusVideoProvider implements CreativeVideoProvider {
  private readonly http: VideoProviderHttp;
  constructor(private readonly fetchFn: typeof fetch = fetch) { this.http = new VideoProviderHttp(ORIGIN, 'Bearer', fetchFn); }
  async prepareMedia(_credential: string, media: Record<string, string>) {
    let size = 0;
    for (const [pointer, value] of Object.entries(media)) {
      // ModelArk accepts image/audio base64, but video references must be public URLs.
      // Never upload workspace video to an unrelated provider or public host implicitly.
      if (/video/i.test(pointer)) throw new CreativeMediaError('creative_byteplus_video_url_required');
      if (!/^data:(?:image\/(?:jpeg|png|webp)|audio\/(?:wav|mpeg|mp3));base64,[a-zA-Z0-9+/=]+$/.test(value)) throw new CreativeMediaError('creative_reference_invalid');
      size += value.length;
    }
    if (size > 60 * 1024 * 1024) throw new CreativeMediaError('creative_reference_size');
    return media;
  }
  async prices(_credential: string, ids: string[]): Promise<FalModelPrice[]> {
    return BYTEPLUS_MODELS.filter(model => ids.includes(model.id)).map(model => ({ endpointId: model.id, currency: 'USD', unit: 'million tokens (720p, no video input)', unitPrice: model.rates['720p'][0], priceSource: 'public_list', priceVerifiedAt: '2026-09-20' }));
  }
  async estimate(_credential: string, config: CreativeConfig, contract?: FalModelContract) {
    if (config.mediaBindings.some(binding => /video/i.test(binding.pointer))) throw new CreativeMediaError('creative_byteplus_video_url_required');
    const media = Object.fromEntries(config.mediaBindings.map(binding => [binding.pointer, 'https://media.invalid/reference']));
    byteplusInput(config, config.prompt || 'Preview', media, contract);
    const model = BYTEPLUS_MODELS.find(model => model.id === config.modelId)!;
    const resolution = String(config.parameters.resolution);
    const hasVideo = Array.isArray(config.parameters.video_urls) && config.parameters.video_urls.length > 0;
    const rate = (model.rates as Record<string, readonly number[]>)[resolution]?.[hasVideo ? 1 : 0];
    const pixels = ({ '480p': 409600, '720p': 921600, '1080p': 2073600, '4k': 8294400 } as Record<string, number>)[resolution];
    const duration = Number(config.parameters.duration);
    if (!rate || !pixels || !Number.isFinite(duration)) throw new CreativeMediaError('creative_estimate_unavailable');
    // Public video URLs have unknown durations. Reserve the documented maximum input
    // duration, including minimum token floors, instead of pricing them as still images.
    const seconds = duration + (hasVideo ? model.duration : 0);
    const estimatedCents = Math.ceil(seconds * pixels * 24 / 1024 / 1000000 * rate * 100);
    return { estimatedCents, reservedCents: estimatedCents * 4, priceSource: 'public_list' as const, priceVerifiedAt: '2026-09-20' };
  }
  async submit(credential: string, config: CreativeConfig, prompt: string, refs: { media?: Record<string, string> }, contract?: FalModelContract) {
    const body = JSON.stringify(byteplusInput(config, prompt, refs.media ?? {}, contract));
    if (Buffer.byteLength(body) > 64 * 1024 * 1024) throw new CreativeMediaError('creative_reference_size');
    const response = await this.http.request(TASKS, credential, { method: 'POST', body });
    const parsed = z.object({ id: idSchema }).safeParse(response.json);
    if (!parsed.success) throw new CreativeMediaError('creative_invalid_provider_response', 502);
    return byteplusHandle(parsed.data.id);
  }
  async status(credential: string, handle: CreativeRemoteHandle) {
    const response = await this.http.request(checkedHandle(handle).statusUrl, credential);
    const parsed = stateSchema.safeParse(response.json);
    if (!parsed.success || parsed.data.id !== handle.requestId) throw new CreativeMediaError('creative_invalid_provider_response', 502);
    const statuses = { queued: 'queued', running: 'running', succeeded: 'completed', failed: 'failed', expired: 'failed', cancelled: 'cancelled' } as const;
    return { status: statuses[parsed.data.status], queuePosition: null };
  }
  async cancel(credential: string, handle: CreativeRemoteHandle): Promise<'requested' | 'completed' | 'missing'> {
    // DELETE is not conditional: a queued job can finish between GET and DELETE,
    // which would erase its only result. Once submitted, retain/poll the job instead.
    const state = await this.status(credential, checkedHandle(handle));
    return state.status === 'cancelled' ? 'requested' : 'completed';
  }
  async result(credential: string, handle: CreativeRemoteHandle): Promise<CreativeRemoteVideo> {
    const response = await this.http.request(checkedHandle(handle).responseUrl, credential);
    const parsed = stateSchema.extend({ content: z.object({ video_url: z.string().max(8192) }), duration: z.number().positive().max(120).optional(), framespersecond: z.number().positive().max(120).optional(), output_format: z.enum(['mp4', 'mov']).optional() }).safeParse(response.json);
    if (!parsed.success || parsed.data.id !== handle.requestId || parsed.data.status !== 'succeeded') throw new CreativeMediaError('creative_invalid_provider_response', 502);
    const data = parsed.data;
    return { url: providerUrl(data.content.video_url, [], ['volces.com', 'bytepluses.com']).href, mimeType: data.output_format === 'mov' ? 'video/quicktime' : 'video/mp4', size: null, width: null, height: null, duration: data.duration ?? null, fps: data.framespersecond ?? null };
  }
  download(_credential: string, video: CreativeRemoteVideo) { return downloadProviderVideo(this.fetchFn, video, [], ['volces.com', 'bytepluses.com']); }
}
