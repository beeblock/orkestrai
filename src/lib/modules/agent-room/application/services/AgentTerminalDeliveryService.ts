import { workspaceRepository } from '../../infrastructure/repositories/WorkspaceRepository.js';
import { agentSessionTracker } from '../../infrastructure/pty/AgentSessionTracker.js';
import { ptySessionManager } from '../../infrastructure/pty/PtySessionManager.js';
import { findPromptInTranscript } from '../../infrastructure/transcript/AgentTranscript.js';

type DeliverAgentMessageInput = {
  workspaceId: string;
  nodeId: string;
  sessionId: string;
  message: string;
  submitDelayMs?: number;
  signal?: AbortSignal;
};

/**
 * Single delivery path for every automatic message sent to an agent TUI.
 * ConPTY/WSL deliveries are acknowledged only after the provider persists the
 * exact prompt, which distinguishes a real submit from a harmless redraw.
 */
export class AgentTerminalDeliveryService {
  async deliver(input: DeliverAgentMessageInput): Promise<void> {
    const startedAt = Date.now();
    const requiresConfirmation = ptySessionManager.requiresSubmitConfirmation(input.sessionId);
    const confirmAccepted = requiresConfirmation
      ? await this.preparePromptConfirmation(input, startedAt)
      : undefined;
    await ptySessionManager.writeWithConfirmedSubmit(input.sessionId, input.message, {
      submitDelayMs: input.submitDelayMs ?? 200,
      signal: input.signal,
      isAccepted: confirmAccepted,
    });
  }

  private async preparePromptConfirmation(
    input: DeliverAgentMessageInput,
    since: number,
  ): Promise<() => Promise<boolean>> {
    const node = await workspaceRepository.getNode(input.nodeId);
    const initialSession = ptySessionManager.get(input.sessionId);
    if (
      !node
      || node.workspaceId !== input.workspaceId
      || node.type !== 'terminal'
      || !initialSession
      || initialSession.exited
    ) throw new Error('Agent message target is no longer available.');

    const payload = (node.payload ?? {}) as { provider?: string; sessionId?: string; agentSessionId?: string };
    const provider = initialSession.provider ?? payload.provider ?? null;
    if (!provider) throw new Error('Agent message target has no provider.');

    return async () => {
      const session = ptySessionManager.get(input.sessionId);
      if (!session || session.exited) return false;
      const preferredSessionId = session.agentSessionId
        ?? agentSessionTracker.agentSessionIdForPty(input.sessionId)
        ?? payload.agentSessionId
        ?? null;
      const match = await findPromptInTranscript(
        provider,
        session.transcriptCwd ?? session.cwd,
        preferredSessionId,
        input.message,
        since,
        {
          homeDir: session.transcriptHome ?? undefined,
          posixCwd: session.runtimeKey.startsWith('wsl:'),
        },
      );
      if (!match) return false;

      ptySessionManager.bindAgentSession(input.sessionId, match.sessionId);
      if (payload.agentSessionId !== match.sessionId && payload.sessionId === input.sessionId) {
        const currentNode = await workspaceRepository.getNode(node.id);
        const currentPayload = (currentNode?.payload ?? {}) as typeof payload;
        if (currentNode?.type === 'terminal' && currentPayload.sessionId === input.sessionId) {
          await workspaceRepository.updateNode(node.id, {
            payload: { ...currentPayload, agentSessionId: match.sessionId } as never,
          });
          const broadcast = (globalThis as { __orkestraiBroadcast?: (frame: Record<string, unknown>) => void }).__orkestraiBroadcast;
          broadcast?.({ type: 'workspaceChanged', workspaceId: input.workspaceId, nodeId: node.id });
        }
      }
      return true;
    };
  }
}

export const agentTerminalDeliveryService = new AgentTerminalDeliveryService();
