import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { useSvelarTest } from '@beeblock/svelar/testing';
import { uuidv7 } from '@beeblock/svelar/support';
import { BridgeController } from '$lib/modules/agent-room/interface/http/controllers/BridgeController.js';
import { workspaceRepository } from '$lib/modules/agent-room/infrastructure/repositories/WorkspaceRepository.js';
import { bridgeService } from '$lib/modules/agent-room/application/services/BridgeService.js';
import { workspaceService } from '$lib/modules/agent-room/application/services/WorkspaceService.js';
import { providerProfileService } from '$lib/modules/agent-room/application/services/ProviderProfileService.js';
import { autonomyPolicyService } from '$lib/modules/agent-room/application/services/AutonomyPolicyService.js';
import { AgentBoardTask } from '$lib/modules/agent-room/domain/models/AgentBoardTask.js';
import { ptySessionManager } from '$lib/modules/agent-room/infrastructure/pty/PtySessionManager.js';

function event(body: unknown, terminalToken: string | null) {
  const url = new URL('http://127.0.0.1/api/agent-room/bridge/agent-profile');
  return { url, params: {}, request: new Request(url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer workspace-test',
    ...(terminalToken ? { 'x-orkestrai-agent-token': terminalToken } : {}) }, body: JSON.stringify(body) }) };
}

describe('profile switch bridge contract', () => {
  useSvelarTest({ refreshDatabase: true });
  const sessions: string[] = [];
  afterEach(() => { vi.restoreAllMocks(); for (const id of sessions.splice(0)) ptySessionManager.kill(id); });
  async function fixture(maestro = false) {
    const workspace = await workspaceRepository.createWorkspace({ name: 'Profile scopes', workingDir: '/tmp' });
    const id = randomUUID();
    const actor = await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'terminal', title: 'Actor', payload: { provider: 'claude', maestro, agentSessionId: id } });
    const other = await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'terminal', title: 'Other', payload: { provider: 'claude', agentSessionId: id } });
    const taskId = uuidv7();
    await AgentBoardTask.create({ id: taskId, workspace_id: workspace.id, title: 'Change own account', status: 'doing', assignee_node_id: actor.id, created_by: 'user', created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
    const token = randomUUID(); const pty = ptySessionManager.create({ command: '/bin/cat', cwd: '/tmp', workspaceId: workspace.id, nodeId: actor.id, provider: 'claude', bridgeAgentToken: token }); sessions.push(pty.id);
    vi.spyOn(bridgeService, 'resolveWorkspaceByToken').mockResolvedValue(workspace);
    vi.spyOn(bridgeService, 'listAgents').mockResolvedValue([{ nodeId: actor.id, title: 'Actor' }, { nodeId: other.id, title: 'Other' }] as never);
    vi.spyOn(providerProfileService, 'resolveByIdOrName').mockResolvedValue({ id: 'profile-b', providerId: 'claude', name: 'B' } as never);
    vi.spyOn(autonomyPolicyService, 'runWindow').mockResolvedValue({ allowed: true } as never);
    const change = vi.spyOn(workspaceService, 'changeTerminalProvider').mockResolvedValue({ ...actor, payload: { provider: 'claude', profileId: 'profile-b', agentSessionId: id, env: { TEST_CREDENTIAL: 'never-return-this' } } } as never);
    return { workspace, actor, other, taskId, token, change, controller: new BridgeController(), body: { from: actor.id, profile: 'B', taskId } };
  }

  it('rejects a workspace token without an active terminal identity', async () => {
    const f = await fixture(); expect((await f.controller.switchAgentProfile(event(f.body, null) as any)).status).toBe(403); expect(f.change).not.toHaveBeenCalled();
  });
  it('rejects an authenticated specialist claiming the leader identity', async () => {
    const f = await fixture(); expect((await f.controller.switchAgentProfile(event({ ...f.body, from: f.other.id }, f.token) as any)).status).toBe(403); expect(f.change).not.toHaveBeenCalled();
  });
  it('allows a specialist to change itself and returns no environment or credentials', async () => {
    const f = await fixture(); const response = await f.controller.switchAgentProfile(event(f.body, f.token) as any); expect(response.status, await response.clone().text()).toBe(200);
    const json = await response.json(); expect(json.data).toEqual({ nodeId: f.actor.id, provider: 'claude', profileId: 'profile-b', conversationPreserved: true });
    expect(JSON.stringify(json)).not.toContain('never-return-this'); expect(JSON.stringify(json)).not.toContain('env');
  });
  it('rejects a specialist changing a teammate', async () => {
    const f = await fixture(); expect((await f.controller.switchAgentProfile(event({ ...f.body, agent: f.other.id }, f.token) as any)).status).toBe(403); expect(f.change).not.toHaveBeenCalled();
  });
  it('allows the authenticated leader to change a teammate', async () => {
    const f = await fixture(true); const response = await f.controller.switchAgentProfile(event({ ...f.body, agent: f.other.id }, f.token) as any); expect(response.status, await response.clone().text()).toBe(200);
    expect(f.change).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: f.workspace.id, nodeId: f.other.id, provider: 'claude', profileId: 'profile-b' }));
  });
  it('honors a workspace pause and leaves the account unchanged', async () => {
    const f = await fixture(); vi.mocked(autonomyPolicyService.runWindow).mockResolvedValue({ allowed: false } as never);
    expect((await f.controller.switchAgentProfile(event(f.body, f.token) as any)).status).toBe(403); expect(f.change).not.toHaveBeenCalled();
  });
  it('rejects a completed or unassigned task', async () => {
    const f = await fixture(); await AgentBoardTask.query().where('id', f.taskId).update({ status: 'done' });
    expect((await f.controller.switchAgentProfile(event(f.body, f.token) as any)).status).toBe(403); expect(f.change).not.toHaveBeenCalled();
  });
  it('requires an explicit profile selection and rejects unknown request fields', async () => {
    const f = await fixture(); const { profile, ...missing } = f.body;
    expect((await f.controller.switchAgentProfile(event(missing, f.token) as any)).status).toBe(400);
    expect((await f.controller.switchAgentProfile(event({ ...f.body, command: 'unexpected' }, f.token) as any)).status).toBe(400); expect(f.change).not.toHaveBeenCalled();
  });
});
