import { afterEach, describe, expect, it, vi } from 'vitest';
import { realpathSync } from 'node:fs';
import { useSvelarTest } from '@beeblock/svelar/testing';
import { agentSessionService } from '$lib/modules/agent-room/application/services/AgentSessionService.js';
import { providerProfileService } from '$lib/modules/agent-room/application/services/ProviderProfileService.js';
import { workspaceRepository } from '$lib/modules/agent-room/infrastructure/repositories/WorkspaceRepository.js';
import { ptySessionManager } from '$lib/modules/agent-room/infrastructure/pty/PtySessionManager.ts';

describe('AgentSessionService provider profiles', () => {
  useSvelarTest({ refreshDatabase: true });

  afterEach(() => vi.restoreAllMocks());

  it('injects resolved profile values only into the spawned process', async () => {
    const workspace = await workspaceRepository.createWorkspace({ name: 'runtime profile', workingDir: '/tmp' });
    const node = await workspaceRepository.createNode({
      workspaceId: workspace.id,
      type: 'terminal',
      title: 'Profile runtime',
      payload: {
        command: '/bin/cat',
        provider: 'codex',
        args: ['--dangerously-bypass-approvals-and-sandbox'],
        profileId: 'profile-1',
        env: { SAFE_VALUE: 'kept' },
      },
    });
    vi.spyOn(providerProfileService, 'resolveEnv').mockResolvedValue({ TEST_PROFILE_SECRET: 'runtime-only' });
    const create = vi.spyOn(ptySessionManager, 'create');

    const ensured = await agentSessionService.ensure(workspace.id, node.id);

    expect(create.mock.calls[0][0].env).toMatchObject({
      SAFE_VALUE: 'kept',
      TEST_PROFILE_SECRET: 'runtime-only',
      ORKESTRAI_NODE_ID: node.id,
      ORKESTRAI_WORKSPACE_CONFIG: '/tmp/.orkestrai/workspace.json',
    });
    expect(create.mock.calls[0][0].env.ORKESTRAI_AGENT_TOKEN).toMatch(/^[0-9a-f-]{36}$/);
    expect(create.mock.calls[0][0].bridgeAgentToken).toBe(create.mock.calls[0][0].env.ORKESTRAI_AGENT_TOKEN);
    expect(create.mock.calls[0][0].forwardEnvToWsl).toEqual(['TEST_PROFILE_SECRET']);
    expect(create.mock.calls[0][0].args).toContain(`projects={${JSON.stringify(realpathSync('/tmp'))}={trust_level="trusted"}}`);
    const persisted = await workspaceRepository.getNode(node.id);
    expect(JSON.stringify(persisted?.payload)).not.toContain('runtime-only');
    expect(JSON.stringify(persisted?.payload)).not.toContain(create.mock.calls[0][0].env.ORKESTRAI_AGENT_TOKEN);
    ptySessionManager.kill(ensured.sessionId);
  });
});
