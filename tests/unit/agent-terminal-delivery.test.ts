import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentTerminalDeliveryService } from '$lib/modules/agent-room/application/services/AgentTerminalDeliveryService.js';
import { ptySessionManager } from '$lib/modules/agent-room/infrastructure/pty/PtySessionManager.js';
import { workspaceRepository } from '$lib/modules/agent-room/infrastructure/repositories/WorkspaceRepository.js';
import { findPromptInTranscript } from '$lib/modules/agent-room/infrastructure/transcript/AgentTranscript.js';

vi.mock('$lib/modules/agent-room/infrastructure/transcript/AgentTranscript.js', () => ({ findPromptInTranscript: vi.fn() }));

describe('AgentTerminalDeliveryService', () => {
  afterEach(() => vi.restoreAllMocks());

  it.each(['codex', 'claude'])('uses the exact %s prompt and runtime home for ConPTY/WSL, never redraw-only confirmation', async provider => {
    const session = { id: 'pty', provider, agentSessionId: 'conversation', runtimeKey: 'wsl:Ubuntu-24.04', cwd: 'C:\\project', transcriptCwd: '/home/dev/project', transcriptHome: '/tmp/wsl-home', exited: false };
    vi.spyOn(ptySessionManager, 'get').mockReturnValue(session as never);
    vi.spyOn(ptySessionManager, 'requiresSubmitConfirmation').mockReturnValue(true);
    vi.spyOn(workspaceRepository, 'getNode').mockResolvedValue({ id: 'node', workspaceId: 'workspace', type: 'terminal', payload: { provider, sessionId: 'pty', agentSessionId: 'conversation' } } as never);
    const bind = vi.spyOn(ptySessionManager, 'bindAgentSession').mockImplementation(() => {});
    vi.mocked(findPromptInTranscript).mockResolvedValueOnce(null).mockResolvedValueOnce({ sessionId: 'conversation' });
    const write = vi.spyOn(ptySessionManager, 'writeWithConfirmedSubmit').mockImplementation(async (_id, _text, options) => {
      expect(options?.isAccepted).toBeTypeOf('function');
      expect(await options!.isAccepted!()).toBe(false);
      expect(await options!.isAccepted!()).toBe(true);
    });
    await new AgentTerminalDeliveryService().deliver({ workspaceId: 'workspace', nodeId: 'node', sessionId: 'pty', message: 'Exact handoff message' });
    expect(write).toHaveBeenCalledTimes(1);
    expect(findPromptInTranscript).toHaveBeenLastCalledWith(provider, '/home/dev/project', 'conversation', 'Exact handoff message', expect.any(Number), { homeDir: '/tmp/wsl-home', posixCwd: true });
    expect(bind).toHaveBeenCalledWith('pty', 'conversation');
  });
});
