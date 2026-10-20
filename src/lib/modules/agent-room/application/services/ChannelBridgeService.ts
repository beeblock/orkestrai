import { senderAllowed, type ChannelBinding } from '../../domain/channels.js';
import { channelBindingRepository } from '../../infrastructure/repositories/ChannelBindingRepository.js';
import { integrationExecutionService, type InboundChannelMessage } from './IntegrationExecutionService.js';
import { channelService } from './ChannelService.js';

const SLACK_INTERVAL_MS = 15_000;
const RETRY_DELAY_MS = 60_000;

type Loop = { stop: () => void };

/**
 * Connects agents to external chats. One loop per Telegram integration (its
 * updates are acknowledged per bot token) and one per Slack binding. Inbound
 * messages from allowed senders land in the agent's direct conversation and
 * inbox; an agent's post that replies to one of them goes back to that chat
 * only, through the integration, under the workspace autonomy policy.
 */
export class ChannelBridgeService {
  private loops = new Map<string, Loop>();
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  start(): void {
    if (this.refreshTimer) return;
    void this.refresh();
    this.refreshTimer = setInterval(() => void this.refresh(), 60_000);
  }

  stop(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.refreshTimer = null;
    for (const loop of this.loops.values()) loop.stop();
    this.loops.clear();
  }

  /** Starts loops for new bindings and stops loops whose bindings are gone or disabled. */
  async refresh(): Promise<void> {
    const bindings = await channelBindingRepository.listEnabled().catch(() => []);
    const wanted = new Map<string, Array<ChannelBinding & { cursor: string | null }>>();
    for (const binding of bindings) {
      const key = binding.kind === 'telegram' ? `telegram:${binding.integrationId}` : `slack:${binding.id}`;
      (wanted.get(key) ?? wanted.set(key, []).get(key)!).push(binding);
    }
    for (const [key, loop] of this.loops) {
      if (!wanted.has(key)) {
        loop.stop();
        this.loops.delete(key);
      }
    }
    for (const [key, group] of wanted) {
      if (!this.loops.has(key)) this.loops.set(key, this.run(key, group[0]));
    }
  }

  private run(key: string, first: ChannelBinding & { cursor: string | null }): Loop {
    let stopped = false;
    let cursor = first.cursor;
    const tick = async (): Promise<void> => {
      while (!stopped) {
        const group = (await channelBindingRepository.listEnabled().catch(() => []))
          .filter((binding) => (first.kind === 'telegram' ? binding.integrationId === first.integrationId && binding.kind === 'telegram' : binding.id === first.id));
        if (!group.length) return;
        try {
          const result = await integrationExecutionService.pollInbound(first.workspaceId, first.integrationId, {
            cursor,
            chatId: first.kind === 'slack' ? first.externalChatId : null,
            waitSeconds: 20,
          });
          cursor = await this.consume(first, group, cursor, result);
          for (const binding of group) if (binding.lastError) await channelBindingRepository.update(binding.id, { lastError: null });
          if (first.kind === 'slack') await delay(SLACK_INTERVAL_MS, () => stopped);
        } catch (error) {
          const text = error instanceof Error ? error.message.slice(0, 300) : 'Channel polling failed.';
          for (const binding of group) await channelBindingRepository.update(binding.id, { lastError: text }).catch(() => undefined);
          await delay(RETRY_DELAY_MS, () => stopped);
        }
      }
    };
    void tick().finally(() => this.loops.delete(key));
    return { stop: () => { stopped = true; } };
  }

  /**
   * Hands a polled batch to the agents, then records how far the chat was
   * read. The cursor moves only once every message is stored: after a failure
   * the same messages are read again, and the ones already stored are not
   * stored twice. Returns the cursor to poll from next.
   */
  private async consume(
    first: ChannelBinding,
    group: ChannelBinding[],
    cursor: string | null,
    result: { messages: InboundChannelMessage[]; cursor: string | null },
  ): Promise<string | null> {
    for (const message of result.messages) await this.dispatch(group, message);
    if (result.cursor === cursor) return cursor;
    if (first.kind === 'telegram') await channelBindingRepository.updateIntegrationCursor(first.integrationId, result.cursor);
    else await channelBindingRepository.update(first.id, { cursor: result.cursor });
    return result.cursor;
  }

  private async dispatch(group: ChannelBinding[], message: InboundChannelMessage): Promise<void> {
    for (const binding of group) {
      if (binding.externalChatId !== message.chatId) continue;
      if (!senderAllowed(binding, message.senderId, message.senderHandle)) continue;
      await channelService.postExternal(binding.workspaceId, binding.nodeId, {
        body: message.text,
        via: binding.kind,
        bindingId: binding.id,
        sender: message.senderName || message.senderId,
        externalId: message.externalId,
      });
      await channelBindingRepository.update(binding.id, { lastInboundAt: new Date().toISOString() });
    }
  }

  /**
   * Sends an agent's reply to the one external chat whose message it answers.
   * Never blocks the post; a binding that is gone or disabled gets nothing.
   */
  async mirrorReply(workspaceId: string, nodeId: string, messageId: string, body: string, bindingId: string): Promise<void> {
    const bindings = (await channelBindingRepository.list(workspaceId, nodeId).catch(() => []))
      .filter((binding) => binding.id === bindingId && binding.enabled);
    for (const binding of bindings) {
      try {
        await integrationExecutionService.execute(workspaceId, {
          integrationId: binding.integrationId,
          action: binding.kind === 'telegram' ? 'telegram.send_message' : 'slack.send_message',
          input: binding.kind === 'telegram'
            ? { chatId: binding.externalChatId, text: body.slice(0, 4_000) }
            : { channel: binding.externalChatId, text: body.slice(0, 4_000) },
          idempotencyKey: `agent-reply:${messageId}:${binding.id}`,
        }, { actorType: 'agent', actorId: nodeId });
      } catch (error) {
        await channelBindingRepository.update(binding.id, { lastError: error instanceof Error ? error.message.slice(0, 300) : 'Reply failed.' }).catch(() => undefined);
      }
    }
  }
}

function delay(ms: number, stopped: () => boolean): Promise<void> {
  return new Promise((resolve) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (stopped() || Date.now() - started >= ms) {
        clearInterval(timer);
        resolve();
      }
    }, 1_000);
  });
}

const globalRef = globalThis as unknown as { __orkestraiChannelBridge?: ChannelBridgeService };
export const channelBridgeService = (globalRef.__orkestraiChannelBridge ??= new ChannelBridgeService());
