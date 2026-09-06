import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { useSvelarTest } from '@beeblock/svelar/testing';
import { bridgeService } from '$lib/modules/agent-room/application/services/BridgeService.js';
import { gitService } from '$lib/modules/agent-room/application/services/GitService.js';
import { taskBoardService } from '$lib/modules/agent-room/application/services/TaskBoardService.js';
import { workspaceRepository } from '$lib/modules/agent-room/infrastructure/repositories/WorkspaceRepository.js';
import { ptySessionManager } from '$lib/modules/agent-room/infrastructure/pty/PtySessionManager.js';
import { BridgeController } from '$lib/modules/agent-room/interface/http/controllers/BridgeController.js';

function event(token: string, agentToken: string | null, body: unknown) {
  const url = new URL('http://localhost/api/agent-room/bridge/git/execute');
  return {
    request: new Request(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        ...(agentToken ? { 'x-orkestrai-agent-token': agentToken } : {}),
      },
      body: JSON.stringify(body),
    }),
    params: {},
    url,
  };
}

describe('Bridge Git terminal authentication', () => {
  useSvelarTest({ refreshDatabase: true });
  const tempDirs: string[] = [];
  const sessions: string[] = [];

  afterEach(() => {
    for (const session of sessions.splice(0)) ptySessionManager.kill(session);
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('rejects a shared workspace token unless the live assignee PTY also authenticates', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'orkestrai-bridge-git-'));
    tempDirs.push(dir);
    execFileSync('git', ['init', '-b', 'main'], { cwd: dir });
    execFileSync('git', ['config', 'user.email', 'qa@orkestrai.local'], { cwd: dir });
    execFileSync('git', ['config', 'user.name', 'QA'], { cwd: dir });
    writeFileSync(join(dir, 'README.md'), '# QA\n');
    execFileSync('git', ['add', '.'], { cwd: dir });
    execFileSync('git', ['commit', '-m', 'init'], { cwd: dir });

    const workspace = await workspaceRepository.createWorkspace({ name: 'bridge-git-auth', workingDir: dir });
    const agent = await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'terminal', title: 'Assigned agent', x: 0, y: 0, width: 560 });
    const other = await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'terminal', title: 'Other agent', x: 600, y: 0, width: 560 });
    const task = await taskBoardService.create(workspace.id, {
      title: 'Create review branch', assigneeNodeId: agent.id, status: 'doing', dispatch: false,
    });
    const pty = ptySessionManager.create({
      command: '/bin/cat', cwd: dir, workspaceId: workspace.id, nodeId: agent.id,
      provider: 'codex', bridgeAgentToken: 'assigned-terminal-token',
      env: { ORKESTRAI_AGENT_TOKEN: 'assigned-terminal-token' },
    });
    sessions.push(pty.id);
    const token = await bridgeService.getOrCreateToken(workspace.id);
    const revision = (await gitService.status(workspace.id)).revision;
    const operation = {
      operation: 'createBranch', name: 'review/authenticated', expectedRevision: revision,
      confirmed: false, taskId: task.id, from: agent.id,
    };
    const controller = new BridgeController();

    const missing = await controller.gitExecute(event(token, null, operation) as any) as Response;
    expect(missing.status).toBe(400);
    expect((await missing.json()).error).toContain('active terminal identity');

    const spoofed = await controller.gitExecute(event(token, 'assigned-terminal-token', { ...operation, from: other.id }) as any) as Response;
    expect(spoofed.status).toBe(400);
    expect((await spoofed.json()).error).toContain('active terminal identity');

    const accepted = await controller.gitExecute(event(token, 'assigned-terminal-token', operation) as any) as Response;
    expect(accepted.status, await accepted.clone().text()).toBe(200);
    expect((await gitService.status(workspace.id)).branch).toBe('review/authenticated');
  });
});
