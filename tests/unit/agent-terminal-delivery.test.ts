import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentTerminalDeliveryService } from '$lib/modules/agent-room/application/services/AgentTerminalDeliveryService.js';
import { ptySessionManager } from '$lib/modules/agent-room/infrastructure/pty/PtySessionManager.js';
import { workspaceRepository } from '$lib/modules/agent-room/infrastructure/repositories/WorkspaceRepository.js';
import { findPromptInTranscript, latestTurnBoundary } from '$lib/modules/agent-room/infrastructure/transcript/AgentTranscript.js';

vi.mock('$lib/modules/agent-room/infrastructure/transcript/AgentTranscript.js', () => ({ findPromptInTranscript: vi.fn(), latestTurnBoundary: vi.fn() }));

describe('AgentTerminalDeliveryService', () => {
  afterEach(() => vi.restoreAllMocks());

  it.each([
    { ready: true, finishedOffset: -100, retry: true },
    { ready: false, finishedOffset: -100, retry: false },
    { ready: true, finishedOffset: 100, retry: false },
  ])('retries an unsubmitted native paste only after older completed work ($ready, $finishedOffset)', async ({ ready, finishedOffset, retry }) => {
    const at = Date.now();
    const session = { id: 'pty', provider: 'claude', agentSessionId: 'conversation', runtimeKey: 'native', cwd: '/project', exited: false };
    vi.spyOn(ptySessionManager, 'get').mockReturnValue(session as never);
    vi.spyOn(workspaceRepository, 'getNode').mockResolvedValue({ id: 'node', workspaceId: 'workspace', type: 'terminal', payload: { provider: 'claude', sessionId: 'pty', agentSessionId: 'conversation' } } as never);
    vi.spyOn(ptySessionManager, 'automaticDeliverySubmittedAt').mockReturnValue(at);
    vi.spyOn(ptySessionManager, 'pendingAutomaticDeliveryAt').mockReturnValue(at);
    vi.spyOn(ptySessionManager, 'hasUnconfirmedDeliveryAfterTurn').mockReturnValue(false);
    const resubmit = vi.spyOn(ptySessionManager, 'retryPendingAutomaticPaste').mockReturnValue(true);
    vi.mocked(findPromptInTranscript).mockResolvedValue(null);
    vi.mocked(latestTurnBoundary).mockResolvedValue({ ready, startedAt: at - 1000, finishedAt: at + finishedOffset });
    vi.spyOn(ptySessionManager, 'writeWithConfirmedSubmit').mockImplementation(async (_id, _text, options) => {
      options?.onSubmitted?.({ sessionId: 'pty', length: 1 });
      expect(await options!.isAccepted!()).toBe(false);
    });
    await new AgentTerminalDeliveryService().deliver({ workspaceId: 'workspace', nodeId: 'node', sessionId: 'pty', message: 'existing paste' });
    expect(resubmit).toHaveBeenCalledTimes(retry ? 1 : 0);
    if (retry) expect(resubmit).toHaveBeenCalledWith('pty', at, at - 100);
  });

  it.each(['native', 'wsl:Ubuntu-24.04'])('reports uncertainty to the %s caller but still accepts a late exact receipt', async runtimeKey => {
    const at = Date.now();
    const session = { id: 'pty', provider: 'codex', agentSessionId: 'conversation', runtimeKey, cwd: '/project', transcriptCwd: '/project', transcriptHome: '/isolated-home', exited: false };
    vi.spyOn(ptySessionManager, 'get').mockReturnValue(session as never);
    vi.spyOn(workspaceRepository, 'getNode').mockResolvedValue({ id: 'node', workspaceId: 'workspace', type: 'terminal', payload: { provider: 'codex', sessionId: 'pty', agentSessionId: 'conversation' } } as never);
    vi.spyOn(ptySessionManager, 'automaticDeliverySubmittedAt').mockReturnValue(at);
    const pending = vi.spyOn(ptySessionManager, 'pendingAutomaticDeliveryAt').mockReturnValue(at);
    const uncertainTurn = vi.spyOn(ptySessionManager, 'hasUnconfirmedDeliveryAfterTurn').mockReturnValue(true);
    vi.spyOn(ptySessionManager, 'bindAgentSession').mockImplementation(() => {});
    vi.mocked(findPromptInTranscript).mockResolvedValue(null);
    vi.mocked(latestTurnBoundary).mockResolvedValue({ ready: true, startedAt: at + 10, finishedAt: at + 100 });
    let recovered: unknown;
    let confirm!: () => Promise<boolean>;
    vi.spyOn(ptySessionManager, 'writeWithConfirmedSubmit').mockImplementation(async (_id, _text, options) => {
      confirm = options!.isAccepted!;
      options?.onSubmitted?.({ sessionId: 'pty', length: 1 });
      try { await options!.isAccepted!(); } catch (error) { recovered = error; }
      expect(recovered).toMatchObject({ code: 'PTY_DELIVERY_UNCONFIRMED' });
      pending.mockReturnValue(null);
      // The reconciler swallowed the first rejection; the waiting caller must
      // still observe it without treating an unrelated turn as its receipt.
      await options!.isAccepted!();
    });
    const result = await new AgentTerminalDeliveryService().deliver({ workspaceId: 'workspace', nodeId: 'node', sessionId: 'pty', message: 'handoff' }).catch(error => error);
    expect(result).toBe(recovered);
    expect(result).toMatchObject({ code: 'PTY_DELIVERY_UNCONFIRMED' });
    expect(uncertainTurn).toHaveBeenCalledWith('pty', at, at + 10, at + 100);
    expect(latestTurnBoundary).toHaveBeenCalledWith('codex', '/project', 'conversation', { homeDir: '/isolated-home', posixCwd: runtimeKey !== 'native' });
    vi.mocked(findPromptInTranscript).mockResolvedValue({ sessionId: 'conversation' } as never);
    expect(await confirm()).toBe(true);
  });

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
