const MAX_RESPONSE_BYTES = 1_048_576;

export type TrustedHttpResponse = {
  status: number;
  ok: boolean;
  json: unknown;
};

async function readBytes(response: Response, maximum = MAX_RESPONSE_BYTES): Promise<Uint8Array> {
  const declared = Number(response.headers.get('content-length') ?? 0);
  if (declared > maximum) throw new Error('Integration response exceeded the allowed size.');
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) {
        await reader.cancel();
        throw new Error('Integration response exceeded the allowed size.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

export class TrustedIntegrationHttpClient {
  constructor(private readonly fetchFn: typeof fetch = fetch) {}

  async request(url: string, init: RequestInit = {}): Promise<TrustedHttpResponse> {
    const response = await this.fetchFn(url, {
      ...init,
      redirect: 'manual',
      signal: init.signal ?? AbortSignal.timeout(30_000),
    });
    if (response.status >= 300 && response.status < 400) {
      throw new Error('Integration redirects are not followed.');
    }
    const text = new TextDecoder().decode(await readBytes(response));
    let json: unknown = {};
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = { text: text.slice(0, 20_000) };
      }
    }
    return { status: response.status, ok: response.ok, json };
  }

  /** Callers supply only provider-validated HTTPS hosts, never arbitrary message URLs. */
  async download(url: string, init: RequestInit = {}, maximum = 10 * 1024 * 1024): Promise<Uint8Array> {
    const response = await this.fetchFn(url, { ...init, redirect: 'manual', signal: init.signal ?? AbortSignal.timeout(30_000) });
    if (!response.ok || response.status >= 300) throw new Error('Integration attachment download failed.');
    return readBytes(response, maximum);
  }
}
