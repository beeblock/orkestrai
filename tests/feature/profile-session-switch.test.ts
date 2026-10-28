import type { TerminalNodePayload } from '$lib/modules/agent-room/domain/types.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { useSvelarTest } from '@beeblock/svelar/testing';
import { workspaceRepository } from '$lib/modules/agent-room/infrastructure/repositories/WorkspaceRepository.js';
import { workspaceService } from '$lib/modules/agent-room/application/services/WorkspaceService.js';
import { providerProfileService } from '$lib/modules/agent-room/application/services/ProviderProfileService.js';
import { profileSessionContinuityService } from '$lib/modules/agent-room/application/services/ProfileSessionContinuityService.js';
import { agentSessionService } from '$lib/modules/agent-room/application/services/AgentSessionService.js';
import { ptySessionManager } from '$lib/modules/agent-room/infrastructure/pty/PtySessionManager.ts';
import { getAgentAdapter } from '$lib/modules/agent-room/application/adapters/registry.js';

const roots: string[] = [];
const sessions: string[] = [];
describe('switch Claude accounts without replacing the conversation', () => {
  useSvelarTest({ refreshDatabase: true });
  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    for (const id of sessions.splice(0)) ptySessionManager.kill(id);
    await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
  });
  async function fixture(live = true) {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'orkestrai-switch-profile-'))); roots.push(root);
    const cwd = join(root, 'workspace'), a = join(root, 'a'), b = join(root, 'b');
    await Promise.all([mkdir(cwd), mkdir(a), mkdir(b)]);
    const workspace = await workspaceRepository.createWorkspace({ name: 'Own accounts', workingDir: cwd });
    // Do not provision against the owner's home/provider configuration in a feature test.
    vi.spyOn(workspaceService, 'get').mockResolvedValue(workspace);
    vi.spyOn(getAgentAdapter('claude'), 'detect').mockResolvedValue({ installed: true, detail: 'fixture' });
    vi.spyOn(getAgentAdapter('claude'), 'interactiveCommand').mockReturnValue({ command: '/bin/cat', args: [] });
    const pa = await providerProfileService.create({ providerId: 'claude', name: 'Account A', configDir: a });
    const pb = await providerProfileService.create({ providerId: 'claude', name: 'Account B', configDir: b });
    const id = randomUUID(), project = join('projects', cwd.replace(/[^a-zA-Z0-9]/g, '-'));
    await mkdir(join(a, project), { recursive: true });
    const text = JSON.stringify({ type: 'user', isSidechain: false, sessionId: id, message: { content: 'Preserve my current task' } }) + '\n';
    await writeFile(join(a, project, `${id}.jsonl`), text);
    const node = await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'terminal', title: 'Leader',
      payload: { command: '/bin/cat', provider: 'claude', profileId: pa.id, agentSessionId: id, args: ['--dangerously-skip-permissions', '--model', 'sonnet', '--effort', 'high'], maestro: true } });
    const process = live ? ptySessionManager.create({ command: '/bin/cat', cwd, workspaceId: workspace.id, nodeId: node.id,
      provider: 'claude', profileId: pa.id, agentSessionId: id, env: { CLAUDE_CONFIG_DIR: a } }) : null;
    if (process) { sessions.push(process.id); await workspaceRepository.updateNode(node.id, { payload: { ...node.payload, sessionId: process.id } as never }); }
    const original = ptySessionManager.create.bind(ptySessionManager);
    const spawn = vi.spyOn(ptySessionManager, 'create').mockImplementation(input => {
      const session = original({ ...input, command: '/bin/cat', args: [] }); sessions.push(session.id); return session;
    });
    return { root, cwd, a, b, workspace, node, pa, pb, id, project, text, process, spawn };
  }

  it('keeps the exact conversation and node identity, and resumes under the new account', async () => {
    const f = await fixture();
    const changed = await workspaceService.changeTerminalProvider({ workspaceId: f.workspace.id, nodeId: f.node.id, provider: 'claude', profileId: f.pb.id });
    expect(changed?.payload).toMatchObject({ provider: 'claude', profileId: f.pb.id, agentSessionId: f.id, maestro: true, args: (f.node.payload as TerminalNodePayload).args });
    expect((changed?.payload as TerminalNodePayload | undefined)?.sessionId).toBeUndefined();
    expect((changed?.payload as TerminalNodePayload | undefined)?.env).toBeUndefined();
    expect(JSON.stringify(changed?.payload)).not.toContain(f.b);
    expect(await readFile(join(f.b, f.project, `${f.id}.jsonl`), 'utf8')).toBe(f.text);
    expect(await readFile(join(f.a, f.project, `${f.id}.jsonl`), 'utf8')).toBe(f.text);
    expect(ptySessionManager.get(f.process!.id)).toBeNull();
    const spawn = f.spawn;
    const resumed = await agentSessionService.ensure(f.workspace.id, f.node.id, { requireResume: true });
    expect(resumed.state).toBe('existing');
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(spawn.mock.calls[0][0]).toMatchObject({ profileId: f.pb.id, agentSessionId: f.id, env: { CLAUDE_CONFIG_DIR: f.b } });
    expect(spawn.mock.calls[0][0].args).toContain('--resume');
    expect(spawn.mock.calls[0][0].args).toContain(f.id);
    expect(ptySessionManager.transcriptStorageRoots(resumed.sessionId)).toEqual({ claudeConfigDir: f.b });
  });

  it('resumes an offline agent from its configured profile rather than the default account', async () => {
    const f = await fixture(false);
    await workspaceService.changeTerminalProvider({ workspaceId: f.workspace.id, nodeId: f.node.id, provider: 'claude', profileId: f.pb.id });
    const nodes = await workspaceService.listNodes(f.workspace.id);
    expect((nodes.find(node => node.id === f.node.id)?.payload as TerminalNodePayload | undefined)?.agentSessionId).toBe(f.id);
  });

  it('leaves the old terminal alive when the destination conversation diverged', async () => {
    const f = await fixture(); await mkdir(join(f.b, f.project), { recursive: true });
    await writeFile(join(f.b, f.project, `${f.id}.jsonl`), 'A different history');
    await expect(workspaceService.changeTerminalProvider({ workspaceId: f.workspace.id, nodeId: f.node.id, provider: 'claude', profileId: f.pb.id })).rejects.toThrow('PROFILE_SESSION_CONFLICT');
    expect(ptySessionManager.get(f.process!.id)?.exited).toBe(false);
    expect(((await workspaceRepository.getNode(f.node.id))?.payload as TerminalNodePayload | undefined)?.profileId).toBe(f.pa.id);
  });

  it('refuses to stop a terminal containing an unsent owner draft', async () => {
    const f = await fixture();
    ptySessionManager.writeHumanInput(f.process!.id, 'unfinished owner instruction');
    await expect(workspaceService.changeTerminalProvider({ workspaceId: f.workspace.id, nodeId: f.node.id, provider: 'claude', profileId: f.pb.id })).rejects.toThrow('PROFILE_SESSION_OWNER_DRAFT');
    expect(ptySessionManager.get(f.process!.id)?.exited).toBe(false);
    expect((await workspaceRepository.getNode(f.node.id))?.payload).toMatchObject({ profileId: f.pa.id, agentSessionId: f.id });
  });

  it('returns to the actual default account rather than a stale persisted directory', async () => {
    const f = await fixture(false);
    const defaultRoot = join(f.root, 'default'); await mkdir(defaultRoot);
    vi.stubEnv('CLAUDE_CONFIG_DIR', defaultRoot);
    await workspaceRepository.updateNode(f.node.id, { payload: { ...f.node.payload, env: { CLAUDE_CONFIG_DIR: f.a, KEEP_ME: 'yes' } } as never });
    const copy = vi.spyOn(profileSessionContinuityService, 'prepare').mockResolvedValue({ commit: async () => {} });
    const updated = await workspaceService.changeTerminalProvider({ workspaceId: f.workspace.id, nodeId: f.node.id, provider: 'claude', profileId: null });
    expect(copy).toHaveBeenCalledWith(expect.objectContaining({ sourceRoot: f.a, targetRoot: defaultRoot }));
    expect((updated?.payload as TerminalNodePayload).env).toEqual({ KEEP_ME: 'yes' });
  });

  it('retains the saved account and restarts it when copying fails after the old terminal exits', async () => {
    const f = await fixture();
    vi.spyOn(profileSessionContinuityService, 'prepare').mockResolvedValue({ commit: async () => { throw new Error('DISK_WRITE_FAILED'); } });
    const restore = vi.spyOn(agentSessionService, 'ensure').mockResolvedValue({ nodeId: f.node.id, sessionId: 'restored', state: 'resumed' });
    await expect(workspaceService.changeTerminalProvider({ workspaceId: f.workspace.id, nodeId: f.node.id, provider: 'claude', profileId: f.pb.id })).rejects.toThrow('DISK_WRITE_FAILED');
    expect(restore).toHaveBeenCalledWith(f.workspace.id, f.node.id, { requireResume: true });
    expect((await workspaceRepository.getNode(f.node.id))?.payload).toMatchObject({ profileId: f.pa.id, agentSessionId: f.id });
    expect(await readFile(join(f.a, f.project, `${f.id}.jsonl`), 'utf8')).toBe(f.text);
  });

  it('serializes two profile changes so the second resumes the result of the first', async () => {
    const f = await fixture(); const c = join(f.root, 'c'); await mkdir(c);
    const pc = await providerProfileService.create({ providerId: 'claude', name: 'Account C', configDir: c });
    await Promise.all([f.pb.id, pc.id].map(profileId => workspaceService.changeTerminalProvider({ workspaceId: f.workspace.id, nodeId: f.node.id, provider: 'claude', profileId })));
    expect((await workspaceRepository.getNode(f.node.id))?.payload).toMatchObject({ profileId: pc.id, agentSessionId: f.id });
    expect(await readFile(join(c, f.project, `${f.id}.jsonl`), 'utf8')).toBe(f.text);
  });
});
