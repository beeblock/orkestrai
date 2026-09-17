import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSvelarTest } from '@beeblock/svelar/testing';
import { uuidv7 } from '@beeblock/svelar/support';
import { mkdtemp, readFile, rm, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { CreativeCharacterService } from '$lib/modules/creative-media/application/services/CreativeCharacterService.js';
import { CreativeMediaFiles } from '$lib/modules/creative-media/application/services/CreativeMediaFiles.js';
import { CreativeCharacterRepository } from '$lib/modules/creative-media/infrastructure/repositories/CreativeCharacterRepository.js';
import { creativeCharacterDefinitionSchema } from '$lib/modules/creative-media/contracts/schemas/creative-character.schema.js';
import { creativeConfigSchema } from '$lib/modules/creative-media/contracts/schemas/creative-media.schema.js';
import { genericFalInput } from '$lib/modules/creative-media/domain/model-input.js';
import { falModelCatalog, validateFalParameters } from '$lib/modules/creative-media/application/services/FalModelCatalogService.js';
import type { FalModelContract } from '$lib/modules/creative-media/domain/model-contract.js';
import { workspaceRepository } from '$lib/modules/agent-room/infrastructure/repositories/WorkspaceRepository.js';

vi.mock('$lib/modules/agent-room/application/services/AutonomyPolicyService.js', () => ({ autonomyPolicyService: { recordSemanticEffect: vi.fn(async () => undefined) } }));
const folders: string[] = [];
afterEach(async () => { for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true }); });
describe('immutable workspace character identities', () => {
  useSvelarTest({ refreshDatabase: true });
  const actor = { type: 'user' as const };
  async function fixture() {
    const folder = await mkdtemp(join(tmpdir(), 'orkestrai-character-')); folders.push(folder);
    const png = PNG.sync.write({ width: 320, height: 320, data: Buffer.alloc(320 * 320 * 4, 180) } as PNG);
    const wav = Buffer.alloc(128); wav.write('RIFF'); wav.write('WAVE', 8);
    await writeFile(join(folder, 'master.png'), png); await writeFile(join(folder, 'voice.wav'), wav);
    const service = new CreativeCharacterService(new CreativeCharacterRepository(), new CreativeMediaFiles());
    const workspaceId = (await workspaceRepository.createWorkspace({ name: 'Character source', workingDir: folder })).id;
    const definition = creativeCharacterDefinitionSchema.parse({ name: 'Mox', appearance: 'Red geometric mascot, green jacket, unchanged proportions.', images: ['master.png'], voice: { kind: 'audio', path: 'voice.wav', language: 'pt-BR', style: 'Calm, dry humor.' } });
    const draft = await service.execute(workspaceId, { command: 'create', definition }, actor) as Awaited<ReturnType<typeof service.read>>;
    return { service, workspaceId, folder, draft, definition, png, wav };
  }
  async function approved() {
    const f = await fixture();
    const locked = await f.service.execute(f.workspaceId, { command: 'lock', id: f.draft.id, revision: 1 }, actor) as typeof f.draft;
    return { ...f, locked };
  }
  const contract: FalModelContract = { id: 'bytedance/seedance-2.5/reference-to-video', name: 'Reference video', category: 'image-to-video', status: 'active', documentationUrl: 'https://fal.ai/models/bytedance/seedance-2.5/reference-to-video/api', digest: 'character-fixture', schema: { type: 'object', required: ['image_urls','audio_urls','generate_audio'], properties: { prompt: { type: 'string' }, image_urls: { type: 'array', maxItems: 30, items: { type: 'string' } }, audio_urls: { type: 'array', maxItems: 10, items: { type: 'string' } }, generate_audio: { type: 'boolean', default: true } } }, outputSchema: {} };
  function config(id: string) { return creativeConfigSchema.parse({ modelId: contract.id, parameters: { generate_audio: true }, characterBindings: [{ id, imagePointers: ['/image_urls/0'], voicePointer: '/audio_urls/0' }] }); }

  it('copies real master assets and persists an immutable version across service instances', async () => {
    const f = await approved();
    expect(f.locked).toMatchObject({ state: 'locked', version: 1, revision: 2 });
    expect(f.locked.snapshot?.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(await readFile(join(f.folder, f.locked.snapshot!.images[0].path))).toEqual(f.png);
    expect(await readFile(join(f.folder, f.locked.snapshot!.voice!.path))).toEqual(f.wav);
    expect(await new CreativeCharacterRepository().read(f.workspaceId, f.locked.id)).toEqual(f.locked);
    for (const command of ['update', 'remove', 'lock'] as const) await expect(f.service.execute(f.workspaceId, { command, id: f.locked.id, revision: 2, definition: { ...f.definition, appearance: 'Changed' } }, actor)).rejects.toThrow('creative_character_locked_or_changed');
    await expect(f.service.repository.update(f.workspaceId, f.locked.id, 2, f.definition)).rejects.toThrow('creative_character_locked_or_changed');
  });
  it('requires owner approval, complete identity and an exact draft revision', async () => {
    const f = await fixture();
    await expect(f.service.execute(f.workspaceId, { command: 'lock', id: f.draft.id, revision: 1 }, { type: 'agent', nodeId: uuidv7(), taskId: uuidv7() })).rejects.toThrow('creative_owner_required');
    await expect(f.service.execute(f.workspaceId, { command: 'lock', id: f.draft.id, revision: 2 }, actor)).rejects.toThrow('creative_revision_conflict');
    await expect(f.service.read(uuidv7(), f.draft.id)).rejects.toThrow('creative_character_not_found');
    const updated = await f.service.execute(f.workspaceId, { command: 'update', id: f.draft.id, revision: 1, definition: { ...f.definition, voice: { kind: 'unassigned' } } }, actor) as typeof f.draft;
    await expect(f.service.execute(f.workspaceId, { command: 'lock', id: f.draft.id, revision: updated.revision }, actor)).rejects.toThrow('creative_character_incomplete');
    await expect(f.service.resolve(f.workspaceId, config(f.draft.id), contract)).rejects.toThrow('creative_character_lock_required');
  });
  it('shares automatic binding with agents and resolves names against the exact approved identity', async () => {
    const f = await approved();
    const schema = vi.spyOn(falModelCatalog, 'contract').mockResolvedValue(contract);
    try {
      const scene = creativeConfigSchema.parse({ modelId: contract.id });
      const result = await f.service.execute(f.workspaceId, { command: 'binding', id: f.locked.id, config: scene }, { type: 'agent', nodeId: uuidv7(), taskId: uuidv7() }) as { binding: { id: string; alias: string; imagePointers: string[]; voicePointer: string } };
      expect(result.binding).toMatchObject({ id: f.locked.id, alias: 'Mox', imagePointers: ['/image_urls/0'], voicePointer: '/audio_urls/0' });
      const configured = { ...scene, prompt: '@{Mox} waves.', characterBindings: [result.binding] };
      const resolved = await f.service.resolve(f.workspaceId, configured, contract);
      expect(resolved.config.prompt).toBe('Mox waves.');
      expect(resolved.characters[0].id).toBe(f.locked.id);
      await expect(f.service.resolve(f.workspaceId, { ...configured, characterBindings: [] }, contract)).rejects.toThrow('creative_reference_alias_missing');
      await expect(f.service.resolve(f.workspaceId, { ...configured, prompt: '@{Another} waves.' }, contract)).rejects.toThrow('creative_reference_alias_missing');
    } finally { schema.mockRestore(); }
  });
  it('forks a new draft without modifying the approved character or its scenes', async () => {
    const f = await approved();
    const fork = await f.service.execute(f.workspaceId, { command: 'fork', id: f.locked.id }, actor) as typeof f.draft;
    expect(fork).toMatchObject({ familyId: f.locked.familyId, version: 2, state: 'draft', revision: 1 });
    expect(fork.id).not.toBe(f.locked.id);
    await f.service.execute(f.workspaceId, { command: 'update', id: fork.id, revision: 1, definition: { ...fork.definition, name: 'Mox revised' } }, actor);
    expect(await f.service.read(f.workspaceId, f.locked.id)).toEqual(f.locked);
  });
  it('pins both identity inputs in the exact model schema without reusing mutable originals', async () => {
    const f = await approved();
    await writeFile(join(f.folder, 'master.png'), 'edited original');
    const resolved = await f.service.resolve(f.workspaceId, config(f.locked.id), contract);
    expect(resolved.directions.join(' ')).toContain('Visual references: @Image1. Voice reference: @Audio1.');
    expect(resolved.characters).toEqual([{ id: f.locked.id, name: 'Mox', version: 1, digest: f.locked.snapshot!.digest }]);
    expect(resolved.config.mediaBindings).toEqual([{ pointer: '/image_urls/0', path: f.locked.snapshot!.images[0].path }, { pointer: '/audio_urls/0', path: f.locked.snapshot!.voice!.path }]);
    const input = genericFalInput(resolved.config, resolved.directions.join('\n'), { '/image_urls/0': 'https://media.invalid/image.png', '/audio_urls/0': 'https://media.invalid/voice.wav' }, contract);
    expect(() => validateFalParameters(contract, input)).not.toThrow();
    await writeFile(join(f.folder, f.locked.snapshot!.voice!.path), Buffer.concat([f.wav, Buffer.from('tampered')]));
    await expect(f.service.resolve(f.workspaceId, config(f.locked.id), contract)).rejects.toThrow('creative_reference_changed');
  });
  it('rejects incompatible or silent models and conflicting media mappings before any paid request', async () => {
    const f = await approved();
    await expect(f.service.resolve(f.workspaceId, config(f.locked.id))).rejects.toThrow('creative_character_model_incompatible');
    const silent = config(f.locked.id); silent.parameters.generate_audio = false;
    await expect(f.service.resolve(f.workspaceId, silent, contract)).rejects.toThrow('creative_character_audio_required');
    const wrong = config(f.locked.id); wrong.characterBindings[0].voicePointer = '/prompt';
    await expect(f.service.resolve(f.workspaceId, wrong, contract)).rejects.toThrow('creative_character_model_incompatible');
    expect(() => creativeConfigSchema.parse({ ...config(f.locked.id), mediaBindings: [{ pointer: '/image_urls/0', path: 'replacement.png' }] })).toThrow();
    await expect(f.service.resolve(uuidv7(), config(f.locked.id), contract)).rejects.toThrow('creative_character_not_found');
  });
  it('scopes a provider voice ID to its account and declared compatible endpoint', async () => {
    const f = await fixture(), profileId = uuidv7();
    const endpoint = 'fal-ai/kling-video/v2.6/pro/image-to-video';
    const draft = await f.service.execute(f.workspaceId, { command: 'update', id: f.draft.id, revision: 1, definition: { ...f.definition, voice: { kind: 'provider', voiceId: 'voice_123', profileId, modelIds: [endpoint], language: 'en-US', style: 'Warm' } } }, actor) as typeof f.draft;
    const locked = await f.service.execute(f.workspaceId, { command: 'lock', id: draft.id, revision: draft.revision }, actor) as typeof f.draft;
    const voiceContract = { ...contract, id: endpoint, digest: 'voice-id-fixture', schema: { ...contract.schema, properties: { ...contract.schema.properties, voice_ids: { type: 'array', maxItems: 2, items: { type: 'string' } } } } };
    const value = config(locked.id); value.modelId = endpoint; value.profileId = profileId; value.characterBindings[0].voicePointer = '/voice_ids/0';
    expect((await f.service.resolve(f.workspaceId, value, voiceContract)).config.parameters.voice_ids).toEqual(['voice_123']);
    value.profileId = uuidv7();
    await expect(f.service.resolve(f.workspaceId, value, voiceContract)).rejects.toThrow('creative_character_model_incompatible');
  });
  it('validates every source before creating any approved reference copies', async () => {
    const f = await fixture();
    await rm(join(f.folder, 'voice.wav'));
    await expect(f.service.execute(f.workspaceId, { command: 'lock', id: f.draft.id, revision: 1 }, actor)).rejects.toThrow();
    await expect(access(join(f.folder, 'generated'))).rejects.toThrow();
    expect((await f.service.read(f.workspaceId, f.draft.id)).state).toBe('draft');
  });
  async function destination() {
    const folder = await mkdtemp(join(tmpdir(), 'orkestrai-character-target-')); folders.push(folder);
    const workspace = await workspaceRepository.createWorkspace({ name: 'Character destination', workingDir: folder });
    return { folder, id: workspace.id };
  }
  it('copies the complete approved identity into another project with native nodes and no dependency on the source', async () => {
    const f = await approved(), target = await destination();
    const result = await f.service.execute(target.id, { command: 'place', sourceWorkspaceId: f.workspaceId, id: f.locked.id, position: { x: 400, y: 600 } }, actor) as { character: typeof f.locked; nodes: Array<{ id: string; type: string; x: number; y: number; payload: Record<string, unknown> }>; edges: unknown[] };
    expect(result.character.id).not.toBe(f.locked.id);
    expect(result.character).toMatchObject({ workspaceId: target.id, familyId: f.locked.familyId, version: 1, state: 'locked', snapshot: f.locked.snapshot, definition: f.locked.definition });
    expect(result.nodes.map(node => node.type)).toEqual(['group', 'note', 'image']);
    expect(result.nodes[0]).toMatchObject({ x: 400, y: 600, payload: { members: result.nodes.slice(1).map(node => node.id), characterId: result.character.id } });
    expect(result.edges).toHaveLength(1);
    expect(await readFile(join(target.folder, f.locked.definition.images[0]))).toEqual(f.png);
    expect(await readFile(join(target.folder, f.locked.snapshot!.voice!.path))).toEqual(f.wav);
    await rm(f.folder, { recursive: true, force: true });
    await f.service.repository.removeWorkspace(f.workspaceId);
    expect((await f.service.resolve(target.id, config(result.character.id), contract)).characters[0].digest).toBe(f.locked.snapshot!.digest);
    expect(await f.service.execute(target.id, { command: 'library' }, actor)).toEqual([expect.objectContaining({ id: result.character.id, workspaceName: 'Character destination' })]);
  });
  it('reuses the imported version without overwriting masters and avoids overlap on repeated drops', async () => {
    const f = await approved(), target = await destination();
    const input = { command: 'place' as const, sourceWorkspaceId: f.workspaceId, id: f.locked.id, position: { x: 0, y: 0 } };
    const first = await f.service.execute(target.id, input, actor) as any;
    const second = await f.service.execute(target.id, input, actor) as any;
    expect(first.character.id).toBe(second.character.id);
    expect(await f.service.repository.list(target.id)).toHaveLength(1);
    expect(first.nodes[0].x === second.nodes[0].x && first.nodes[0].y === second.nodes[0].y).toBe(false);
    await writeFile(join(target.folder, first.character.snapshot.images[0].path), Buffer.concat([f.png, Buffer.from('edited')]));
    await expect(f.service.execute(target.id, input, actor)).rejects.toThrow('creative_reference_changed');
    expect(await workspaceRepository.listNodes(target.id)).toHaveLength(6);
  });
  it('does not expose the global library or cross-workspace copying to agents', async () => {
    const f = await approved(), target = await destination();
    const agent = { type: 'agent' as const, nodeId: uuidv7(), taskId: uuidv7() };
    await expect(f.service.execute(target.id, { command: 'library' }, agent)).rejects.toThrow('creative_owner_required');
    await expect(f.service.execute(target.id, { command: 'place', id: f.locked.id, sourceWorkspaceId: f.workspaceId }, agent)).rejects.toThrow('creative_owner_required');
    await expect(f.service.execute(target.id, { command: 'place', id: f.locked.id, sourceWorkspaceId: f.workspaceId, floorId: uuidv7() }, actor)).rejects.toThrow('creative_workspace_unavailable');
    expect(await workspaceRepository.listNodes(target.id)).toEqual([]);
    await expect(access(join(target.folder, 'generated'))).rejects.toThrow();
  });
  it('refuses a missing reference before copying any part of the character or creating nodes', async () => {
    const f = await approved(), target = await destination();
    await rm(join(f.folder, f.locked.snapshot!.voice!.path));
    await expect(f.service.execute(target.id, { command: 'place', id: f.locked.id, sourceWorkspaceId: f.workspaceId }, actor)).rejects.toThrow();
    await expect(access(join(target.folder, 'generated'))).rejects.toThrow();
    expect(await f.service.repository.list(target.id)).toEqual([]);
    expect(await workspaceRepository.listNodes(target.id)).toEqual([]);
  });
});
