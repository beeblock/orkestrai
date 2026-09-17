import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { creativeWorkspaceGateway } from '$lib/modules/agent-room/application/services/CreativeWorkspaceGateway.js';
import { creativeMediaRepository } from '../../infrastructure/repositories/CreativeMediaRepository.js';
import { MAX_CREATIVE_VIDEO_BYTES } from '../../domain/catalog.js';
import { VIDEO_FORMATS, matchesVideoHeader, videoMimeFromPath } from '../../domain/video-format.js';

export function videoByteRange(value: string | null, size: number): { start: number; end: number } | null {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2])) throw new Error('invalid_range');
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(size - 1, Number(match[2])) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || start > end || (!match[1] && Number(match[2]) <= 0)) throw new Error('invalid_range');
  return { start, end };
}

export async function creativeVideoResponse(workspaceId: string, assetId: string, request: Request): Promise<Response> {
  const node = await creativeWorkspaceGateway.node(workspaceId, assetId);
  const run = node ? null : await creativeMediaRepository.run(workspaceId, assetId);
  const path = node?.type === 'video' ? (node.payload as { path?: string }).path : run?.output?.path;
  if (!path) return new Response(null, { status: 404 });
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    const fullPath = await creativeWorkspaceGateway.existingPath(workspaceId, path);
    handle = await open(fullPath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const info = await handle.stat();
    if (!info.isFile() || info.size < 32 || info.size > MAX_CREATIVE_VIDEO_BYTES) throw new Error('invalid_video');
    const mimeType = videoMimeFromPath(path);
    const header = Buffer.alloc(Math.min(1024, info.size)); await handle.read(header, 0, header.length, 0);
    if (!matchesVideoHeader(header, mimeType)) throw new Error('invalid_video');
    let range: ReturnType<typeof videoByteRange>;
    try { range = videoByteRange(request.headers.get('range'), info.size); }
    catch { await handle.close(); return new Response(null, { status: 416, headers: { 'content-range': `bytes */${info.size}` } }); }
    const start = range?.start ?? 0, end = range?.end ?? info.size - 1;
    const headers: Record<string, string> = { 'content-type': mimeType, 'content-length': String(end - start + 1), 'accept-ranges': 'bytes', 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff', 'content-disposition': `inline; filename="orkestrai-video-${assetId}.${VIDEO_FORMATS[mimeType]}"` };
    if (range) headers['content-range'] = `bytes ${start}-${end}/${info.size}`;
    if (request.method === 'HEAD') { await handle.close(); return new Response(null, { status: range ? 206 : 200, headers }); }
    const stream = handle.createReadStream({ start, end, autoClose: true });
    const abort = () => stream.destroy();
    request.signal.addEventListener('abort', abort, { once: true });
    if (request.signal.aborted) abort();
    stream.once('close', () => request.signal.removeEventListener('abort', abort));
    return new Response(Readable.toWeb(stream) as ReadableStream, { status: range ? 206 : 200, headers });
  } catch { await handle?.close().catch(() => undefined); return new Response(null, { status: 404 }); }
}
