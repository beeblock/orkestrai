import { workspaceRepository } from '../../infrastructure/repositories/WorkspaceRepository.js';
import { agentSessionTracker } from '../../infrastructure/pty/AgentSessionTracker.js';
import { ObsoletePtyDeliveryError, ptySessionManager, type PtyOutputMark } from '../../infrastructure/pty/PtySessionManager.js';
import { findPromptInTranscript, latestTurnBoundary } from '../../infrastructure/transcript/AgentTranscript.js';
import { getAgentAdapter, hasAgentAdapter } from '../adapters/registry.js';

type DeliverAgentMessageInput = {
  workspaceId: string;
  nodeId: string;
  sessionId: string;
  message: string;
  submitDelayMs?: number;
  queueTimeoutMs?: number;
  signal?: AbortSignal;
  isStillRelevant?: () => Promise<boolean>;
  /** Called when Enter submits the message, with where the terminal's output stood. */
  onSubmitted?: (mark: PtyOutputMark) => void;
};

/**
 * Single delivery path for every automatic message sent to an agent TUI.
 * Transcript-capable deliveries are acknowledged only after the provider persists the
 * exact prompt, which distinguishes a real submit from a harmless redraw.
 */
export class AgentTerminalDeliveryService {
  async deliver(input: DeliverAgentMessageInput): Promise<void> {
    if (input.isStillRelevant && !(await input.isStillRelevant())) {
      throw new ObsoletePtyDeliveryError();
    }
    const startedAt = Date.now();
    const submission: { at: number | null; boundaryCheckedAt: number; unverified?: Error } = { at: null, boundaryCheckedAt: 0 };
    const provider = ptySessionManager.get(input.sessionId)?.provider;
    const confirmAccepted = provider && hasAgentAdapter(provider) && getAgentAdapter(provider).sessionStorage
      ? await this.preparePromptConfirmation(input, startedAt, submission)
      : undefined;
    await ptySessionManager.writeWithConfirmedSubmit(input.sessionId, input.message, {
      submitDelayMs: input.submitDelayMs ?? 200,
      queueTimeoutMs: input.queueTimeoutMs,
      signal: input.signal,
      isAccepted: confirmAccepted,
      isStillRelevant: input.isStillRelevant,
      onSubmitted: mark => {
        submission.at = ptySessionManager.automaticDeliverySubmittedAt(input.sessionId);
        input.onSubmitted?.(mark);
      },
    });
  }

  private async preparePromptConfirmation(
    input: DeliverAgentMessageInput,
    since: number,
    submission: { at: number | null; boundaryCheckedAt: number; unverified?: Error },
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
      // Both the PTY reconciler and the caller poll this callback. If the
      // reconciler observes completion first, the caller must see the same
      // uncertainty instead of waiting minutes behind an already freed gate.
      if (submission.unverified) throw submission.unverified;
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
      if (!match) {
        // A missing exact receipt must not keep every future message blocked
        // after the CLI has completed a newer turn. Read one coherent snapshot,
        // at most once per 1.5 s, and keep the original delivery unverified.
        const pendingAt = ptySessionManager.pendingAutomaticDeliveryAt(input.sessionId);
        if (submission.at !== null && pendingAt === submission.at
          && Date.now() - submission.boundaryCheckedAt >= 1500 && preferredSessionId) {
          submission.boundaryCheckedAt = Date.now();
          const boundary = await latestTurnBoundary(provider, session.transcriptCwd ?? session.cwd, preferredSessionId, {
            homeDir: session.transcriptHome ?? undefined, posixCwd: session.runtimeKey.startsWith('wsl:'),
          });
          if (boundary.ready === true && boundary.startedAt !== null && boundary.finishedAt !== null
            && ptySessionManager.releaseAutomaticDeliveryAfterTurn(input.sessionId, pendingAt, boundary.startedAt, boundary.finishedAt)) {
            const error = new Error('Provider turn completed without an exact prompt receipt; delivery remains unverified.');
            Object.assign(error, { code: 'PTY_DELIVERY_UNCONFIRMED' });
            submission.unverified = error;
            throw error;
          }
        }
        return false;
      }

      // The exact prompt in this transcript proves which conversation belongs
      // to this terminal; it overrides and ends any discovery guess.
      agentSessionTracker.bind(input.sessionId, match.sessionId);
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
