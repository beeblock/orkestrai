import { afterEach, describe, expect, it } from 'vitest';
import { useSvelarTest } from '@beeblock/svelar/testing';
import { agentSessionService } from '$lib/modules/agent-room/application/services/AgentSessionService.js';
import { workspaceService } from '$lib/modules/agent-room/application/services/WorkspaceService.js';
import { workspaceRepository } from '$lib/modules/agent-room/infrastructure/repositories/WorkspaceRepository.js';
import { ptySessionManager } from '$lib/modules/agent-room/infrastructure/pty/PtySessionManager.ts';

describe('workspace suspension', () => {
  useSvelarTest({ refreshDatabase: true });

  afterEach(() => ptySessionManager.killAll());

  it('persists unload, clears live PTYs, and resumes only explicitly', async () => {
    const workspace = await workspaceRepository.createWorkspace({ name: 'Paused work', workingDir: '/tmp' });
    const session = ptySessionManager.create({
      command: '/bin/cat',
      cwd: '/tmp',
      workspaceId: workspace.id,
    });
    const node = await workspaceRepository.createNode({
      workspaceId: workspace.id,
      type: 'terminal',
      title: 'Worker',
      payload: { command: '/bin/cat', sessionId: session.id },
    });

    const unloaded = await workspaceService.unloadWorkspace(workspace.id);

    expect(unloaded.killedSessions).toBe(1);
    expect(unloaded.workspace.suspendedAt).not.toBeNull();
    expect(ptySessionManager.get(session.id)).toBeNull();
    expect((await workspaceRepository.getNode(node.id))?.payload).not.toHaveProperty('sessionId');
    await expect(agentSessionService.ensure(workspace.id, node.id)).rejects.toThrow('WORKSPACE_SUSPENDED');

    const resumed = await workspaceService.resumeWorkspace(workspace.id);
    expect(resumed.suspendedAt).toBeNull();
    const ensured = await agentSessionService.ensure(workspace.id, node.id);
    expect(ptySessionManager.get(ensured.sessionId)).not.toBeNull();
  });
});
