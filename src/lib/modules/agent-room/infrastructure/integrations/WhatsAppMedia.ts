import { Agent } from 'undici';
import type { WAMessage, downloadMediaMessage } from '@whiskeysockets/baileys';

export function allowedWhatsAppMediaUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port
      && (url.hostname === 'whatsapp.net' || url.hostname.endsWith('.whatsapp.net'));
  } catch { return false; }
}

/** Bound the encrypted download and every redirect, before decoding/uploading it. */
export async function downloadWhatsAppMedia(message: WAMessage, downloader?: typeof downloadMediaMessage): Promise<Buffer> {
  const download = downloader ?? (await import('@whiskeysockets/baileys')).downloadMediaMessage;
  const agent = new Agent({ headersTimeout: 15_000, bodyTimeout: 15_000, connect: { timeout: 15_000 } });
  const dispatcher = agent.compose(dispatch => (options, handler) => {
    const url = new URL(String(options.path), String(options.origin));
    if (!allowedWhatsAppMediaUrl(url.toString())) throw new Error('CHANNEL_ATTACHMENT_DENIED');
    return dispatch(options, handler);
  });
  const timer = setTimeout(() => { void agent.destroy(new Error('CHANNEL_ATTACHMENT_TIMEOUT')); }, 30_000);
  timer.unref();
  let stream: Awaited<ReturnType<typeof download>> | null = null;
  try {
    // Baileys forwards dispatcher to Node fetch; its public type currently
    // uses the narrower DOM RequestInit, without Undici's extension.
    const requestOptions: RequestInit & { dispatcher: typeof dispatcher } = { dispatcher };
    const output = await download(message, 'stream', { endByte: 10 * 1024 * 1024 + 1, options: requestOptions });
    stream = output;
    const chunks: Buffer[] = []; let size = 0;
    for await (const chunk of output) {
      size += chunk.length;
      if (size > 10 * 1024 * 1024) throw new Error('CHANNEL_ATTACHMENT_TOO_LARGE');
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  } finally {
    clearTimeout(timer);
    if (stream && 'destroy' in stream) stream.destroy();
    await agent.destroy();
  }
}
