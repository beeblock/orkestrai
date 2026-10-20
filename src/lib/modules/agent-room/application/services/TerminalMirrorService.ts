import type { TerminalNodePayload } from '../../domain/types.js';
import { workspaceRepository } from '../../infrastructure/repositories/WorkspaceRepository.js';
import { findPromptInTranscript, findReplyToPrompt, lastReplyText, latestTurnComplete, latestTurnStartedAt } from '../../infrastructure/transcript/AgentTranscript.js';
import { agentInboxService } from './AgentInboxService.js';
import { channelService } from './ChannelService.js';

const POLL_MS = 4_000;
const FOLLOW_MS = 30 * 60_000;
// A prompt the transcript stores differently (edited, pasted media) is answered
// by the turn that follows it once that turn ends.
const UNMATCHED_MS = 90_000;

/** Menu answers and slash commands drive the CLI; they are not conversation. */
export function isConversationalPrompt(text: string): boolean {
  const value = text.trim();
  return value.length >= 2 && !value.startsWith('/') && !/^(?:\d{1,2}|[yns]|sim|n[aã]o|yes|no|ok)$/i.test(value);
}

/**
 * Keeps an agent's terminal and its direct conversation in Chat as one
 * conversation: a line the owner submits in the terminal is recorded there,
 * and so is the agent's answer once its transcript closes that turn.
 */
export class TerminalMirrorService {
  private latest = new Map<string, string>();

  async mirrorPrompt(input: { workspaceId: string; nodeId: string; text: string; at: number }): Promise<void> {
    if (!isConversationalPrompt(input.text)) return;
    const node = await workspaceRepository.getNode(input.nodeId);
    if (!node || node.workspaceId !== input.workspaceId || !(node.payload as TerminalNodePayload).provider) return;
    const message = await channelService.recordTerminalPrompt(input.workspaceId, input.nodeId, input.text);
    this.latest.set(input.nodeId, message.id);
    this.follow(input.workspaceId, input.nodeId, input.text.trim(), input.at, message.id);
  }

  private follow(workspaceId: string, nodeId: string, prompt: string, at: number, messageId: string): void {
    const started = Date.now();
    const tick = async (): Promise<void> => {
      try {
        if (await this.recordReply(workspaceId, nodeId, prompt, at, messageId, Date.now() - started >= UNMATCHED_MS)) return;
      } catch {
        // A transcript being written or rotated is read again on the next tick.
      }
      if (Date.now() - started < FOLLOW_MS) setTimeout(() => void tick(), POLL_MS).unref?.();
    };
    setTimeout(() => void tick(), POLL_MS).unref?.();
  }

  private async recordReply(workspaceId: string, nodeId: string, prompt: string, at: number, messageId: string, allowUnmatched: boolean): Promise<boolean> {
    const context = await agentInboxService.transcriptFor(workspaceId, nodeId);
    if (!context.provider) return false;
    const since = at - 5_000;
    const reply = await findReplyToPrompt(context.provider, context.cwd, context.agentSessionId, prompt, since, context.options);
    if (reply?.complete && reply.text.trim()) {
      await channelService.recordTerminalReply(workspaceId, nodeId, reply.text, messageId);
      return true;
    }
    if (reply || !allowUnmatched || !context.agentSessionId || this.latest.get(nodeId) !== messageId) return false;
    if (await findPromptInTranscript(context.provider, context.cwd, context.agentSessionId, prompt, since, context.options)) return false;
    // Only a turn the conversation started after this line was sent can answer it;
    // an earlier answer is not repeated as if it were new.
    const turnStarted = await latestTurnStartedAt(context.provider, context.cwd, context.agentSessionId, context.options);
    if (turnStarted === null || turnStarted < since) return false;
    if (!(await latestTurnComplete(context.provider, context.cwd, context.agentSessionId, context.options))) return false;
    const text = await lastReplyText(context.provider, context.cwd, context.agentSessionId);
    if (!text?.trim()) return false;
    await channelService.recordTerminalReply(workspaceId, nodeId, text, messageId);
    return true;
  }
}

export const terminalMirrorService = new TerminalMirrorService();

// The PTY layer reports owner lines through this hook; it may load as a
// separate module copy, so the hook lives on globalThis.
(globalThis as { __orkestraiHumanPrompt?: (input: { workspaceId: string; nodeId: string; text: string; at: number }) => void }).__orkestraiHumanPrompt = (input) => {
  void terminalMirrorService.mirrorPrompt(input).catch(() => undefined);
};
