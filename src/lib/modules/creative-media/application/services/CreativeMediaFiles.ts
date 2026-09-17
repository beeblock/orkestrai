import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, link, copyFile, unlink } from 'node:fs/promises';
import { dirname, posix } from 'node:path';
import { imageSize } from 'image-size';
import { creativeWorkspaceGateway, type CreativeWorkspaceGateway } from '$lib/modules/agent-room/application/services/CreativeWorkspaceGateway.js';
import type { CreativeRemoteVideo } from '../ports/CreativeVideoProvider.js';
import { MAX_CREATIVE_IMAGE_BYTES, MAX_CREATIVE_VIDEO_BYTES } from '../../domain/catalog.js';
import { CreativeMediaError, type CreativeReference, type CreativeRun, type CreativeVideoAsset } from '../../domain/types.js';

export class CreativeMediaFiles {
  constructor(private readonly workspace: CreativeWorkspaceGateway = creativeWorkspaceGateway) {}

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

  private async readImage(workspaceId: string, path: string): Promise<Buffer> {
    const fullPath = await this.workspace.existingPath(workspaceId, path);
    const handle = await open(fullPath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.size < 12 || info.size > MAX_CREATIVE_IMAGE_BYTES) throw new CreativeMediaError('creative_reference_size');
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

  async store(run: CreativeRun, video: CreativeRemoteVideo, response: Response): Promise<CreativeVideoAsset> {
    const name = `${run.snapshot.config.filePrefix}-${run.id}.mp4`;
    const path = posix.join(run.snapshot.config.outputDirectory.replace(/\\/g, '/'), name);
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
        if (header.length < 32) header = Buffer.concat([header, Buffer.from(next.value.subarray(0, 32 - header.length))]);
        hash.update(next.value);
        let offset = 0;
        while (offset < next.value.byteLength) {
          const result = await handle.write(next.value, offset, next.value.byteLength - offset);
          if (!result.bytesWritten) throw new CreativeMediaError('creative_download_failed');
          offset += result.bytesWritten;
        }
      }
      if (size < 32 || header.toString('ascii', 4, 8) !== 'ftyp' || (video.size !== null && size !== video.size)) throw new CreativeMediaError('creative_video_invalid');
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
      return { path, sha256, size, mimeType: 'video/mp4', width: video.width, height: video.height, duration: video.duration, fps: video.fps, workflowNodeId: run.nodeId, runId: run.id, modelId: run.snapshot.config.modelId };
    } catch (error) {
      await reader?.cancel().catch(() => undefined);
      await handle.close().catch(() => undefined);
      await unlink(temporary).catch(() => undefined);
      throw error instanceof CreativeMediaError ? error : new CreativeMediaError('creative_download_failed');
    } finally { reader?.releaseLock(); }
  }
}
