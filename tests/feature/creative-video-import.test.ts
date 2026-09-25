import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSvelarTest } from '@beeblock/svelar/testing';
import { uuidv7 } from '@beeblock/svelar/support';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CreativeMediaFiles } from '$lib/modules/creative-media/application/services/CreativeMediaFiles.js';
import { CreativeVideoUploadDto } from '$lib/modules/creative-media/application/dto/CreativeMediaDto.js';
import { CreativeVideoUploadRequest, creativeBodyEvent } from '$lib/modules/creative-media/interface/http/requests/CreativeMediaRequest.js';
import { creativeWorkspaceGateway } from '$lib/modules/agent-room/application/services/CreativeWorkspaceGateway.js';
import { workspaceRepository } from '$lib/modules/agent-room/infrastructure/repositories/WorkspaceRepository.js';
import { creativeVideoResponse } from '$lib/modules/creative-media/application/services/CreativeVideoPlayback.js';
import { isVideoDrop } from '$lib/modules/creative-media/domain/video-format.js';

vi.mock('$lib/modules/agent-room/application/services/AutonomyPolicyService.js', () => ({ autonomyPolicyService: { recordSemanticEffect: vi.fn(async () => undefined) } }));
const folders: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true }); });

describe('native workspace video imports', () => {
  useSvelarTest({ refreshDatabase: true });
  async function fixture() {
    const dir = await mkdtemp(join(tmpdir(), 'orkestrai-video-import-')); folders.push(dir);
    const workspace = await workspaceRepository.createWorkspace({ name: 'Video import', workingDir: dir });
    const bytes = Buffer.alloc(96); bytes.writeUInt32BE(24); bytes.write('ftypisom', 4);
    const file = new File([bytes], 'My reference.MP4', { type: 'video/mp4' });
    return { dir, workspace, bytes, file, files: new CreativeMediaFiles() };
  }
  it('preserves bytes, creates distinct native nodes, reads provider references and serves seekable playback without paid opt-in', async () => {
    const f = await fixture();
    const input = CreativeVideoUploadDto.from(f.workspace.id, { file: f.file, x: 210, y: 240 });
    const node = await f.files.importVideo(input);
    const second = await f.files.importVideo(input);
    expect(node).toMatchObject({ type: 'video', title: f.file.name, x: 210, y: 240, payload: { source: 'import', mimeType: 'video/mp4', size: 96 } });
    expect([second.x, second.y]).not.toEqual([node.x, node.y]);
    expect(second.payload.path).not.toBe(node.payload.path);
    expect(node.payload).not.toHaveProperty('runId');
    expect(await readFile(join(f.dir, String(node.payload.path)))).toEqual(f.bytes);
    const reference = await f.files.media(f.workspace.id, { nodeId: node.id });
    expect(reference).toMatchObject({ nodeId: node.id, mimeType: 'video/mp4', sha256: node.payload.sha256 });
    expect(await f.files.mediaData(f.workspace.id, reference)).toBe(`data:video/mp4;base64,${f.bytes.toString('base64')}`);
    const response = await creativeVideoResponse(f.workspace.id, node.id, new Request('http://localhost/video', { headers: { Range: 'bytes=5-19' } }));
    expect(response.status).toBe(206);
    expect(response.headers.get('content-type')).toBe('video/mp4');
    expect(Buffer.from(await response.arrayBuffer())).toEqual(f.bytes.subarray(5, 20));
    expect((await workspaceRepository.listNodes(f.workspace.id)).filter(item => item.type === 'document')).toHaveLength(0);
  });
  it('accepts multipart files through the FormRequest and preserves MOV MIME for references', async () => {
    const f = await fixture();
    const form = new FormData();
    form.set('file', new File([f.bytes], 'Reference.mov', { type: 'video/quicktime' }));
    form.set('x', '125'); form.set('y', '200');
    const url = new URL('http://localhost/upload');
    const input = await CreativeVideoUploadRequest.validate(creativeBodyEvent({ url, params: { id: f.workspace.id }, request: new Request(url, { method: 'POST', body: form }) }));
    const node = await f.files.importVideo(CreativeVideoUploadDto.from(f.workspace.id, input));
    expect(node.x).toBe(125);
    expect((await f.files.media(f.workspace.id, { nodeId: node.id })).mimeType).toBe('video/quicktime');
  });
  it('rejects invalid files, oversized uploads, unknown floors and path escapes without creating nodes', async () => {
    const f = await fixture();
    for (const file of [undefined, new File(['x'], 'small.mp4'), new File([f.bytes], 'file.txt'), { name: 'fake.mp4', size: 100 }]) {
      expect(() => CreativeVideoUploadDto.from(f.workspace.id, { file })).toThrow();
    }
    const oversized = new File([f.bytes], 'large.mp4'); Object.defineProperty(oversized, 'size', { value: 64 * 1024 * 1024 + 1 });
    expect(() => CreativeVideoUploadDto.from(f.workspace.id, { file: oversized })).toThrow();
    await expect(f.files.importVideo(CreativeVideoUploadDto.from(f.workspace.id, { file: new File(['<html>' + 'not a movie'.repeat(10)], 'fake.mp4') }))).rejects.toThrow('creative_video_import_format');
    await expect(f.files.importVideo(CreativeVideoUploadDto.from(f.workspace.id, { file: f.file, floorId: uuidv7() }))).rejects.toThrow();
    expect(() => CreativeVideoUploadDto.from(f.workspace.id, { file: f.file, path: '../outside.mp4' })).toThrow();
    expect(await workspaceRepository.listNodes(f.workspace.id)).toHaveLength(0);
    for (const name of ['a.MP4', 'a.webm', 'a.mov', 'a.avi']) expect(isVideoDrop({ name, type: '' })).toBe(true);
    for (const name of ['a.pdf', 'a.md', 'a.png']) expect(isVideoDrop({ name, type: '' })).toBe(false);
  });
  it('removes only its new file when node persistence fails', async () => {
    const f = await fixture();
    vi.spyOn(creativeWorkspaceGateway, 'createNode').mockRejectedValue(new Error('storage unavailable'));
    await expect(f.files.importVideo(CreativeVideoUploadDto.from(f.workspace.id, { file: f.file }))).rejects.toThrow('storage unavailable');
    expect(await readdir(join(f.dir, '.orkestrai/media/videos'))).toEqual([]);
  });
});
