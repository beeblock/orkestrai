import { createHash } from 'node:crypto';
import { MAX_INFERENCE_BODY_BYTES, type InferenceMessage } from '@orkestrai/collaboration-protocol/inference';

type Start = Extract<InferenceMessage, { type: 'body.start' }>;
type Assembly = { start: Start; chunks: Buffer[]; bytes: number; timer: ReturnType<typeof setTimeout> };
const budget = globalThis as typeof globalThis & { __orkestraiInferenceBodyBytes?: number };
const MAX_BUFFERED = 128 * 1024 * 1024;
/** One bounded assembly per peer. Binary input is never interpreted as a host path. */
export class InferenceBodies {
  private current: Assembly | null = null;
  constructor(private complete: (id: string, kind: Start['kind'], data: Buffer) => Promise<void>, private fail: () => void, private limit = MAX_INFERENCE_BODY_BYTES) {}
  async receive(message: InferenceMessage) {
    if (message.type === 'body.start') {
      if (this.current || message.size > this.limit || message.chunks !== Math.ceil(message.size / 49152)) throw new Error('INFERENCE_BODY_LIMIT');
      const timer = setTimeout(() => { this.clear(); this.fail(); }, Math.max(90_000,message.chunks*300+30_000)); timer.unref?.();
      this.current = { start: message, chunks: [], bytes: 0, timer };
    } else if (message.type === 'body.chunk') {
      const state = this.current;
      if (!state || message.requestId !== state.start.requestId || message.index !== state.chunks.length) throw new Error('INFERENCE_BODY_ORDER');
      const bytes = Buffer.from(message.data, 'base64url');
      if (bytes.toString('base64url') !== message.data || bytes.length > 49152 || !bytes.length || state.bytes + bytes.length > state.start.size) throw new Error('INFERENCE_BODY_LIMIT');
      if ((budget.__orkestraiInferenceBodyBytes ?? 0) + bytes.length > MAX_BUFFERED) { this.clear(); throw new Error('INFERENCE_BODY_LIMIT'); }
      budget.__orkestraiInferenceBodyBytes = (budget.__orkestraiInferenceBodyBytes ?? 0) + bytes.length;
      state.chunks.push(bytes); state.bytes += bytes.length;
    } else if (message.type === 'body.end') {
      const state = this.current;
      if (!state || state.start.requestId !== message.requestId || state.bytes !== state.start.size || state.chunks.length !== state.start.chunks) throw new Error('INFERENCE_BODY_INCOMPLETE');
      const body = Buffer.concat(state.chunks, state.bytes); this.clear();
      if (createHash('sha256').update(body).digest('hex') !== state.start.sha256) throw new Error('INFERENCE_BODY_HASH');
      await this.complete(message.requestId, state.start.kind, body);
    }
  }
  clear() { if (this.current) { clearTimeout(this.current.timer); budget.__orkestraiInferenceBodyBytes = Math.max(0,(budget.__orkestraiInferenceBodyBytes ?? 0)-this.current.bytes); } this.current = null; }
}

export async function sendInferenceBody(send: (message: InferenceMessage) => Promise<void>, id: string, kind: Start['kind'], body: Buffer, signal?: AbortSignal) {
  if (!body.length || body.length > MAX_INFERENCE_BODY_BYTES) throw new Error('INFERENCE_BODY_LIMIT');
  const chunks = Math.ceil(body.length / 49152);
  await send({ type: 'body.start', requestId: id, kind, size: body.length, chunks, sha256: createHash('sha256').update(body).digest('hex') });
  for (let index = 0; index < chunks; index++) {
    signal?.throwIfAborted();
    await send({ type: 'body.chunk', requestId: id, index, data: body.subarray(index * 49152, (index + 1) * 49152).toString('base64url') });
    // The relay's 1 MiB/s budget is SHARED by both directions. Reserve room for
    // simultaneous reference upload/image return, double base64 and control frames.
    if (index + 1 < chunks) await new Promise<void>((resolve, reject) => {
      const abort = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(new Error('INFERENCE_CANCELLED')); };
      const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, 220);
      signal?.addEventListener('abort', abort, { once: true });
    });
  }
  signal?.throwIfAborted(); await send({ type: 'body.end', requestId: id });
}
