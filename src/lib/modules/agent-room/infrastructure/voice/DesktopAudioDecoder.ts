import { randomUUID } from 'node:crypto';

type Pending = { resolve: (value: Buffer) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };
const state = globalThis as typeof globalThis & { __orkestraiAudioPending?: Map<string, Pending>; __orkestraiAudioListener?: boolean };
const pending = state.__orkestraiAudioPending ??= new Map<string, Pending>();

if (!state.__orkestraiAudioListener) {
  process.on('message', (message: unknown) => {
    const response = message as { type?: string; requestId?: string; base64?: string; error?: string } | null;
    if (response?.type !== 'orkestrai:audio:result' || !response.requestId) return;
    const request = pending.get(response.requestId);
    if (!request) return;
    clearTimeout(request.timer); pending.delete(response.requestId);
    if (response.error || typeof response.base64 !== 'string' || response.base64.length > 26_000_000) request.reject(new Error('Local audio decoding failed. No transcription was produced.'));
    else request.resolve(Buffer.from(response.base64, 'base64'));
  });
  process.on('disconnect', () => {
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error('Desktop audio decoder disconnected.')); }
    pending.clear();
  });
  state.__orkestraiAudioListener = true;
}

export async function decodeDesktopAudio(bytes: Buffer): Promise<Buffer> {
  if (typeof process.send !== 'function') throw new Error('Compressed audio transcription requires the installed desktop app.');
  if (!bytes.length || bytes.length > 10 * 1024 * 1024) throw new Error('Compressed recordings must be at most 10 MiB and 10 minutes.');
  if (pending.size) throw new Error('Another local audio decode is already running.');
  const requestId = randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(requestId); reject(new Error('Local audio decoding timed out.')); }, 20_000);
    timer.unref();
    pending.set(requestId, { resolve, reject, timer });
    process.send!({ type: 'orkestrai:audio:decode', requestId, base64: bytes.toString('base64') }, error => {
      if (!error) return;
      clearTimeout(timer); pending.delete(requestId); reject(new Error('Desktop audio decoder is unavailable.'));
    });
  });
}
