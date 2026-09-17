import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSvelarTest } from '@beeblock/svelar/testing';
import { uuidv7 } from '@beeblock/svelar/support';
import { mkdtemp, readFile, writeFile, rm, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CreativeSequenceService } from '$lib/modules/creative-media/application/services/CreativeSequenceService.js';
import { creativeSequenceRepository } from '$lib/modules/creative-media/infrastructure/repositories/CreativeSequenceRepository.js';
import { creativeWorkspaceGateway } from '$lib/modules/agent-room/application/services/CreativeWorkspaceGateway.js';
import { workspaceRepository } from '$lib/modules/agent-room/infrastructure/repositories/WorkspaceRepository.js';
import { SequenceEncoder } from '$lib/modules/creative-media/infrastructure/SequenceEncoder.js';
import { SequenceEncoderRuntime, encoderProcess, hashFile } from '$lib/modules/creative-media/infrastructure/SequenceEncoderRuntime.js';
import { creativeSequenceCommandSchema, sequenceDocumentSchema } from '$lib/modules/creative-media/contracts/schemas/creative-sequence.schema.js';
import type { CreativeSequence } from '$lib/modules/creative-media/domain/sequence.js';
import { autonomyPolicyService } from '$lib/modules/agent-room/application/services/AutonomyPolicyService.js';
import { creativeWorkflowService } from '$lib/modules/creative-media/application/services/CreativeWorkflowService.js';
import { CreativeMediaDto } from '$lib/modules/creative-media/application/dto/CreativeMediaDto.js';
import { ExecuteCreativeMediaAction } from '$lib/modules/creative-media/application/actions/ExecuteCreativeMediaAction.js';
vi.mock('$lib/modules/agent-room/application/services/AutonomyPolicyService.js', () => ({ autonomyPolicyService: { recordSemanticEffect: vi.fn(async () => undefined), execute: vi.fn(async (_operation, callback) => callback()) }, AutonomyGatePendingError: class extends Error {} }));
const folders: string[] = [], user = { type: 'user' as const };
afterEach(async () => { vi.restoreAllMocks(); for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true }); });
const encoderPath = process.env.ORKESTRAI_TEST_FFMPEG ?? '/opt/homebrew/bin/ffmpeg';
const probePath = process.env.ORKESTRAI_TEST_FFPROBE ?? '/opt/homebrew/bin/ffprobe';
const available = await access(encoderPath).then(() => true, () => false);
describe('native non-destructive video sequences', () => {
  useSvelarTest({ refreshDatabase: true });
  async function fixture() {
    const folder = await mkdtemp(join(tmpdir(), 'orkestrai-sequence-')); folders.push(folder);
    const workspace = await workspaceRepository.createWorkspace({ name: 'Sequence test', workingDir: folder });
    const runtime = new SequenceEncoderRuntime(join(folder, 'runtime'));
    vi.spyOn(runtime, 'require').mockResolvedValue({ ffmpeg: encoderPath, ffprobe: probePath });
    const encoder = new SequenceEncoder(creativeWorkspaceGateway, runtime);
    const service = new CreativeSequenceService(creativeSequenceRepository, creativeWorkspaceGateway, encoder);
    const sequence = await service.execute(workspace.id, { command: 'create', title: 'Two shots' }, user) as CreativeSequence;
    return { folder, workspace, runtime, encoder, service, sequence };
  }
  it('requires revision, bounded trims, dimensions and explicit installation by owner', async () => {
    expect(() => creativeSequenceCommandSchema.parse({ command: 'export', nodeId: uuidv7() })).toThrow();
    expect(() => sequenceDocumentSchema.parse({ title: 'x', width: 1081 })).toThrow();
    const f = await fixture();
    await expect(f.service.execute(f.workspace.id, { command: 'apply', nodeId: f.sequence.nodeId, revision: 99, operations: [{ type: 'settings', width: 1080 }] }, user)).rejects.toThrow('creative_revision_conflict');
    await expect(f.service.execute(f.workspace.id, { command: 'install_runtime' }, { type: 'agent', nodeId: uuidv7(), taskId: uuidv7() })).rejects.toThrow();
    const other = await fixture();
    await expect(f.service.read(other.workspace.id, f.sequence.nodeId)).rejects.toThrow('creative_sequence_not_found');
    await expect(f.service.execute(f.workspace.id, { command: 'export', nodeId: f.sequence.nodeId, revision: 1, idempotencyKey: uuidv7() }, user)).rejects.toThrow('creative_sequence_empty');
  });
  it('recovers an interrupted export honestly without claiming success', async () => {
    const f = await fixture();
    await creativeSequenceRepository.setExport(f.workspace.id, f.sequence.nodeId, { id: uuidv7(), revision: 1, state: 'running', progress: 20, startedAt: new Date().toISOString(), error: null, path: null, sha256: null, outputNodeId: null });
    expect((await f.service.read(f.workspace.id, f.sequence.nodeId)).export).toMatchObject({ state: 'failed', error: 'creative_sequence_interrupted', outputNodeId: null });
  });
  async function addFixture(f: Awaited<ReturnType<typeof fixture>>) {
    const bytes = Buffer.alloc(128); bytes.write('ftyp', 4); bytes.write('isom', 8);
    await writeFile(join(f.folder, 'source.mp4'), bytes);
    const node = await workspaceRepository.createNode({ workspaceId: f.workspace.id, type: 'video', title: 'Source', payload: { path: 'source.mp4' }, x: 0, y: 0, width: 300, height: 200 });
    vi.spyOn(f.encoder, 'probe').mockResolvedValue({ duration: 2, width: 640, height: 360, hasAudio: true });
    const sequence = await f.service.execute(f.workspace.id, { command: 'apply', nodeId: f.sequence.nodeId, revision: 1, operations: [{ type: 'add', nodeId: node.id }] }, user) as CreativeSequence;
    return { node, sequence };
  }
  it('cancels an active job without publishing, blocks edits, and keeps repeat keys revision-bound', async () => {
    const f = await fixture(); await addFixture(f);
    const render = vi.spyOn(f.encoder, 'render').mockImplementation(async (_workspace, _document, _id, signal) => {
      await new Promise<void>(resolve => { if (signal.aborted) resolve(); else signal.addEventListener('abort', () => resolve(), { once: true }); });
      throw new Error('cancelled');
    });
    const input = { command: 'export' as const, nodeId: f.sequence.nodeId, revision: 2, idempotencyKey: uuidv7() };
    await f.service.execute(f.workspace.id, input, user);
    await f.service.execute(f.workspace.id, input, user);
    expect(render).toHaveBeenCalledTimes(1);
    await expect(f.service.execute(f.workspace.id, { command: 'apply', nodeId: f.sequence.nodeId, revision: 2, operations: [{ type: 'settings', fps: 24 }] }, user)).rejects.toThrow('creative_sequence_busy');
    await f.service.execute(f.workspace.id, { command: 'cancel', nodeId: f.sequence.nodeId }, user);
    await expect.poll(async () => (await f.service.read(f.workspace.id, f.sequence.nodeId)).export?.state).toBe('cancelled');
    expect((await f.service.read(f.workspace.id, f.sequence.nodeId)).export?.outputNodeId).toBeNull();
    await f.service.execute(f.workspace.id, { command: 'apply', nodeId: f.sequence.nodeId, revision: 2, operations: [{ type: 'settings', fps: 24 }] }, user);
    await expect(f.service.execute(f.workspace.id, { ...input, revision: 3 }, user)).rejects.toThrow('creative_revision_conflict');
  });
  it('blocks denied source access before encoding and retains source identity during transfer', async () => {
    const f = await fixture(), added = await addFixture(f), target = await fixture();
    vi.mocked(autonomyPolicyService.execute).mockRejectedValueOnce(new Error('revoked'));
    const render = vi.spyOn(f.encoder, 'render');
    await expect(f.service.execute(f.workspace.id, { command: 'export', nodeId: f.sequence.nodeId, revision: 2, idempotencyKey: uuidv7() }, user)).rejects.toThrow('creative_policy_denied');
    expect(render).not.toHaveBeenCalled();
    await expect(f.service.clone(f.workspace.id, f.sequence.nodeId, target.workspace.id, uuidv7(), new Map())).rejects.toThrow('creative_sequence_transfer_sources');
    const destination = await addFixture(target), targetId = uuidv7();
    const copied = await f.service.clone(f.workspace.id, f.sequence.nodeId, target.workspace.id, targetId, new Map([[added.node.id, destination.node.id]]));
    expect(copied.document.clips[0]).toMatchObject({ nodeId: destination.node.id, sha256: added.sequence.document.clips[0].sha256 });
    expect(copied.export).toBeNull();
  });
  it('uses the same task-bound agent contract and never grants runtime installation to agents', async () => {
    const f = await fixture(), agent = { type: 'agent' as const, nodeId: uuidv7(), taskId: uuidv7() };
    await expect(f.service.execute(f.workspace.id, { command: 'create', title: 'Unauthenticated' }, agent)).rejects.toThrow('creative_agent_task_required');
    vi.spyOn(creativeWorkflowService, 'assertActor').mockResolvedValue(f.workspace);
    await expect(f.service.execute(f.workspace.id, { command: 'install_runtime' }, agent)).rejects.toThrow('creative_owner_required');
    const result = await new ExecuteCreativeMediaAction().execute(CreativeMediaDto.from(f.workspace.id, agent, 'sequences', undefined, { command: 'create', title: 'Agent edit' })) as CreativeSequence;
    expect(await creativeSequenceRepository.read(f.workspace.id, result.nodeId)).toMatchObject({ document: { title: 'Agent edit' }, revision: 1 });
  });
  it.skipIf(!available)('encodes two real clips, exact trims, audio, captions and dimensions without touching sources', async () => {
    const f = await fixture();
    await encoderProcess(encoderPath, ['-v', 'error', '-f', 'lavfi', '-i', 'color=red:size=640x360:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '1.5', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', join(f.folder, 'a.mp4')]);
    await encoderProcess(encoderPath, ['-v', 'error', '-f', 'lavfi', '-i', 'color=blue:size=360x640:rate=24', '-t', '1.5', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', join(f.folder, 'b.mp4')]);
    const sourceHash = await hashFile(join(f.folder, 'a.mp4'));
    const nodes = [];
    for (const path of ['a.mp4', 'b.mp4']) nodes.push(await workspaceRepository.createNode({ workspaceId: f.workspace.id, type: 'video', title: path, payload: { path }, x: 0, y: 0, width: 300, height: 200 }));
    const added = await f.service.execute(f.workspace.id, { command: 'apply', nodeId: f.sequence.nodeId, revision: 1, operations: nodes.map(node => ({ type: 'add', nodeId: node.id })) }, user) as CreativeSequence;
    const edited = await f.service.execute(f.workspace.id, { command: 'apply', nodeId: f.sequence.nodeId, revision: 2, operations: [{ type: 'settings', width: 360, height: 640 }, ...added.document.clips.map(clip => ({ type: 'update' as const, clipId: clip.id, patch: { in: 0.25, out: 1.25, volume: 0.5, caption: "Olá: client's {untrusted} \\test\nSecond line" } }))] }, user) as CreativeSequence;
    const key = uuidv7();
    const running = await f.service.execute(f.workspace.id, { command: 'export', nodeId: f.sequence.nodeId, revision: edited.revision, idempotencyKey: key }, user) as CreativeSequence;
    expect(running.export?.state).toBe('running');
    expect((await f.service.execute(f.workspace.id, { command: 'export', nodeId: f.sequence.nodeId, revision: edited.revision, idempotencyKey: key }, user) as CreativeSequence).export?.id).toBe(key);
    await expect.poll(async () => (await f.service.read(f.workspace.id, f.sequence.nodeId)).export?.state, { timeout: 60000 }).not.toBe('running');
    const done = (await f.service.read(f.workspace.id, f.sequence.nodeId)).export!;
    expect(done).toMatchObject({ state: 'completed', error: null, revision: 3 });
    expect(await f.encoder.probe(join(f.folder, done.path!))).toMatchObject({ width: 360, height: 640, hasAudio: true });
    expect((await f.encoder.probe(join(f.folder, done.path!))).duration).toBeCloseTo(2, 0);
    expect(await hashFile(join(f.folder, 'a.mp4'))).toBe(sourceHash);
    expect((await workspaceRepository.getNode(done.outputNodeId!))?.payload).toMatchObject({ sequenceNodeId: f.sequence.nodeId, sequenceRevision: 3, sha256: done.sha256 });
    await writeFile(join(f.folder, 'a.mp4'), await readFile(join(f.folder, 'b.mp4')));
    await f.service.execute(f.workspace.id, { command: 'export', nodeId: f.sequence.nodeId, revision: 3, idempotencyKey: uuidv7() }, user);
    await expect.poll(async () => (await f.service.read(f.workspace.id, f.sequence.nodeId)).export?.state).toBe('failed');
    expect((await f.service.read(f.workspace.id, f.sequence.nodeId)).export?.error).toBe('creative_reference_changed');
  }, 90000);
});
