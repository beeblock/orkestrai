import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSvelarTest } from '@beeblock/svelar/testing';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CreateCanvasNodeDto } from '$lib/modules/agent-room/application/dto/WorkspaceDtos.js';
import { workspaceService } from '$lib/modules/agent-room/application/services/WorkspaceService.js';
import { bridgeService } from '$lib/modules/agent-room/application/services/BridgeService.js';
import { agentSessionService } from '$lib/modules/agent-room/application/services/AgentSessionService.js';
import { providerProfileService } from '$lib/modules/agent-room/application/services/ProviderProfileService.js';
import { workspaceRepository } from '$lib/modules/agent-room/infrastructure/repositories/WorkspaceRepository.js';
import { providerProfileRepository } from '$lib/modules/agent-room/infrastructure/repositories/ProviderProfileRepository.js';
import { presetService } from '$lib/modules/agent-room/application/services/PresetService.js';
import { bridgeRecruitSchema } from '$lib/modules/agent-room/contracts/schemas/bridgeSchemas.js';
import type { CanvasNode, TerminalNodePayload } from '$lib/modules/agent-room/domain/types.js';
import { ptySessionManager } from '$lib/modules/agent-room/infrastructure/pty/PtySessionManager.ts';

describe('new agent account inheritance', () => {
  useSvelarTest({ refreshDatabase: true });
  const roots: string[] = [];
  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })));
  });
  async function fixture() {
    const root = await mkdtemp(join(tmpdir(), 'orkestrai-profile-inheritance-')); roots.push(root);
    const workspace = await workspaceRepository.createWorkspace({ name: 'Account inheritance', workingDir: root });
    const configDir = join(root, 'claude-work'); await mkdir(configDir);
    const profile = await providerProfileService.create({ providerId: 'claude', name: 'Work', configDir });
    const leader = await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'terminal', title: 'Lead', payload: { provider: 'claude', command: '/bin/cat', maestro: true, profileId: profile.id } });
    const create = (extra: Record<string, unknown> = {}, workspaceId = workspace.id) => workspaceService.createNode(new CreateCanvasNodeDto(workspaceId, 'terminal', 'New agent', 0, 0, 560, 340, 0, { command: '/bin/cat', args: [], provider: 'claude', ...extra }));
    return { root, workspace, profile, leader, create };
  }
  function mockLaunch() {
    return vi.spyOn(agentSessionService, 'ensure').mockImplementation(async (_workspaceId, nodeId) => ({ nodeId, sessionId: `test-${nodeId}`, state: 'started' }));
  }
  const accountOf = (node?: CanvasNode | null) => (node?.payload as TerminalNodePayload | undefined)?.profileId ?? null;

  it('shares account override validation across HTTP, CLI and MCP', () => {
    const base = { from: 'Lead', title: 'Engineer', provider: 'claude' };
    expect(bridgeRecruitSchema.safeParse({ ...base, defaultProfile: true }).success).toBe(true);
    expect(bridgeRecruitSchema.safeParse({ ...base, profile: 'Work', defaultProfile: true }).success).toBe(false);
    expect(bridgeRecruitSchema.safeParse({ from: 'Lead', title: 'Engineer', defaultProfile: true }).success).toBe(false);
  });

  it('inherits the leader account through normal node creation without persisting resolved configuration', async () => {
    const { create, profile } = await fixture();
    const node = await create();
    expect(node.payload).toMatchObject({ provider: 'claude', profileId: profile.id });
    expect(JSON.stringify(node.payload)).not.toContain(profile.configDir);
    expect(JSON.stringify(node.payload)).not.toContain('CLAUDE_CONFIG_DIR');
  });
  it('keeps the default account when the leader uses it', async () => {
    const { leader, create } = await fixture();
    await workspaceRepository.updateNode(leader.id, { payload: { ...leader.payload, profileId: null } });
    expect(accountOf(await create())).toBeNull();
  });
  it('honors explicit named and default account choices without changing the leader', async () => {
    const { root, leader, profile, create } = await fixture();
    const other = await providerProfileService.create({ providerId: 'claude', name: 'Personal', configDir: join(root, 'claude-personal') });
    expect(accountOf(await create({ profileId: other.id }))).toBe(other.id);
    expect((await create({ profileId: null })).payload).toHaveProperty('profileId', null);
    expect(accountOf(await workspaceRepository.getNode(leader.id))).toBe(profile.id);
  });
  it('never inherits across providers or workspaces', async () => {
    const { root, create } = await fixture();
    expect(accountOf(await create({ provider: 'codex' }))).toBeNull();
    const other = await workspaceRepository.createWorkspace({ name: 'Other workspace', workingDir: root });
    expect(accountOf(await create({}, other.id))).toBeNull();
  });
  it('fails before creating a node when the inherited account is missing', async () => {
    const { workspace, profile, create } = await fixture();
    await providerProfileRepository.delete(profile.id);
    await expect(create()).rejects.toMatchObject({ code: 'profile_not_found' });
    expect(await workspaceRepository.listNodes(workspace.id)).toHaveLength(1);
  });
  it('uses the actual recruiting leader account, including its floor runtime', async () => {
    const { root, workspace, leader } = await fixture(); mockLaunch();
    const second = await providerProfileService.create({ providerId: 'claude', name: 'Second account', configDir: join(root, 'second') });
    const executionRuntime = { kind: 'wsl', distribution: 'Ubuntu', linuxWorkingDir: '/work/project' };
    const coordinator = await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'terminal', title: 'Second lead', payload: { provider: 'claude', maestro: true, profileId: second.id, executionRuntime } });
    const result = await bridgeService.recruit(workspace.id, { from: coordinator.id, title: 'Specialist', provider: 'claude' });
    expect((await workspaceRepository.getNode(result.nodeId))?.payload).toMatchObject({ profileId: second.id, executionRuntime });
    expect(accountOf(await workspaceRepository.getNode(leader.id))).not.toBe(second.id);
  });
  it('honors bridge account overrides and rejects conflicting selections before launching', async () => {
    const { root, workspace, leader } = await fixture(); const launch = mockLaunch();
    const other = await providerProfileService.create({ providerId: 'claude', name: 'Personal', configDir: join(root, 'personal') });
    const named = await bridgeService.recruit(workspace.id, { from: leader.id, title: 'Personal agent', provider: 'claude', profile: 'Personal' });
    expect(accountOf(await workspaceRepository.getNode(named.nodeId))).toBe(other.id);
    const machine = await bridgeService.recruit(workspace.id, { from: leader.id, title: 'Default agent', provider: 'claude', defaultProfile: true });
    expect((await workspaceRepository.getNode(machine.nodeId))?.payload).toHaveProperty('profileId', null);
    await expect(bridgeService.recruit(workspace.id, { from: leader.id, title: 'Invalid', provider: 'claude', profile: 'Personal', defaultProfile: true })).rejects.toThrow('either');
    expect(launch).toHaveBeenCalledTimes(2);
  });
  it('passes the inherited Claude configuration to the actual child process only', async () => {
    const { root, workspace, profile, create } = await fixture();
    const node = await create(); const output = join(root, 'profile-observed.txt');
    const original = ptySessionManager.create.bind(ptySessionManager);
    vi.spyOn(ptySessionManager, 'create').mockImplementation(input => original({ ...input, command: process.execPath, args: ['-e', `require('node:fs').writeFileSync(${JSON.stringify(output)},process.env.CLAUDE_CONFIG_DIR||'missing');setInterval(()=>{},1000)`] }));
    const launched = await agentSessionService.ensure(workspace.id, node.id);
    try {
      await expect.poll(() => readFile(output, 'utf8').catch(() => ''), { timeout: 5000 }).toBe(profile.configDir);
      expect(JSON.stringify((await workspaceRepository.getNode(node.id))?.payload)).not.toContain(profile.configDir);
    } finally { ptySessionManager.kill(launched.sessionId); }
  });

  it('inherits the destination leader account when a team recipe does not specify another account', async () => {
    const { workspace, profile, root } = await fixture();
    const source = await workspaceRepository.createWorkspace({ name: 'Recipe source', workingDir: root });
    await workspaceRepository.createNode({ workspaceId: source.id, type: 'terminal', title: 'Recipe engineer', payload: { command: 'claude', provider: 'claude' } });
    const preset = await presetService.createFromWorkspace(source.id, { name: 'Inherited team' });
    await presetService.apply(preset.id, { workspaceId: workspace.id });
    const engineer = (await workspaceRepository.listNodes(workspace.id)).find(n => n.title === 'Recipe engineer');
    expect(accountOf(engineer)).toBe(profile.id);
  });
  it('resolves a recipe leader before its specialists and validates accounts before any team writes', async () => {
    const { workspace, profile, root } = await fixture();
    const source = await workspaceRepository.createWorkspace({ name: 'Ordered recipe', workingDir: root });
    await workspaceRepository.createNode({ workspaceId: source.id, type: 'terminal', title: 'Recipe specialist first', payload: { command: 'claude', provider: 'claude' } });
    const personal = await providerProfileService.create({ providerId: 'claude', name: 'Recipe account', configDir: join(root, 'recipe-account') });
    await workspaceRepository.createNode({ workspaceId: source.id, type: 'terminal', title: 'Recipe lead last', payload: { command: 'claude', provider: 'claude', maestro: true, profileId: personal.id } });
    const preset = await presetService.createFromWorkspace(source.id, { name: 'Ordered accounts' });
    await presetService.apply(preset.id, { workspaceId: workspace.id });
    const nodes = await workspaceRepository.listNodes(workspace.id);
    expect(accountOf(nodes.find(n => n.title === 'Recipe specialist first'))).toBe(personal.id);
    expect(accountOf(nodes.find(n => n.title === 'Lead'))).toBe(profile.id);
    await providerProfileRepository.delete(personal.id);
    await expect(presetService.apply(preset.id, { workspaceId: workspace.id })).rejects.toMatchObject({ code: 'profile_not_found' });
    expect(await workspaceRepository.listNodes(workspace.id)).toHaveLength(nodes.length);
  });
});
