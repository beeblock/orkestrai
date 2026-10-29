import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { z } from '@beeblock/svelar/validation';

export const delegatedImageInput = z.object({
  id: z.string().uuid(), prompt: z.string().min(1).max(32000), transparentBackground: z.boolean(),
  references: z.array(z.object({ mime: z.enum(['image/png','image/jpeg','image/webp']), data: z.string().min(4).max(8 * 1024 * 1024).regex(/^[A-Za-z0-9+/]+={0,2}$/) }).strict()).max(5),
}).strict();
/** Official Codex ImagesClient contract; one request, no transport retries, no host path inputs. */
export async function delegatedCodexImage(input: z.infer<typeof delegatedImageInput>, profileEnv: Record<string,string>, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<Buffer> {
  const authPath = join(profileEnv.CODEX_HOME ?? join(homedir(), '.codex'), 'auth.json');
  let auth: any;
  try { if ((await stat(authPath)).size > 128 * 1024) throw new Error(); auth = JSON.parse(await readFile(authPath, 'utf8')); } catch { throw new Error('INFERENCE_IMAGE_AUTH_UNAVAILABLE'); }
  const token = auth?.tokens?.access_token, account = auth?.tokens?.account_id;
  if (typeof token !== 'string' || !token || typeof account !== 'string' || !account) throw new Error('INFERENCE_IMAGE_AUTH_UNAVAILABLE');
  const endpoint = input.references.length ? 'edits' : 'generations';
  const body = { model: 'gpt-image-2', prompt: input.prompt, n: 1, background: input.transparentBackground ? 'transparent' : 'opaque', quality: 'auto', ...(input.references.length ? { images: input.references.map(image => ({ image_url: `data:${image.mime};base64,${image.data}` })) } : {}) };
  let response: Response;
  try {
    response = await fetcher(`https://chatgpt.com/backend-api/codex/images/${endpoint}`, { method: 'POST', redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(5 * 60_000)]), headers: { authorization: `Bearer ${token}`, 'chatgpt-account-id': account, 'content-type': 'application/json', originator: 'orkestrai', 'x-codex-image-turn-id': input.id }, body: JSON.stringify(body) });
  } catch { throw new Error(signal.aborted ? 'INFERENCE_CANCELLED' : 'INFERENCE_IMAGE_UNCONFIRMED'); }
  if (!response.ok) { await response.body?.cancel(); throw new Error(response.status === 401 ? 'INFERENCE_IMAGE_AUTH_UNAVAILABLE' : response.status === 429 ? 'INFERENCE_IMAGE_LIMIT' : response.status >= 500 ? 'INFERENCE_IMAGE_UNCONFIRMED' : 'INFERENCE_IMAGE_REJECTED'); }
  if (!response.body) throw new Error('INFERENCE_IMAGE_UNCONFIRMED');
  const chunks: Buffer[] = []; let size = 0;
  for await (const part of response.body as unknown as AsyncIterable<Uint8Array>) { size += part.length; if (size > 28 * 1024 * 1024) { await response.body.cancel().catch(() => {}); throw new Error('INFERENCE_IMAGE_OUTPUT_LIMIT'); } chunks.push(Buffer.from(part)); }
  let value: unknown; try { value = JSON.parse(Buffer.concat(chunks, size).toString('utf8')); } catch { throw new Error('INFERENCE_IMAGE_UNCONFIRMED'); }
  const parsed = z.object({ data: z.array(z.object({ b64_json: z.string().max(27 * 1024 * 1024).regex(/^[A-Za-z0-9+/]+={0,2}$/) })).length(1) }).safeParse(value);
  if (!parsed.success) throw new Error('INFERENCE_IMAGE_UNCONFIRMED');
  const bytes = Buffer.from(parsed.data.data[0].b64_json, 'base64');
  if (bytes.length > 20 * 1024 * 1024 || bytes.length < 24 || !bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw new Error('INFERENCE_IMAGE_OUTPUT_LIMIT');
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  if (!width || !height || width * height > 64 * 1024 * 1024) throw new Error('INFERENCE_IMAGE_OUTPUT_LIMIT');
  return bytes;
}
