import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { useSvelarTest } from '@beeblock/svelar/testing';
import { workspaceRepository } from '$lib/modules/agent-room/infrastructure/repositories/WorkspaceRepository.js';
import { workspaceService } from '$lib/modules/agent-room/application/services/WorkspaceService.js';
import { agentSessionService } from '$lib/modules/agent-room/application/services/AgentSessionService.js';
import { ptySessionManager } from '$lib/modules/agent-room/infrastructure/pty/PtySessionManager.js';
import { agentSessionTracker } from '$lib/modules/agent-room/infrastructure/pty/AgentSessionTracker.js';

describe('Terminal conversation ownership during recovery', () => {
  useSvelarTest({ refreshDatabase: true });
  let root: string;
  const sessions: string[] = [];
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ork-pty-ownership-'));
    vi.spyOn(agentSessionTracker, 'isAgentSessionResumable').mockReturnValue(true);
    vi.spyOn(workspaceService, 'get').mockImplementation(async id => {
      const workspace = await workspaceRepository.getWorkspace(id);
      if (!workspace) throw new Error('Workspace not found');
      return workspace;
    });
  });
  afterEach(async () => {
    for (const id of sessions.splice(0)) ptySessionManager.kill(id);
    vi.restoreAllMocks();
    await rm(root, { recursive: true, force: true });
  });

  it.each([false, true])('preserves the original terminal when stale metadata points to it (other workspace: %s)', async otherWorkspace => {
    const workspace = await workspaceRepository.createWorkspace({ name: 'Original', workingDir: root });
    const other = otherWorkspace
      ? await workspaceRepository.createWorkspace({ name: 'Other', workingDir: root })
      : workspace;
    const conversationId = '44444444-4444-4444-8444-444444444444';
    const payload = { command: '/bin/sh', args: ['-c', 'cat'], provider: 'codex', agentSessionId: conversationId } as const;
    const owner = await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'terminal', title: 'Owner', payload: { ...payload, args: [...payload.args] } });
    const original = ptySessionManager.create({
      command: '/bin/sh', args: ['-c', 'cat', 'resume', conversationId], cwd: root,
      provider: 'codex', workspaceId: workspace.id, nodeId: owner.id, agentSessionId: conversationId,
    });
    sessions.push(original.id);
    vi.spyOn(ptySessionManager, 'create').mockImplementation(() => { throw new Error('Unexpected agent spawn'); });
    const stale = await workspaceRepository.createNode({
      workspaceId: other.id, type: 'terminal', title: 'Stale',
      payload: { ...payload, args: [...payload.args], sessionId: original.id },
    });

    const nodes = await workspaceService.listNodes(other.id);
    expect(nodes.find(node => node.id === stale.id)?.payload).not.toHaveProperty('sessionId');
    expect(ptySessionManager.get(original.id)).toMatchObject({ nodeId: owner.id, workspaceId: workspace.id, exited: false });
    await expect(agentSessionService.ensure(other.id, stale.id)).rejects.toThrow('AGENT_SESSION_IN_USE');
    await workspaceService.reloadNode(other.id, stale.id);
    expect(ptySessionManager.get(original.id)).toMatchObject({ nodeId: owner.id, workspaceId: workspace.id, exited: false });
    expect(ptySessionManager.listLiveForNode(other.id, stale.id)).toHaveLength(0);
  });
});
