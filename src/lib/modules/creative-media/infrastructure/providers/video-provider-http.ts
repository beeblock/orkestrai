import { TrustedIntegrationHttpClient } from '$lib/modules/agent-room/infrastructure/integrations/TrustedIntegrationHttpClient.js';
import { CreativeMediaError } from '../../domain/types.js';
import { MAX_CREATIVE_VIDEO_BYTES } from '../../domain/catalog.js';
import type { CreativeRemoteVideo } from '../../application/ports/CreativeVideoProvider.js';

export function providerUrl(value: string, hosts: readonly string[], suffixes: readonly string[] = []): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new CreativeMediaError('creative_unsafe_provider_url', 502); }
  if (value.length > 8192 || url.protocol !== 'https:' || url.username || url.password || url.port || url.hash
    || (!hosts.includes(url.hostname) && !suffixes.some(suffix => url.hostname.endsWith(`.${suffix}`)))) throw new CreativeMediaError('creative_unsafe_provider_url', 502);
  return url;
}

export class VideoProviderHttp {
  private readonly http: TrustedIntegrationHttpClient;
  constructor(readonly origin: string, private readonly scheme: 'Key' | 'Bearer', readonly fetchFn: typeof fetch = fetch) {
    this.http = new TrustedIntegrationHttpClient(fetchFn);
  }
  async request(path: string, credential: string, init: RequestInit = {}, allowed: number[] = []) {
    const url = providerUrl(new URL(path, this.origin).href, [new URL(this.origin).hostname]);
    if (!/^[\x21-\x7e]{8,512}$/.test(credential)) throw new CreativeMediaError('creative_credential_missing', 403);
    try {
      const result = await this.http.request(url.href, { ...init, headers: { 'Content-Type': 'application/json', Authorization: `${this.scheme} ${credential}` }, signal: AbortSignal.timeout(30000) });
      if (!result.ok && !allowed.includes(result.status)) throw new CreativeMediaError(
        [401, 403].includes(result.status) ? 'creative_credential_rejected' : result.status === 429 ? 'creative_rate_limited'
          : [400, 402, 422].includes(result.status) ? 'creative_provider_rejected' : 'creative_provider_unavailable', 502);
      return result;
    } catch (error) {
      if (error instanceof CreativeMediaError) throw error;
      throw new CreativeMediaError('creative_provider_unavailable', 502);
    }
  }
}

export async function downloadProviderVideo(fetchFn: typeof fetch, video: CreativeRemoteVideo, hosts: readonly string[], suffixes: readonly string[] = []) {
  const url = providerUrl(video.url, hosts, suffixes);
  try {
    // Storage URLs are signed capabilities, never destinations for API credentials.
    const response = await fetchFn(url, { redirect: 'manual', signal: AbortSignal.timeout(120000) });
    const mime = response.headers.get('content-type')?.split(';')[0].trim();
    if (!response.ok || !response.body || ![video.mimeType ?? 'video/mp4', 'application/octet-stream'].includes(mime ?? '') || Number(response.headers.get('content-length') ?? 0) > MAX_CREATIVE_VIDEO_BYTES) {
      await response.body?.cancel();
      throw new Error();
    }
    return response;
  } catch { throw new CreativeMediaError('creative_download_failed', 502); }
}
