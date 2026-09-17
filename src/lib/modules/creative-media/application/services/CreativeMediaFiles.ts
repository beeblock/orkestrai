import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, link, copyFile, unlink } from 'node:fs/promises';
import { dirname, posix, extname } from 'node:path';
import { imageSize } from 'image-size';
import { creativeWorkspaceGateway, type CreativeWorkspaceGateway } from '$lib/modules/agent-room/application/services/CreativeWorkspaceGateway.js';
import type { CreativeRemoteVideo } from '../ports/CreativeVideoProvider.js';
import { MAX_CREATIVE_IMAGE_BYTES, MAX_CREATIVE_VIDEO_BYTES } from '../../domain/catalog.js';
import { CreativeMediaError, type CreativeReference, type CreativeMediaReference, type CreativeRun, type CreativeVideoAsset } from '../../domain/types.js';
import { VIDEO_FORMATS, matchesVideoHeader, videoMimeFromPath } from '../../domain/video-format.js';

export function creativeOutputPath(run: CreativeRun, video: CreativeRemoteVideo, outputIndex = 0) {
  const name = `${run.snapshot.config.filePrefix}-${run.id}${outputIndex ? `-${outputIndex + 1}` : ''}.${VIDEO_FORMATS[video.mimeType ?? 'video/mp4']}`;
  return posix.join(run.snapshot.config.outputDirectory.replace(/\\/g, '/'), name);
}

export class CreativeMediaFiles {
  constructor(private readonly workspace: CreativeWorkspaceGateway = creativeWorkspaceGateway) {}

  async asset(workspaceId: string, nodeId: string): Promise<CreativeMediaReference> {
    const node = await this.workspace.node(workspaceId, nodeId);
    if (node?.type === 'image') return this.media(workspaceId, { nodeId });
    const path = (node?.payload as { path?: string })?.path;
    if (node?.type !== 'video' || !path) throw new CreativeMediaError('creative_reference_unavailable');
    const mimeType = videoMimeFromPath(path);
    const handle = await open(await this.workspace.existingPath(workspaceId, path), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const initial = await handle.stat();
      if (!initial.isFile() || initial.size < 12 || initial.size > MAX_CREATIVE_VIDEO_BYTES) throw new CreativeMediaError('creative_reference_size');
      const header = Buffer.alloc(Math.min(initial.size, 1024));
      await handle.read(header, 0, header.length, 0);
      if (!matchesVideoHeader(header, mimeType)) throw new CreativeMediaError('creative_reference_invalid');
      const hash = createHash('sha256'); let size = 0;
      for await (const chunk of handle.createReadStream({ start: 0, autoClose: false })) {
        size += chunk.length;
        if (size > MAX_CREATIVE_VIDEO_BYTES) throw new CreativeMediaError('creative_reference_size');
        hash.update(chunk);
      }
      const final = await handle.stat();
      if (size !== initial.size || final.size !== initial.size || final.mtimeMs !== initial.mtimeMs || final.ctimeMs !== initial.ctimeMs) throw new CreativeMediaError('creative_reference_changed', 409);
      return { nodeId, path, mimeType, size, sha256: hash.digest('hex') };
    } finally { await handle.close(); }
  }

  async image(workspaceId: string, nodeId: string): Promise<CreativeReference> {
    const node = await this.workspace.node(workspaceId, nodeId);
    const path = (node?.payload as { path?: string } | undefined)?.path;
    if (node?.type !== 'image' || !path) throw new CreativeMediaError('creative_reference_unavailable');
    const bytes = await this.readImage(workspaceId, path);
    let metadata: ReturnType<typeof imageSize>;
    try { metadata = imageSize(bytes); } catch { throw new CreativeMediaError('creative_reference_invalid'); }
    const mimeType = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' }[metadata.type ?? ''];
    const { width, height } = metadata;
    if (!mimeType || !width || !height || width < 300 || height < 300 || width > 16384 || height > 16384 || width * height > 40_000_000 || width / height < 0.4 || width / height > 2.5) throw new CreativeMediaError('creative_reference_dimensions');
    return { nodeId, path, sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length, mimeType: mimeType as CreativeReference['mimeType'], width, height };
  }

  private async readImage(workspaceId: string, path: string, maximum = MAX_CREATIVE_IMAGE_BYTES): Promise<Buffer> {
    const fullPath = await this.workspace.existingPath(workspaceId, path);
    const handle = await open(fullPath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.size < 12 || info.size > maximum) throw new CreativeMediaError('creative_reference_size');
      const buffer = Buffer.alloc(info.size + 1);
      let position = 0;
      while (position < buffer.length) {
        const result = await handle.read(buffer, position, buffer.length - position, position);
        if (!result.bytesRead) break;
        position += result.bytesRead;
      }
      if (position !== info.size) throw new CreativeMediaError('creative_reference_changed', 409);
      return buffer.subarray(0, position);
    } finally { await handle.close(); }
  }

  async referenceData(workspaceId: string, reference: CreativeReference): Promise<string> {
    const current = await this.workspace.node(workspaceId, reference.nodeId);
    if (current?.type !== 'image' || (current.payload as { path?: string }).path !== reference.path) throw new CreativeMediaError('creative_reference_changed', 409);
    const bytes = await this.readImage(workspaceId, reference.path);
    if (createHash('sha256').update(bytes).digest('hex') !== reference.sha256) throw new CreativeMediaError('creative_reference_changed', 409);
    return `data:${reference.mimeType};base64,${bytes.toString('base64')}`;
  }

  async media(workspaceId: string, binding: { nodeId?: string; path?: string }): Promise<CreativeMediaReference> {
    let path = binding.path;
    if (binding.nodeId) {
      const node = await this.workspace.node(workspaceId, binding.nodeId);
      if (!node || !['image', 'video'].includes(node.type)) throw new CreativeMediaError('creative_reference_unavailable');
      path = (node.payload as { path?: string }).path;
    }
    if (!path) throw new CreativeMediaError('creative_reference_unavailable');
    const bytes = await this.readImage(workspaceId, path, 64 * 1024 * 1024);
    let mimeType: string | undefined;
    if (bytes.toString('ascii', 4, 8) === 'ftyp') mimeType = extname(path).toLowerCase() === '.m4a' ? 'audio/mp4' : 'video/mp4';
    else if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WAVE') mimeType = 'audio/wav';
    else if (bytes.toString('ascii', 0, 3) === 'ID3' || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0 && extname(path).toLowerCase() === '.mp3')) mimeType = 'audio/mpeg';
    else if (bytes.toString('ascii', 0, 4) === 'OggS') mimeType = 'audio/ogg';
    else if (bytes.toString('ascii', 0, 4) === 'fLaC') mimeType = 'audio/flac';
    else if (['.webm', '.mkv', '.gif'].includes(extname(path).toLowerCase()) && matchesVideoHeader(bytes.subarray(0, 1024), videoMimeFromPath(path))) mimeType = videoMimeFromPath(path);
    else {
      try {
        const image = imageSize(bytes);
        if ((image.width ?? 0) * (image.height ?? 0) > 40_000_000 || bytes.length > MAX_CREATIVE_IMAGE_BYTES) throw new Error();
        mimeType = ({ png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' } as Record<string, string>)[image.type ?? ''];
      } catch { throw new CreativeMediaError('creative_reference_invalid'); }
    }
    if (!mimeType) throw new CreativeMediaError('creative_reference_invalid');
    return { ...(binding.nodeId ? { nodeId: binding.nodeId } : {}), path, mimeType, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  }

  async mediaData(workspaceId: string, reference: CreativeMediaReference) {
    const current = await this.media(workspaceId, reference.nodeId ? { nodeId: reference.nodeId } : { path: reference.path });
    if (JSON.stringify(current) !== JSON.stringify(reference)) throw new CreativeMediaError('creative_reference_changed', 409);
    const bytes = await this.readImage(workspaceId, reference.path, 64 * 1024 * 1024);
    if (createHash('sha256').update(bytes).digest('hex') !== reference.sha256) throw new CreativeMediaError('creative_reference_changed', 409);
    return `data:${reference.mimeType};base64,${bytes.toString('base64')}`;
  }

  async freeze(workspaceId: string, reference: CreativeMediaReference, relativePath: string, sourceWorkspaceId = workspaceId): Promise<CreativeMediaReference> {
    const bytes = await this.readImage(sourceWorkspaceId, reference.path, 64 * 1024 * 1024);
    if (createHash('sha256').update(bytes).digest('hex') !== reference.sha256) throw new CreativeMediaError('creative_reference_changed', 409);
    const destination = await this.workspace.writablePath(workspaceId, relativePath);
    await mkdir(dirname(destination), { recursive: true });
    // Recheck after creating parents; never overwrite an approved or user-edited file.
    if (await this.workspace.writablePath(workspaceId, relativePath) !== destination) throw new CreativeMediaError('creative_reference_changed', 409);
    let handle;
    try { handle = await open(destination, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const existing = await this.media(workspaceId, { path: relativePath });
      if (existing.sha256 !== reference.sha256) throw new CreativeMediaError('creative_reference_changed', 409);
      return existing;
    }
    try { await handle.writeFile(bytes); await handle.sync(); }
    catch (error) { await handle.close(); await unlink(destination).catch(() => undefined); throw error; }
    await handle.close();
    const frozen = await this.media(workspaceId, { path: relativePath });
    if (frozen.sha256 !== reference.sha256) throw new CreativeMediaError('creative_reference_changed', 409);
    return frozen;
  }

  async freezeMany(workspaceId: string, items: Array<{ reference: CreativeMediaReference; path: string }>, sourceWorkspaceId = workspaceId) {
    for (const item of items) {
      const current = await this.media(sourceWorkspaceId, { path: item.reference.path });
      if (current.sha256 !== item.reference.sha256) throw new CreativeMediaError('creative_reference_changed', 409);
      await this.workspace.writablePath(workspaceId, item.path);
      try {
        const existing = await this.media(workspaceId, { path: item.path });
        if (existing.sha256 !== item.reference.sha256) throw new CreativeMediaError('creative_reference_changed', 409);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    const results: CreativeMediaReference[] = [];
    for (const item of items) results.push(await this.freeze(workspaceId, item.reference, item.path, sourceWorkspaceId));
    return results;
  }

  async store(run: CreativeRun, video: CreativeRemoteVideo, response: Response, outputIndex = 0): Promise<CreativeVideoAsset> {
    const mimeType = video.mimeType ?? 'video/mp4';
    const path = creativeOutputPath(run, video, outputIndex);
    let destination = await this.workspace.writablePath(run.workspaceId, path);
    await mkdir(dirname(destination), { recursive: true });
    destination = await this.workspace.writablePath(run.workspaceId, path);
    const temporary = `${destination}.${createHash('sha256').update(String(Date.now()) + Math.random()).digest('hex').slice(0, 12)}.part`;
    const handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0), 0o600);
    const hash = createHash('sha256');
    let size = 0;
    let header = Buffer.alloc(0);
    const reader = response.body?.getReader();
    try {
      if (!reader) throw new CreativeMediaError('creative_download_failed');
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.byteLength;
        if (size > MAX_CREATIVE_VIDEO_BYTES) throw new CreativeMediaError('creative_video_too_large');
        if (header.length < 1024) header = Buffer.concat([header, Buffer.from(next.value.subarray(0, 1024 - header.length))]);
        hash.update(next.value);
        let offset = 0;
        while (offset < next.value.byteLength) {
          const result = await handle.write(next.value, offset, next.value.byteLength - offset);
          if (!result.bytesWritten) throw new CreativeMediaError('creative_download_failed');
          offset += result.bytesWritten;
        }
      }
      if (size < 32 || !matchesVideoHeader(header, mimeType) || (video.size !== null && size !== video.size)) throw new CreativeMediaError('creative_video_invalid');
      await handle.sync();
      await handle.close();
      await this.workspace.writablePath(run.workspaceId, path);
      const sha256 = hash.digest('hex');
      try {
        try { await link(temporary, destination); }
        catch (error) {
          if (!['ENOTSUP', 'EPERM', 'EXDEV', 'EOPNOTSUPP'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
          await copyFile(temporary, destination, constants.COPYFILE_EXCL);
        }
      }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        // A crash after publication can leave the same result on disk. Accept
        // only identical bytes; never overwrite a file edited by the user.
        const existing = await open(destination, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
        try {
          const info = await existing.stat();
          if (!info.isFile() || info.size !== size) throw new CreativeMediaError('creative_output_conflict', 409);
          const digest = createHash('sha256');
          for await (const chunk of existing.createReadStream({ autoClose: false })) digest.update(chunk);
          if (digest.digest('hex') !== sha256) throw new CreativeMediaError('creative_output_conflict', 409);
        } finally { await existing.close(); }
      }
      await unlink(temporary);
      return { path, sha256, size, mimeType, width: video.width, height: video.height, duration: video.duration, fps: video.fps, workflowNodeId: run.nodeId, runId: run.id, modelId: run.snapshot.config.modelId, ...(outputIndex ? { outputIndex } : {}) };
    } catch (error) {
      await reader?.cancel().catch(() => undefined);
      await handle.close().catch(() => undefined);
      await unlink(temporary).catch(() => undefined);
      throw error instanceof CreativeMediaError ? error : new CreativeMediaError('creative_download_failed');
    } finally { reader?.releaseLock(); }
  }
}
