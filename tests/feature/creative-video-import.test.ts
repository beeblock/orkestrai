import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSvelarTest } from '@beeblock/svelar/testing';
import { uuidv7 } from '@beeblock/svelar/support';
import { mkdtemp, readFile, readdir, rm, mkdir, writeFile, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CreativeMediaFiles } from '$lib/modules/creative-media/application/services/CreativeMediaFiles.js';
import { CreativeVideoUploadDto, CreativeMediaDto } from '$lib/modules/creative-media/application/dto/CreativeMediaDto.js';
import { ExecuteCreativeMediaAction } from '$lib/modules/creative-media/application/actions/ExecuteCreativeMediaAction.js';
import { AgentBoardTask } from '$lib/modules/agent-room/domain/models/AgentBoardTask.js';
import { AgentWorkspace } from '$lib/modules/agent-room/domain/models/AgentWorkspace.js';
import { CreativeMediaController } from '$lib/modules/creative-media/interface/http/controllers/CreativeMediaController.js';
import { autonomyPolicyService } from '$lib/modules/agent-room/application/services/AutonomyPolicyService.js';
import { bridgeService } from '$lib/modules/agent-room/application/services/BridgeService.js';
import { ptySessionManager } from '$lib/modules/agent-room/infrastructure/pty/PtySessionManager.js';
import { CreativeVideoUploadRequest, creativeBodyEvent } from '$lib/modules/creative-media/interface/http/requests/CreativeMediaRequest.js';
import { creativeWorkspaceGateway } from '$lib/modules/agent-room/application/services/CreativeWorkspaceGateway.js';
import { workspaceRepository } from '$lib/modules/agent-room/infrastructure/repositories/WorkspaceRepository.js';
import { creativeVideoResponse } from '$lib/modules/creative-media/application/services/CreativeVideoPlayback.js';
import { isVideoDrop } from '$lib/modules/creative-media/domain/video-format.js';

vi.mock('$lib/modules/agent-room/application/services/AutonomyPolicyService.js', () => ({ autonomyPolicyService: { recordSemanticEffect: vi.fn(async () => undefined), execute: vi.fn(async (_input, callback) => callback()) }, AutonomyGatePendingError: class extends Error {} }));
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
  async function agentFixture() {
    const f = await fixture();
    const agent = await workspaceRepository.createNode({ workspaceId: f.workspace.id, type: 'terminal', title: 'Editor', payload: {}, x: 10, y: 10, width: 520, height: 400 });
    const taskId = uuidv7();
    await AgentBoardTask.create({ id: taskId, workspace_id: f.workspace.id, title: 'Deliver edited film', status: 'doing', assignee_node_id: agent.id, created_by: 'user', created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
    await mkdir(join(f.dir, 'renders'));
    await writeFile(join(f.dir, 'renders/final.mp4'), f.bytes);
    const actor = { type: 'agent' as const, nodeId: agent.id, taskId };
    const execute = async (input: unknown, identity = actor) => new ExecuteCreativeMediaAction().execute(CreativeMediaDto.from(f.workspace.id, identity, 'import', undefined, input)) as Promise<{ node: Awaited<ReturnType<typeof workspaceRepository.createNode>>; reused: boolean; workspace: { workingDir: string } }>;
    return { ...f, agent, actor, execute };
  }
  it('lets an assigned agent attach an edited render without a paid account, copies or duplicate retries', async () => {
    const f = await agentFixture();
    const result = await f.execute({ path: 'renders/final.mp4', title: 'Edited final' });
    expect(result).toMatchObject({ reused: false, workspace: { id: f.workspace.id, workingDir: f.dir }, node: { type: 'video', title: 'Edited final', payload: { path: 'renders/final.mp4', source: 'import', size: f.bytes.length } } });
    const again = await f.execute({ path: './renders\\final.mp4', expectedSha256: result.node.payload.sha256 });
    expect(again).toMatchObject({ reused: true, node: { id: result.node.id } });
    expect(await readFile(join(f.dir, 'renders/final.mp4'))).toEqual(f.bytes);
    expect(await readdir(join(f.dir, 'renders'))).toEqual(['final.mp4']);
    expect((await workspaceRepository.listNodes(f.workspace.id)).filter(node => node.type === 'video')).toHaveLength(1);
    expect(await workspaceRepository.listEdges(f.workspace.id)).toMatchObject([{ sourceNodeId: f.agent.id, targetNodeId: result.node.id }]);
    const playback = await creativeVideoResponse(f.workspace.id, result.node.id, new Request('http://localhost/video', { headers: { Range: 'bytes=0-31' } }));
    expect(playback.status).toBe(206);
    expect(Buffer.from(await playback.arrayBuffer())).toEqual(f.bytes.subarray(0, 32));
    await workspaceRepository.deleteNode(result.node.id);
    // An explicit re-import can restore a removed node, but does not restore it automatically.
    expect((await f.execute({ path: 'renders/final.mp4' })).node.id).not.toBe(result.node.id);
  });
  it('rejects wrong tasks, foreign agents, changed hashes and suspended workspaces', async () => {
    const f = await agentFixture();
    await expect(f.execute({ path: 'renders/final.mp4' }, { ...f.actor, taskId: uuidv7() })).rejects.toThrow('creative_agent_task_required');
    await expect(f.execute({ path: 'renders/final.mp4' }, { ...f.actor, nodeId: uuidv7() })).rejects.toThrow('creative_agent_task_required');
    await expect(f.execute({ path: 'renders/final.mp4', expectedSha256: 'a'.repeat(64) })).rejects.toThrow('creative_reference_changed');
    await AgentWorkspace.query().where('id', f.workspace.id).update({ suspended_at: new Date().toISOString() });
    await expect(f.execute({ path: 'renders/final.mp4' })).rejects.toThrow('creative_workspace_suspended');
    expect((await workspaceRepository.listNodes(f.workspace.id)).filter(node => node.type === 'video')).toHaveLength(0);
  });
  it('rejects traversal, unregistered roots, symlinks outside the project and disguised text', async () => {
    const f = await agentFixture(), outside = await fixture();
    await writeFile(join(outside.dir, 'outside.mp4'), f.bytes);
    for (const path of ['../outside.mp4', '..\\outside.mp4', join(outside.dir, 'outside.mp4'), 'C:\\outside.mp4', 'https://example.test/video.mp4', '@unknown/outside.mp4']) {
      await expect(f.execute({ path })).rejects.toThrow();
    }
    await symlink(join(outside.dir, 'outside.mp4'), join(f.dir, 'renders/escape.mp4'));
    await expect(f.execute({ path: 'renders/escape.mp4' })).rejects.toThrow('escapes');
    await writeFile(join(f.dir, 'renders/text.mp4'), 'plain text disguised as a video'.repeat(3));
    await expect(f.execute({ path: 'renders/text.mp4' })).rejects.toThrow('creative_reference_invalid');
    await expect(f.execute({ path: 'renders/missing.mp4' })).rejects.toThrow();
    expect((await workspaceRepository.listNodes(f.workspace.id)).filter(node => node.type === 'video')).toHaveLength(0);
  });
  it('retains the render and rolls back a partial node when linking fails', async () => {
    const f = await agentFixture();
    vi.spyOn(creativeWorkspaceGateway, 'connect').mockRejectedValue(new Error('link failed'));
    await expect(f.execute({ path: 'renders/final.mp4' })).rejects.toThrow('link failed');
    expect((await workspaceRepository.listNodes(f.workspace.id)).filter(node => node.type === 'video')).toHaveLength(0);
    expect(await readFile(join(f.dir, 'renders/final.mp4'))).toEqual(f.bytes);
  });
  it('serializes simultaneous imports and audits the attached file without provider calls', async () => {
    const f = await agentFixture();
    const [a, b] = await Promise.all([f.execute({ path: 'renders/final.mp4' }), f.execute({ path: 'renders/final.mp4' })]);
    expect(a.node.id).toBe(b.node.id);
    expect([a.reused, b.reused].sort()).toEqual([false, true]);
    expect(autonomyPolicyService.recordSemanticEffect).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: f.workspace.id, operation: 'creative.video.import', actorId: f.agent.id }), expect.objectContaining({ nodeId: a.node.id }));
  });
  it('respects an explicit filesystem deny without adding a node or changing the file', async () => {
    const f = await agentFixture();
    vi.mocked(autonomyPolicyService.execute).mockRejectedValueOnce(new Error('Denied by owner'));
    await expect(f.execute({ path: 'renders/final.mp4' })).rejects.toThrow('creative_policy_denied');
    expect((await workspaceRepository.listNodes(f.workspace.id)).filter(node => node.type === 'video')).toHaveLength(0);
    expect(await readFile(join(f.dir, 'renders/final.mp4'))).toEqual(f.bytes);
  });
  it('routes authenticated bridge imports through the task contract and rejects missing terminal identity', async () => {
    const f = await agentFixture();
    vi.spyOn(bridgeService, 'resolveWorkspaceByToken').mockResolvedValue(f.workspace);
    const identity = vi.spyOn(ptySessionManager, 'resolveBridgeAgent').mockReturnValue(f.agent.id);
    const url = new URL('http://localhost/api/agent-room/bridge/creative-media');
    const event = () => ({ url, params: {}, request: new Request(url, { method: 'POST', headers: { authorization: 'Bearer synthetic-workspace-token', 'x-orkestrai-agent-token': 'synthetic-agent-token', 'content-type': 'application/json' }, body: JSON.stringify({ command: 'import', taskId: f.actor.taskId, input: { path: 'renders/final.mp4' } }) }) });
    const response = await new CreativeMediaController().bridge(event());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { node: { type: 'video', payload: { path: 'renders/final.mp4' } }, workspace: { workingDir: f.dir } } });
    expect(identity).toHaveBeenCalledWith(f.workspace.id, 'synthetic-agent-token');
    identity.mockReturnValue(null);
    expect((await new CreativeMediaController().bridge(event())).status).toBe(403);
  });
  it('keeps the owner upload route closed to bearer-authenticated agents', async () => {
    const f = await fixture(), url = new URL('http://localhost/upload');
    const response = await new CreativeMediaController().uploadVideo({ url, params: { id: f.workspace.id }, request: new Request(url, { method: 'POST', headers: { authorization: 'Bearer not-a-real-token', origin: url.origin } }) });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'creative_owner_required' });
  });
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
