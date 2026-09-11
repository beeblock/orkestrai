import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSvelarTest } from '@beeblock/svelar/testing';
import { bridgeService } from '$lib/modules/agent-room/application/services/BridgeService.js';
import { computerService } from '$lib/modules/agent-room/application/services/ComputerService.js';
import { taskBoardService } from '$lib/modules/agent-room/application/services/TaskBoardService.js';
import { autonomyPolicyService } from '$lib/modules/agent-room/application/services/AutonomyPolicyService.js';
import { workspaceRepository } from '$lib/modules/agent-room/infrastructure/repositories/WorkspaceRepository.js';
import { ptySessionManager } from '$lib/modules/agent-room/infrastructure/pty/PtySessionManager.js';
import { BridgeController } from '$lib/modules/agent-room/interface/http/controllers/BridgeController.js';

function event(token: string, agentToken: string | null, body: unknown) {
  const url = new URL('http://localhost/api/agent-room/bridge/computers');
  return { request: new Request(url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...(agentToken ? { 'x-orkestrai-agent-token': agentToken } : {}) }, body: JSON.stringify(body) }), params: {}, url };
}

describe('natural-language computer preparation through the authenticated bridge', () => {
  useSvelarTest({ refreshDatabase: true });
  const dirs: string[] = [];
  const sessions: string[] = [];
  afterEach(() => {
    vi.restoreAllMocks();
    for (const id of sessions.splice(0)) ptySessionManager.kill(id);
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('lets the agent author its task and node, preserves owner pauses, and rejects impersonation', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'orkestrai-computer-auth-'));
    dirs.push(dir);
    const workspace = await workspaceRepository.createWorkspace({ name: 'Natural desktop request', workingDir: dir });
    const agent = await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'terminal', title: 'Desktop agent', x: 0, y: 0, width: 680, height: 440 });
    const other = await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'terminal', title: 'Other agent' });
    sessions.push(ptySessionManager.create({ command: '/bin/cat', cwd: dir, workspaceId: workspace.id, nodeId: agent.id, provider: 'codex', bridgeAgentToken: 'desktop-agent-test-token', env: { ORKESTRAI_AGENT_TOKEN: 'desktop-agent-test-token' } }).id);
    const token = await bridgeService.getOrCreateToken(workspace.id);
    const policy = await autonomyPolicyService.get(workspace.id);
    await autonomyPolicyService.update(workspace.id, { enabled: true, mode: 'bounded', policy: { ...policy.policy, capabilities: ['computer'], allowedApps: ['com.apple.calculator'] } });
    vi.spyOn(computerService as any, 'adapterSnapshot').mockResolvedValue({ platform: 'macos', available: true, reason: 'ready', detail: null, permissions: { accessibility: 'granted', screenRecording: 'granted' }, displays: [], windows: [], focusedWindowId: null });
    const create = vi.spyOn(taskBoardService, 'create');
    const controller = new BridgeController();
    const response = await controller.taskCreate(event(token, 'desktop-agent-test-token', { title: 'Calculate 73 times 19', assignee: agent.id, from: agent.id }) as any) as Response;
    expect(response.status, await response.clone().text()).toBe(201);
    expect(create.mock.calls[0][1].dispatch).toBe(false);
    const task = (await response.json()).data;
    expect(task.assigneeNodeId).toBe(agent.id);
    const operation = { from: agent.id, taskId: task.id, idempotencyKey: 'calculator:prepare', input: { command: 'prepare' } };
    for (const [auth, from] of [[null, agent.id], ['desktop-agent-test-token', other.id]]) {
      const denied = await controller.computerCommand(event(token, auth, { ...operation, from }) as any) as Response;
      expect(denied.status).toBe(400);
    }
    expect((await workspaceRepository.listNodes(workspace.id)).filter((node) => node.type === 'computer')).toHaveLength(0);
    const accepted = await controller.computerCommand(event(token, 'desktop-agent-test-token', operation) as any) as Response;
    expect(accepted.status, await accepted.clone().text()).toBe(200);
    const computer = (await computerService.snapshot(workspace.id));
    expect(computer.config).toMatchObject({ enabled: true, allowedApplications: ['com.apple.calculator'], allowedDisplays: [] });
    expect((await workspaceRepository.listEdges(workspace.id)).some((edge) => edge.sourceNodeId === agent.id && edge.targetNodeId === computer.nodeId)).toBe(true);
    await computerService.configure(workspace.id, computer.nodeId!, { ...computer.config, enabled: false });
    await controller.computerCommand(event(token, 'desktop-agent-test-token', operation) as any);
    expect((await computerService.snapshot(workspace.id)).config.enabled).toBe(false);
    expect((await workspaceRepository.listNodes(workspace.id)).filter((node) => node.type === 'computer')).toHaveLength(1);
  });
});
