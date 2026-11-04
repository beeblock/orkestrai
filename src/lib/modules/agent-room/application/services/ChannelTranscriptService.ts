import { createHash } from 'node:crypto';
import { channelRepository } from '../../infrastructure/repositories/ChannelRepository.js';
import { workspaceRepository } from '../../infrastructure/repositories/WorkspaceRepository.js';
import { publicTranscriptUpdates } from '../../infrastructure/transcript/AgentTranscript.js';
import { agentInboxService } from './AgentInboxService.js';
import { directChannel, TEAM_CHANNEL, type ChannelMessage } from '../../domain/channels.js';
import type { TerminalNodePayload } from '../../domain/types.js';

type Watch = { workspaceId: string; nodeId: string; channel: string; seen: Set<string>; lastFailureAt?: number; running?: Promise<void> };

/** Projects public terminal updates into Chat; no prompt injection or model reminder turns. */
export class ChannelTranscriptService {
  private watches = new Map<string, Watch>();
  private timer: ReturnType<typeof setInterval> | null = null;

  follow(workspaceId: string, nodeId: string, channel = directChannel(nodeId)): Promise<void> {
    if (channel !== directChannel(nodeId) && channel !== TEAM_CHANNEL) return Promise.resolve();
    const key = `${workspaceId}:${nodeId}:${channel}`;
    let watch = this.watches.get(key);
    if (!watch) {
      watch = { workspaceId, nodeId, channel, seen: new Set() };
      this.watches.set(key, watch);
      while (this.watches.size > 128) this.watches.delete(this.watches.keys().next().value!);
    }
    if (!this.timer) {
      this.timer = setInterval(() => {
        for (const entry of this.watches.values()) void this.run(entry).catch(() => undefined);
      }, 2_000);
      this.timer.unref?.();
    }
    return this.run(watch);
  }

  reset(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.watches.clear();
  }

  private run(watch: Watch): Promise<void> {
    if (watch.running) return watch.running;
    watch.running = this.sync(watch).catch(error => {
      if (!watch.lastFailureAt || Date.now() - watch.lastFailureAt >= 60_000) {
        watch.lastFailureAt = Date.now();
        console.warn('[agent-chat] Public terminal updates could not be synchronized; stored messages remain available and synchronization will retry.');
      }
      throw error;
    }).finally(() => { watch.running = undefined; });
    return watch.running;
  }

  private stop(watch: Watch): void {
    this.watches.delete(`${watch.workspaceId}:${watch.nodeId}:${watch.channel}`);
    if (!this.watches.size && this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  private async sync(watch: Watch): Promise<void> {
    const { workspaceId, nodeId, channel } = watch;
    const owner = await channelRepository.latestDeliveredOwner(workspaceId, channel, channel === TEAM_CHANNEL ? nodeId : undefined);
    if (!owner) { this.stop(watch); return; }
    const receipts = owner.meta.deliveryReceipts as Record<string, unknown> | undefined;
    const since = Date.parse(String(receipts?.[nodeId] ?? owner.meta.deliveredAt));
    if (!Number.isFinite(since)) { this.stop(watch); return; }
    const node = await workspaceRepository.getActiveNode(workspaceId, nodeId);
    if (!node || node.type !== 'terminal') { this.stop(watch); return; }
    const context = await agentInboxService.transcriptFor(workspaceId, nodeId);
    if (!context.provider || !context.agentSessionId) { this.stop(watch); return; }
    const updates = await publicTranscriptUpdates(context.provider, context.cwd, context.agentSessionId, since, context.options);
    if (!updates) { this.stop(watch); return; }
    // Revalidate after filesystem I/O: a provider/profile transfer may have replaced the conversation.
    const current = await workspaceRepository.getActiveNode(workspaceId, nodeId);
    const payload = current?.payload as TerminalNodePayload | undefined;
    if (!current || payload?.agentSessionId !== context.agentSessionId || payload.provider !== context.provider
      || payload.profileId !== (node.payload as TerminalNodePayload).profileId) { this.stop(watch); return; }
    for (const update of updates.messages) {
      const transcriptKey = createHash('sha256').update(`${context.provider}\0${context.agentSessionId}\0${update.key}`).digest('hex');
      if (watch.seen.has(transcriptKey)) continue;
      const saved = await channelRepository.saveTranscriptUpdate({ workspaceId, channel, authorKind: 'agent', authorNodeId: nodeId,
        body: update.text, createdAt: update.at, transcriptKey, meta: { via: 'terminal', transcriptSessionId: context.agentSessionId } });
      watch.seen.add(transcriptKey);
      while (watch.seen.size > 160) watch.seen.delete(watch.seen.values().next().value!);
      if (saved) this.broadcast(saved);
    }
    if (updates.complete) this.stop(watch);
  }

  private broadcast(message: ChannelMessage): void {
    (globalThis as { __orkestraiBroadcast?: (frame: Record<string, unknown>) => void }).__orkestraiBroadcast?.({
      type: 'channelMessage', workspaceId: message.workspaceId, channel: message.channel, message,
    });
  }
}

export const channelTranscriptService = new ChannelTranscriptService();
