import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PNG } from 'pngjs';
import { CreativeMediaFiles } from '$lib/modules/creative-media/application/services/CreativeMediaFiles.js';
import { videoByteRange } from '$lib/modules/creative-media/application/services/CreativeVideoPlayback.js';
import { creativeConfigSchema } from '$lib/modules/creative-media/contracts/schemas/creative-media.schema.js';
import type { CreativeWorkspaceGateway } from '$lib/modules/agent-room/application/services/CreativeWorkspaceGateway.js';
import type { CreativeRun } from '$lib/modules/creative-media/domain/types.js';
import { CreativeProfileRequest, CreativeWorkflowRequest, creativeBodyEvent } from '$lib/modules/creative-media/interface/http/requests/CreativeMediaRequest.js';

const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });
describe('workspace video files', () => {
  it('reads real PNG references and refuses changed bytes or a changed node path', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'orkestrai-video-image-')); dirs.push(dir);
    let path = 'reference.png';
    const png = PNG.sync.write({ width: 300, height: 400, data: Buffer.alloc(300 * 400 * 4, 255) } as PNG);
    await writeFile(join(dir, path), png);
    const workspace = { node: async () => ({ type: 'image', payload: { path } }), existingPath: async (_id: string, relative: string) => join(dir, relative) } as unknown as CreativeWorkspaceGateway;
    const files = new CreativeMediaFiles(workspace);
    const reference = await files.image('workspace', 'image');
    expect(reference).toMatchObject({ width: 300, height: 400, mimeType: 'image/png', size: png.length });
    expect(await files.referenceData('workspace', reference)).toBe(`data:image/png;base64,${png.toString('base64')}`);
    await writeFile(join(dir, path), Buffer.concat([png, Buffer.from('changed')]));
    await expect(files.referenceData('workspace', reference)).rejects.toThrow('creative_reference_changed');
    path = 'other.png';
    await expect(files.referenceData('workspace', reference)).rejects.toThrow('creative_reference_changed');
  });
  async function fixture() {
    const dir = await mkdtemp(join(tmpdir(), 'orkestrai-video-test-')); dirs.push(dir);
    const workspace = { writablePath: async (_id: string, path: string) => resolve(dir, path) } as CreativeWorkspaceGateway;
    const run = { id: 'test-run', nodeId: 'test-node', workspaceId: 'test-workspace', snapshot: { config: creativeConfigSchema.parse({ outputDirectory: 'videos' }) } } as CreativeRun;
    const bytes = Buffer.alloc(96); bytes.write('ftyp', 4, 'ascii'); bytes.write('isom', 8, 'ascii');
    const video = { url: 'https://fal.media/test.mp4', size: bytes.length, width: 640, height: 360, duration: 5, fps: 24 };
    return { dir, files: new CreativeMediaFiles(workspace), run, bytes, video };
  }
  it('publishes unchanged bytes and accepts identical crash recovery without overwriting edits', async () => {
    const f = await fixture();
    const result = await f.files.store(f.run, f.video, new Response(f.bytes));
    expect(await readFile(join(f.dir, result.path))).toEqual(f.bytes);
    expect(await f.files.store(f.run, f.video, new Response(f.bytes))).toEqual(result);
    await writeFile(join(f.dir, result.path), 'user edited the result');
    await expect(f.files.store(f.run, f.video, new Response(f.bytes))).rejects.toThrow('creative_output_conflict');
    expect(await readFile(join(f.dir, result.path), 'utf8')).toBe('user edited the result');
    expect((await readdir(join(f.dir, 'videos'))).some(name => name.endsWith('.part'))).toBe(false);
  });
  it('rejects HTML, truncated files and cleans partial downloads', async () => {
    const f = await fixture();
    for (const bytes of [Buffer.from('<html>not a video</html>'), f.bytes.subarray(0,40)]) await expect(f.files.store(f.run, f.video, new Response(bytes))).rejects.toThrow('creative_video_invalid');
    expect(await readdir(join(f.dir, 'videos'))).toEqual([]);
  });
  it('stores native transparent WebM output without conversion or an MP4 extension', async () => {
    const f = await fixture();
    const bytes = Buffer.alloc(96); bytes.set([0x1a, 0x45, 0xdf, 0xa3]); bytes.write('webm', 12);
    const result = await f.files.store(f.run, { ...f.video, mimeType: 'video/webm' }, new Response(bytes), 1);
    expect(result).toMatchObject({ mimeType: 'video/webm', outputIndex: 1 });
    expect(result.path).toMatch(/-2\.webm$/);
    expect(await readFile(join(f.dir, result.path))).toEqual(bytes);
    await expect(f.files.store(f.run, { ...f.video, mimeType: 'video/webm' }, new Response(f.bytes), 2)).rejects.toThrow('creative_video_invalid');
  });
  it('handles seek ranges without accepting multiple or out-of-bounds ranges', () => {
    expect(videoByteRange(null, 100)).toBeNull();
    expect(videoByteRange('bytes=10-20', 100)).toEqual({ start:10,end:20 });
    expect(videoByteRange('bytes=90-', 100)).toEqual({ start:90,end:99 });
    expect(videoByteRange('bytes=-20', 100)).toEqual({ start:80,end:99 });
    for(const value of ['bytes=100-', 'bytes=4-2', 'bytes=0-1,4-5', 'bytes=-0', 'bytes=-', 'bytes=99999999999999999999-']) expect(() => videoByteRange(value,100)).toThrow();
  });
  it('accepts a workspace FLAC reference and detects changed audio before upload', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'orkestrai-video-audio-')); dirs.push(dir);
    const bytes = Buffer.alloc(96); bytes.write('fLaC');
    await writeFile(join(dir, 'reference.flac'), bytes);
    const workspace = { existingPath: async (_id: string, path: string) => join(dir, path) } as CreativeWorkspaceGateway;
    const files = new CreativeMediaFiles(workspace);
    const reference = await files.media('workspace', { path: 'reference.flac' });
    expect(reference.mimeType).toBe('audio/flac');
    expect(await files.mediaData('workspace', reference)).toBe(`data:audio/flac;base64,${bytes.toString('base64')}`);
    await writeFile(join(dir, 'reference.flac'), Buffer.concat([bytes, Buffer.from('changed')]));
    await expect(files.mediaData('workspace', reference)).rejects.toThrow('creative_reference_changed');
  });
});

describe('creative FormRequest body boundaries', () => {
  function event(data: unknown) { return { params: { id:'route-workspace' }, url: new URL('http://localhost/request?profileId=injected'), request: new Request('http://localhost/request', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(data) }) }; }
  it('does not merge URL identity into strict body schemas', async () => {
    expect(await CreativeWorkflowRequest.validate(creativeBodyEvent(event({ title:'My clip',config:{} })))).toMatchObject({title:'My clip',config:{modelId:'wan-2.7-text'}});
    await expect(CreativeWorkflowRequest.validate(creativeBodyEvent(event({ title:'My clip',config:{},id:'other-workspace' })))).rejects.toThrow();
  });
  it('accepts write-only account credentials without putting them in error messages', async () => {
    const secret = 'synthetic-secret-for-tests';
    expect(await CreativeProfileRequest.validate(creativeBodyEvent(event({name:'Test',provider:'fal',credential:secret})))).toMatchObject({credential:secret});
    const error = await CreativeProfileRequest.validate(creativeBodyEvent(event({name:'Test',provider:'fal',credential:secret,unknown:secret}))).then(() => null, cause => cause);
    expect(error).not.toBeNull();
    expect(JSON.stringify(error)).not.toContain(secret);
  });
});
