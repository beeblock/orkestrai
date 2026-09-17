import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSvelarTest } from '@beeblock/svelar/testing';
import { uuidv7 } from '@beeblock/svelar/support';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CreativeBrandKitService } from '$lib/modules/creative-media/application/services/CreativeBrandKitService.js';
import { creativeBrandKitRepository } from '$lib/modules/creative-media/infrastructure/repositories/CreativeBrandKitRepository.js';
import { creativeMediaRepository } from '$lib/modules/creative-media/infrastructure/repositories/CreativeMediaRepository.js';
import { CreativeMediaDto } from '$lib/modules/creative-media/application/dto/CreativeMediaDto.js';
import { ExecuteCreativeMediaAction } from '$lib/modules/creative-media/application/actions/ExecuteCreativeMediaAction.js';
import { creativeWorkflowService } from '$lib/modules/creative-media/application/services/CreativeWorkflowService.js';
import { creativeBrandDefinitionSchema, type CreativeBrandCommand } from '$lib/modules/creative-media/contracts/schemas/creative-brand.schema.js';
import type { CreativeBrandKit } from '$lib/modules/creative-media/domain/brand-kit.js';
import { workspaceRepository } from '$lib/modules/agent-room/infrastructure/repositories/WorkspaceRepository.js';
import { creativeWorkspaceGateway } from '$lib/modules/agent-room/application/services/CreativeWorkspaceGateway.js';

vi.mock('$lib/modules/agent-room/application/services/AutonomyPolicyService.js', () => ({ autonomyPolicyService: { recordSemanticEffect: vi.fn(async () => undefined) } }));
const folders: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true }); });
describe('versioned brand kits', () => {
  useSvelarTest({ refreshDatabase: true });
  async function fixture() {
    const folder = await mkdtemp(join(tmpdir(), 'orkestrai-brand-')); folders.push(folder);
    const workspace = await workspaceRepository.createWorkspace({ name: 'Brand test', workingDir: folder });
    const bytes = await readFile('electron/resources/icons/512x512.png'); await writeFile(join(folder, 'logo.png'), bytes);
    const service = new CreativeBrandKitService();
    const execute = (input: CreativeBrandCommand) => service.execute(workspace.id, input, { type: 'user' }) as Promise<CreativeBrandKit>;
    const definition = creativeBrandDefinitionSchema.parse({ name: 'Studio', colors: [{ name: 'Primary', value: '#2563EB' }], assets: [{ label: 'Logo', kind: 'logo', path: 'logo.png' }], rules: 'Keep the mark unchanged.', tone: 'Direct and welcoming' });
    const kit = await execute({ command: 'create', definition });
    return { folder, workspace, bytes, service, execute, definition, kit };
  }
  it('freezes approved bytes, rejects mutation and forks an independent draft', async () => {
    const f = await fixture();
    const locked = await f.execute({ command: 'lock', id: f.kit.id, revision: 1 });
    expect(locked.state).toBe('locked'); expect(locked.snapshot?.digest).toMatch(/^[a-f0-9]{64}$/);
    const copy = await readFile(join(f.folder, locked.definition.assets[0].path)); expect(copy.equals(f.bytes)).toBe(true);
    await writeFile(join(f.folder, 'logo.png'), 'changed original');
    expect((await readFile(join(f.folder, locked.definition.assets[0].path))).equals(f.bytes)).toBe(true);
    await expect(f.execute({ command: 'update', id: locked.id, revision: locked.revision, definition: f.definition })).rejects.toThrow('creative_brand_locked');
    const fork = await f.execute({ command: 'fork', id: locked.id });
    expect(fork).toMatchObject({ state: 'draft', version: 2, familyId: locked.familyId });
    await expect(f.execute({ command: 'update', id: fork.id, revision: 100, definition: f.definition })).rejects.toThrow('creative_revision_conflict');
  });
  it('imports exactly one approved version and native bundle without authority or original paths', async () => {
    const f = await fixture(), target = await fixture();
    const kit = await f.execute({ command: 'lock', id: f.kit.id, revision: 1 });
    const result = await f.service.execute(target.workspace.id, { command: 'place', id: kit.id, sourceWorkspaceId: f.workspace.id }, { type: 'user' }) as { kit: CreativeBrandKit; nodes: Array<{ type: string; payload: Record<string, unknown> }> };
    expect(result.kit.snapshot).toEqual(kit.snapshot);
    expect((await readFile(join(target.folder, kit.definition.assets[0].path))).equals(f.bytes)).toBe(true);
    expect(result.nodes.map(node => node.type)).toEqual(['group', 'note', 'image']);
    expect(result.nodes[1].payload.content).toContain('#2563EB');
    expect(result.nodes[1].payload.content).toContain('Keep the mark unchanged.');
    expect(JSON.stringify(result.nodes)).not.toContain('profileId');
    await f.service.execute(target.workspace.id, { command: 'place', id: kit.id, sourceWorkspaceId: f.workspace.id }, { type: 'user' });
    expect((await creativeBrandKitRepository.list(target.workspace.id)).filter(item => item.familyId === kit.familyId)).toHaveLength(1);
    await writeFile(join(f.folder, kit.definition.assets[0].path), f.bytes.subarray(0, 100));
    await expect(f.service.execute(target.workspace.id, { command: 'place', id: kit.id, sourceWorkspaceId: f.workspace.id }, { type: 'user' })).rejects.toThrow();
  });
  it('uses the same agent bridge but reserves approval and cross-workspace access to the owner', async () => {
    const f = await fixture();
    const actor = { type: 'agent' as const, nodeId: uuidv7(), taskId: uuidv7() };
    vi.spyOn(creativeWorkflowService, 'assertActor').mockResolvedValue(f.workspace);
    const result = await new ExecuteCreativeMediaAction().execute(CreativeMediaDto.from(f.workspace.id, actor, 'brands', undefined, { command: 'list' }));
    expect(result).toEqual([f.kit]);
    await expect(f.service.execute(f.workspace.id, { command: 'lock', id: f.kit.id, revision: 1 }, actor)).rejects.toThrow('creative_owner_required');
    await expect(f.service.execute(f.workspace.id, { command: 'library' }, actor)).rejects.toThrow('creative_owner_required');
    await expect(f.service.execute(f.workspace.id, { command: 'place', id: f.kit.id, sourceWorkspaceId: uuidv7() }, actor)).rejects.toThrow('creative_owner_required');
    await expect(f.service.execute(f.workspace.id, { command: 'create', definition: { ...f.definition, assets: [{ label: 'Escape', kind: 'logo', path: '../secret.png' }] } }, actor)).rejects.toThrow();
  });
  it('rolls back bundle creation on failure and cleans workspace records', async () => {
    const f = await fixture(), target = await fixture();
    await f.execute({ command: 'lock', id: f.kit.id, revision: 1 });
    vi.spyOn(creativeWorkspaceGateway, 'placeBrand').mockRejectedValueOnce(new Error('bundle failed'));
    await expect(f.service.execute(target.workspace.id, { command: 'place', id: f.kit.id, sourceWorkspaceId: f.workspace.id }, { type: 'user' })).rejects.toThrow('bundle failed');
    expect((await creativeBrandKitRepository.list(target.workspace.id)).map(item => item.id)).toEqual([target.kit.id]);
    await creativeMediaRepository.removeWorkspace(f.workspace.id);
    expect(await creativeBrandKitRepository.list(f.workspace.id)).toEqual([]);
  });
});
