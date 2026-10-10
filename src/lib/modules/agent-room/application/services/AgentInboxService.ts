import { uuidv7 } from '@beeblock/svelar/support';
import { Event } from '@beeblock/svelar/events';
import type { AgentMessageEnvelope } from '../../domain/types.js';
import { AutomationTriggerReceived } from '../../domain/events/AutomationTriggerReceived.js';
import { workspaceRepository } from '../../infrastructure/repositories/WorkspaceRepository.js';
import { controlCenterRepository } from '../../infrastructure/repositories/ControlCenterRepository.js';
import { ptySessionManager, type PtySessionInfo } from '../../infrastructure/pty/PtySessionManager.js';
import { agentSessionTracker } from '../../infrastructure/pty/AgentSessionTracker.js';
import {
  findPromptInTranscript,
  findReplyToPrompt,
  latestTurnComplete,
  type TranscriptLookupOptions,
} from '../../infrastructure/transcript/AgentTranscript.js';
import { getAgentAdapter, hasAgentAdapter } from '../adapters/registry.js';
import { agentTerminalDeliveryService } from './AgentTerminalDeliveryService.js';
import { controlCenterService } from './ControlCenterService.js';
import { floorService } from './FloorService.js';

/**
 * Asynchronous per-agent inbox.
 *
 * Agent TUIs only read a typed prompt between model turns, and turns last
 * minutes. Typing one message per sender into a busy terminal kept the
 * session's delivery barrier closed until the provider persisted the prompt,
 * so every other message to that agent expired behind it. The inbox instead:
 * - persists every message (envelope state `queued`);
 * - delivers everything pending as ONE prompt at the recipient's next turn
 *   boundary (idle PTY and a completed transcript turn);
 * - lets a busy agent read pending items from any bridge call (`claim`);
 * - routes replies back to the waiting caller or to the sender's own inbox, so
 *   a timeout never loses an answer and a reply is never injected twice.
 */

export type InboxKind =
  | 'ask'
  | 'reply'
  | 'task'
  | 'task_created'
  | 'task_completion'
  | 'task_recovery'
  | 'leader_supervision'
  | 'handoff';

export type InboxEnqueueInput = {
  workspaceId: string;
  toNodeId: string;
  fromNodeId?: string | null;
  kind: InboxKind;
  content: string;
  taskId?: string | null;
  messageId?: string;
  /** Skips the enqueue when an identical undelivered item is already pending. */
  dedupKey?: string | null;
  replyTo?: string | null;
  metadata?: Record<string, unknown>;
};

export type InboxItem = {
  messageId: string;
  kind: string;
  fromNodeId: string | null;
  fromTitle: string | null;
  taskId: string | null;
  replyTo: string | null;
  content: string;
  createdAt: string;
};

export type InboxReplyResult =
  | { state: 'replied'; text: string; source: string }
  | { state: 'failed'; error: string; cancelled: boolean }
  | { state: 'queued' | 'sent' | 'delivered' };

type RelevanceCheck = (envelope: AgentMessageEnvelope) => Promise<boolean>;
type DeliveredHook = (envelope: AgentMessageEnvelope) => Promise<void>;
type Restorer = (workspaceId: string, nodeId: string) => Promise<string | null>;

type BatchTracking = {
  workspaceId: string;
  nodeId: string;
  sessionId: string;
  prompt: string;
  since: number;
  messageIds: string[];
  deadline: number;
};

type TranscriptContext = {
  provider: string | null;
  cwd: string;
  agentSessionId: string | null;
  options: TranscriptLookupOptions;
};

const SWEEP_MS = 1_500;
const MAX_BATCH_ITEMS = 8;
const MAX_BATCH_CHARS = 20_000;
const MAX_ATTEMPTS = 5;
const REPLY_WATCH_MS = 3 * 60 * 60_000;
const CONFIRMATION_WINDOW_MS = 10 * 60_000;
const RESTORE_RETRY_MS = 60_000;
const PENDING_HORIZON_MS = 48 * 60 * 60_000;
const CLAIM_LIMIT = 10;
/** Terminal deliveries running at once; each still waits for its own agent's turn boundary. */
const MAX_PARALLEL_DELIVERIES = 6;
const FORWARD_PAGE_SIZE = 200;
const CLAIM_CHARS = 24_000;

const UNCERTAIN_DELIVERY = /Transcript confirmation timed out|não confirmou o envio|did not confirm/i;

function broadcast(payload: Record<string, unknown>): void {
  const send = (globalThis as { __orkestraiBroadcast?: (frame: Record<string, unknown>) => void }).__orkestraiBroadcast;
  send?.(payload);
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

/**
 * One automatic recovery per card and terminal session. The canvas resume
 * prompt and the recovery both tell a restored agent to continue its cards;
 * this key lets whichever arrives first cover the other.
 */
export const taskRecoveryKey = (taskId: string, sessionId: string): string => `task-recovery:${taskId}:${sessionId}`;

export class AgentInboxService {
  private timer: ReturnType<typeof setInterval> | null = null;
  private sweeping = false;
  private restored = false;
  private readonly recipients = new Map<string, string>();
  private readonly locks = new Map<string, Promise<void>>();
  private readonly redrain = new Set<string>();
  private readonly drainRuns = new Map<string, Promise<void>>();
  private readonly confirmations = new Map<string, BatchTracking>();
  private readonly replyWatches = new Map<string, BatchTracking>();
  private readonly waiters = new Map<string, Set<(result: InboxReplyResult) => void>>();
  private readonly relevance = new Map<string, RelevanceCheck>();
  private readonly deliveredHooks = new Map<string, DeliveredHook>();
  private readonly restoreAttempts = new Map<string, number>();
  private activeDeliveries = 0;
  private forwardsPending = false;
  private readonly deliverySlots: Array<() => void> = [];
  private restorer: Restorer | null = null;

  registerRelevance(kind: InboxKind, check: RelevanceCheck): void {
    this.relevance.set(kind, check);
  }

  onDelivered(kind: InboxKind, hook: DeliveredHook): void {
    this.deliveredHooks.set(kind, hook);
  }

  /** Restores a resumable agent conversation; returns the live PTY id. */
  setRestorer(restorer: Restorer): void {
    this.restorer = restorer;
  }

  start(): void {
    this.ensureTimer();
    if (this.restored) return;
    this.restored = true;
    void this.restorePending().catch(() => console.warn('[agent-inbox] Pending messages could not be restored; new messages still flow.'));
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Clears in-memory dispatch state (timers, watches, waiters). Persisted envelopes are untouched. */
  reset(): void {
    this.stop();
    this.recipients.clear();
    this.locks.clear();
    this.redrain.clear();
    this.drainRuns.clear();
    this.confirmations.clear();
    this.replyWatches.clear();
    this.waiters.clear();
    this.restoreAttempts.clear();
    this.activeDeliveries = 0;
    for (const next of this.deliverySlots.splice(0)) next();
    this.restored = false;
  }

  /** One dispatcher pass: deliveries, confirmations and reply capture. */
  async sweepNow(): Promise<void> {
    await this.sweep();
    await Promise.allSettled([...this.drainRuns.values()]);
  }

  async enqueue(input: InboxEnqueueInput): Promise<AgentMessageEnvelope> {
    const content = input.content.trim();
    if (!content) throw new Error('A mensagem está vazia.');
    if (input.dedupKey) {
      const pending = await controlCenterRepository.inboxEnvelopes(input.toNodeId, ['queued', 'sent']);
      const duplicate = pending.find((envelope) => envelope.metadata.dedupKey === input.dedupKey);
      if (duplicate) return duplicate;
    }
    const messageId = input.messageId ?? uuidv7();
    const metadata: Record<string, unknown> = {
      ...input.metadata,
      inbox: true,
      kind: input.kind,
      ...(input.taskId ? { taskId: input.taskId, correlationId: `task:${input.taskId}` } : {}),
      ...(input.replyTo ? { replyTo: input.replyTo } : {}),
      ...(input.dedupKey ? { dedupKey: input.dedupKey } : {}),
    };
    await controlCenterService.recordDelivery({
      messageId,
      workspaceId: input.workspaceId,
      fromNodeId: input.fromNodeId ?? null,
      toNodeId: input.toNodeId,
      state: 'queued',
      content,
      metadata,
    });
    this.kick(input.workspaceId, input.toNodeId);
    const envelope = await controlCenterRepository.findEnvelope(messageId);
    if (!envelope) throw new Error('A mensagem não foi registrada.');
    return envelope;
  }

  /**
   * Records a message that already reached its recipient through another
   * channel (for example as the return value of a blocked ask), so it can be
   * answered with `reply` without being typed into the terminal again.
   */
  async recordDirect(input: InboxEnqueueInput & { via: string }): Promise<AgentMessageEnvelope> {
    const messageId = input.messageId ?? uuidv7();
    const metadata: Record<string, unknown> = {
      ...input.metadata,
      inbox: true,
      kind: input.kind,
      via: input.via,
      ...(input.taskId ? { taskId: input.taskId, correlationId: `task:${input.taskId}` } : {}),
      ...(input.replyTo ? { replyTo: input.replyTo } : {}),
    };
    const base = { messageId, workspaceId: input.workspaceId, fromNodeId: input.fromNodeId ?? null, toNodeId: input.toNodeId, content: input.content.trim(), metadata };
    await controlCenterService.recordDelivery({ ...base, state: 'queued' });
    await controlCenterService.recordInboxTransition(messageId, { state: 'delivered', metadata });
    return (await controlCenterRepository.findEnvelope(messageId))!;
  }

  kick(workspaceId: string, nodeId: string): void {
    this.recipients.set(nodeId, workspaceId);
    this.ensureTimer();
    queueMicrotask(() => { void this.drain(workspaceId, nodeId); });
  }

  async pendingCount(nodeId: string): Promise<number> {
    return controlCenterRepository.countInbox(nodeId, ['queued']);
  }

  /**
   * Hands pending items to a busy agent through any bridge call. Claimed items
   * are delivered: the dispatcher will not type them into the terminal again.
   */
  async claim(workspaceId: string, nodeId: string, limit = CLAIM_LIMIT): Promise<{ items: InboxItem[]; remaining: number }> {
    return this.withLock(nodeId, async () => {
      const queued = await controlCenterRepository.inboxEnvelopes(nodeId, ['queued'], Math.max(1, Math.min(limit, 50)));
      const titles = await this.titles(workspaceId);
      const items: InboxItem[] = [];
      let chars = 0;
      for (const envelope of queued) {
        if (envelope.workspaceId !== workspaceId) continue;
        if (!(await this.isRelevant(envelope))) {
          await this.cancel(envelope, 'obsolete');
          continue;
        }
        if (items.length && chars + envelope.content.length > CLAIM_CHARS) break;
        chars += envelope.content.length;
        const delivered = await controlCenterService.recordInboxTransition(envelope.id, {
          state: 'delivered',
          metadata: { ...envelope.metadata, via: 'inbox' },
        });
        items.push(this.toItem(envelope, titles));
        if (delivered) await this.fireDelivered(delivered);
      }
      const remaining = await controlCenterRepository.countInbox(nodeId, ['queued']);
      return { items, remaining };
    });
  }

  /**
   * Waits for the answer to one ask. A recipient that is still busy after
   * `busyGraceMs` returns `queued`: the caller keeps working and the answer is
   * routed to its inbox later. A timeout never discards the eventual answer.
   */
  async awaitReply(messageId: string, options: { timeoutMs: number; busyGraceMs?: number; signal?: AbortSignal }): Promise<InboxReplyResult> {
    const current = await controlCenterRepository.findEnvelope(messageId);
    if (current?.state === 'replied') return { state: 'replied', text: current.reply ?? '', source: String(current.metadata.replySource ?? 'inbox') };
    if (current?.state === 'failed') return { state: 'failed', error: current.error ?? 'Falha na entrega.', cancelled: current.metadata.cancelled === true };
    return new Promise<InboxReplyResult>((resolvePromise, reject) => {
      let settled = false;
      const waiters = this.waiters.get(messageId) ?? new Set();
      const finish = (result: InboxReplyResult | Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        clearTimeout(busyCheck);
        waiters.delete(onReply);
        if (!waiters.size) this.waiters.delete(messageId);
        options.signal?.removeEventListener('abort', onAbort);
        if (result instanceof Error) reject(result);
        else resolvePromise(result);
      };
      const onReply = (result: InboxReplyResult) => finish(result);
      const settleWithState = async () => {
        const envelope = await controlCenterRepository.findEnvelope(messageId).catch(() => null);
        if (envelope?.state === 'replied') return finish({ state: 'replied', text: envelope.reply ?? '', source: String(envelope.metadata.replySource ?? 'inbox') });
        if (envelope?.state === 'failed') return finish({ state: 'failed', error: envelope.error ?? 'Falha na entrega.', cancelled: envelope.metadata.cancelled === true });
        const state = envelope?.state === 'queued' || envelope?.state === 'sent' ? envelope.state : 'delivered';
        finish({ state });
      };
      const onAbort = () => {
        void (async () => {
          const envelope = await controlCenterRepository.findEnvelope(messageId).catch(() => null);
          // An undelivered message is withdrawn with its caller; a delivered one cannot be unsent.
          if (envelope?.state === 'queued') await this.cancel(envelope, 'caller_cancelled').catch(() => undefined);
          finish(new Error('Agent request cancelled.'));
        })();
      };
      waiters.add(onReply);
      this.waiters.set(messageId, waiters);
      const timeout = setTimeout(() => { void settleWithState(); }, Math.max(1, options.timeoutMs));
      timeout.unref?.();
      const busyCheck = setTimeout(() => {
        void controlCenterRepository.findEnvelope(messageId).then((envelope) => {
          if (envelope?.state === 'queued') finish({ state: 'queued' });
        }).catch(() => undefined);
      }, Math.max(1, options.busyGraceMs ?? 4_000));
      busyCheck.unref?.();
      if (options.signal?.aborted) onAbort();
      else options.signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  hasWaiter(messageId: string): boolean {
    return Boolean(this.waiters.get(messageId)?.size);
  }

  /** Open asks from `askerNodeId` to `responderNodeId` whose caller is still blocked. */
  async waitingAsk(askerNodeId: string, responderNodeId: string): Promise<AgentMessageEnvelope | null> {
    const since = new Date(Date.now() - 6 * 60 * 60_000).toISOString();
    const open = await controlCenterRepository.openAsks(askerNodeId, responderNodeId, since);
    return open.find((envelope) => this.hasWaiter(envelope.id)) ?? null;
  }

  /**
   * Records the answer to an ask exactly once and delivers it to the blocked
   * caller, or to the asker's inbox when nobody is waiting anymore.
   */
  async routeReply(messageId: string, text: string, input: { source: string; responderNodeId?: string | null; metadata?: Record<string, unknown> }): Promise<{ routed: boolean; via: 'waiter' | 'inbox' | 'none'; envelope: AgentMessageEnvelope | null }> {
    // Concurrent answers (an explicit reply racing the transcript capture, two
    // reply calls) are serialized per message: exactly one is recorded and forwarded.
    return this.withLock(`reply:${messageId}`, () => this.routeReplyOnce(messageId, text, input));
  }

  private async routeReplyOnce(messageId: string, text: string, input: { source: string; responderNodeId?: string | null; metadata?: Record<string, unknown> }): Promise<{ routed: boolean; via: 'waiter' | 'inbox' | 'none'; envelope: AgentMessageEnvelope | null }> {
    const envelope = await controlCenterRepository.findEnvelope(messageId);
    if (!envelope) throw new Error('Mensagem não encontrada.');
    if (input.responderNodeId && envelope.toNodeId !== input.responderNodeId) {
      throw new Error('Somente o destinatário pode responder a esta mensagem.');
    }
    const answer = text.trim();
    if (!answer) throw new Error('A resposta está vazia.');
    // An answer recorded earlier whose forward never reached the asker's inbox
    // (a failed write, a crash) is forwarded now instead of being lost.
    if (envelope.state === 'replied' && envelope.metadata.forwardPending === true) return this.forwardAnswer(envelope);
    if (envelope.state === 'replied' || envelope.state === 'failed') return { routed: false, via: 'none', envelope };
    const waiting = this.waiters.get(messageId)?.size ?? 0;
    const forward = !waiting && Boolean(envelope.fromNodeId && envelope.fromNodeId !== envelope.toNodeId);
    const updated = await controlCenterService.recordInboxTransition(messageId, {
      state: 'replied',
      reply: answer,
      // The forward is recorded with the answer: its id makes retries idempotent.
      metadata: { ...envelope.metadata, replySource: input.source, ...input.metadata, ...(forward ? { forwardId: uuidv7(), forwardPending: true } : {}) },
      fromStates: ['queued', 'sent', 'delivered', 'acknowledged'],
    });
    if (!updated) {
      const current = await controlCenterRepository.findEnvelope(messageId);
      return { routed: false, via: 'none', envelope: current };
    }
    const titles = await this.titles(envelope.workspaceId);
    await controlCenterService.recordActivity({
      workspaceId: envelope.workspaceId,
      nodeId: envelope.toNodeId,
      state: (await controlCenterRepository.latestActivity(envelope.toNodeId))?.state ?? 'idle',
      action: 'system:message_replied',
      metadata: { ...envelope.metadata, toTitle: envelope.fromNodeId ? titles.get(envelope.fromNodeId) ?? null : null },
      category: 'message',
      verb: 'replied',
      objectType: 'message',
      objectId: messageId,
      objectTitle: envelope.content.slice(0, 120),
      outcome: answer.slice(0, 240),
      severity: 'success',
      correlationId: asString(envelope.metadata.correlationId) ?? `message:${messageId}`,
      sourceType: 'bridge',
      sourceId: messageId,
    }).catch(() => undefined);
    broadcast({ type: 'agentReply', workspaceId: envelope.workspaceId, to: envelope.toNodeId, from: envelope.fromNodeId ? titles.get(envelope.fromNodeId) ?? null : null, text: answer });
    await Event.dispatch(new AutomationTriggerReceived(envelope.workspaceId, 'message', 'received', `message:${messageId}`, {
      message: envelope.content,
      reply: answer,
      fromNodeId: envelope.fromNodeId,
      fromTitle: envelope.fromNodeId ? titles.get(envelope.fromNodeId) ?? null : null,
      toNodeId: envelope.toNodeId,
      toTitle: titles.get(envelope.toNodeId) ?? null,
    })).catch(() => undefined);

    const waiters = this.waiters.get(messageId);
    if (waiters?.size) {
      for (const waiter of [...waiters]) waiter({ state: 'replied', text: answer, source: input.source });
      return { routed: true, via: 'waiter', envelope: updated };
    }
    // Any message from an agent can be answered, including a reply to a reply:
    // an explicit answer is part of the conversation and must reach its sender.
    if (updated.metadata.forwardPending === true) {
      try {
        return await this.forwardAnswer(updated);
      } catch (error) {
        // The answer is recorded with a pending forward: a retry or the sweep delivers it.
        this.forwardsPending = true;
        this.ensureTimer();
        throw error;
      }
    }
    return { routed: false, via: 'none', envelope: updated };
  }

  /** Puts a recorded answer in the asker's inbox exactly once (fixed id), then clears the pending mark. */
  private async forwardAnswer(envelope: AgentMessageEnvelope): Promise<{ routed: boolean; via: 'inbox'; envelope: AgentMessageEnvelope | null }> {
    const forwardId = asString(envelope.metadata.forwardId) ?? uuidv7();
    if (envelope.fromNodeId && !(await controlCenterRepository.findEnvelope(forwardId))) {
      const titles = await this.titles(envelope.workspaceId);
      await this.enqueue({
        messageId: forwardId,
        workspaceId: envelope.workspaceId,
        fromNodeId: envelope.toNodeId,
        toNodeId: envelope.fromNodeId,
        kind: 'reply',
        replyTo: envelope.id,
        dedupKey: `reply-forward:${envelope.id}`,
        taskId: asString(envelope.metadata.taskId),
        content: `Resposta de ${titles.get(envelope.toNodeId) ?? 'agente'} à sua mensagem ${envelope.id}: ${envelope.reply ?? ''}`,
      });
    }
    await controlCenterRepository.updateEnvelopeMetadata(envelope.id, { ...envelope.metadata, forwardId, forwardPending: false });
    return { routed: true, via: 'inbox', envelope: await controlCenterRepository.findEnvelope(envelope.id) };
  }

  /**
   * Forwards left pending by a failure or a restart, page by page. The flag is
   * cleared only after a complete pass without errors, so a failed query or
   * a failed item is retried by the next sweep.
   */
  private async recoverForwards(pageSize = FORWARD_PAGE_SIZE): Promise<void> {
    const since = new Date(Date.now() - PENDING_HORIZON_MS).toISOString();
    let after: string | null = null;
    let failed = false;
    try {
      for (;;) {
        const page = await controlCenterRepository.pendingForwards(since, after, pageSize);
        for (const envelope of page) {
          await this.withLock(`reply:${envelope.id}`, async () => {
            const current = await controlCenterRepository.findEnvelope(envelope.id);
            if (current?.state === 'replied' && current.metadata.forwardPending === true) await this.forwardAnswer(current);
          }).catch(() => { failed = true; });
        }
        if (page.length < pageSize) break;
        after = page[page.length - 1].id;
      }
    } catch {
      failed = true;
    }
    this.forwardsPending = failed;
    if (failed) this.ensureTimer();
  }

  // -- Dispatcher ---------------------------------------------------------------

  private ensureTimer(): void {
    if (this.timer) return;
    this.timer = setInterval(() => { void this.sweep(); }, SWEEP_MS);
    this.timer.unref?.();
  }

  private async restorePending(): Promise<void> {
    const horizon = new Date(Date.now() - PENDING_HORIZON_MS).toISOString();
    for (const recipient of await controlCenterRepository.pendingInboxRecipients(horizon)) {
      this.recipients.set(recipient.nodeId, recipient.workspaceId);
      const sent = await controlCenterRepository.inboxEnvelopes(recipient.nodeId, ['sent']);
      const batches = new Map<string, AgentMessageEnvelope[]>();
      for (const envelope of sent) {
        const batchId = asString(envelope.metadata.batchId) ?? envelope.id;
        batches.set(batchId, [...(batches.get(batchId) ?? []), envelope]);
      }
      for (const [batchId, envelopes] of batches) {
        const lead = envelopes.find((envelope) => typeof envelope.metadata.batchPrompt === 'string')
          ?? await controlCenterRepository.batchLead(batchId);
        const sessionId = asString(lead?.metadata.sessionId);
        if (lead && sessionId) {
          this.confirmations.set(batchId, {
            workspaceId: recipient.workspaceId,
            nodeId: recipient.nodeId,
            sessionId,
            prompt: String(lead.metadata.batchPrompt),
            since: Date.parse(lead.updatedAt) - 5_000,
            messageIds: envelopes.map((envelope) => envelope.id),
            deadline: Date.now() + CONFIRMATION_WINDOW_MS,
          });
        } else {
          for (const envelope of envelopes) await this.requeue(envelope, 'Delivery state was lost before confirmation.');
        }
      }
    }
    await this.recoverForwards();
    // Questions delivered before a restart still get their answer captured
    // from the transcript; the prompt is never typed again.
    const watchHorizon = new Date(Date.now() - REPLY_WATCH_MS).toISOString();
    const delivered = new Map<string, AgentMessageEnvelope[]>();
    for (const envelope of await controlCenterRepository.awaitingReplies(watchHorizon)) {
      const batchId = asString(envelope.metadata.batchId) ?? envelope.id;
      delivered.set(batchId, [...(delivered.get(batchId) ?? []), envelope]);
    }
    for (const [batchId, envelopes] of delivered) {
      // The prompt lives on the batch's first item, which can be a notice or an
      // already answered question: look it up by batch, whatever its state.
      const lead = envelopes.find((envelope) => typeof envelope.metadata.batchPrompt === 'string')
        ?? await controlCenterRepository.batchLead(batchId);
      const deliveredAt = Date.parse(lead?.deliveredAt ?? envelopes[0]?.deliveredAt ?? '');
      if (!lead || !Number.isFinite(deliveredAt) || this.replyWatches.has(batchId)) continue;
      this.replyWatches.set(batchId, {
        workspaceId: lead.workspaceId,
        nodeId: lead.toNodeId,
        sessionId: asString(lead.metadata.sessionId) ?? '',
        prompt: String(lead.metadata.batchPrompt),
        since: deliveredAt - CONFIRMATION_WINDOW_MS,
        // Only the questions still waiting; answered ones and notices are done.
        messageIds: envelopes.map((envelope) => envelope.id),
        deadline: deliveredAt + REPLY_WATCH_MS,
      });
    }
    this.ensureTimer();
  }

  private async sweep(): Promise<void> {
    if (this.sweeping) return;
    this.sweeping = true;
    try {
      // Every agent drains on its own (bounded by delivery slots): a terminal
      // slow to accept or confirm a prompt never delays the other inboxes.
      for (const [nodeId, workspaceId] of [...this.recipients]) {
        if (!this.drainRuns.has(nodeId)) void this.drain(workspaceId, nodeId);
      }
      await Promise.all([...this.confirmations].map(([batchId, tracking]) => this.checkConfirmation(batchId, tracking).catch(() => undefined)));
      await Promise.all([...this.replyWatches].map(([batchId, tracking]) => this.checkReply(batchId, tracking).catch(() => undefined)));
      if (this.forwardsPending) await this.recoverForwards();
      if (!this.recipients.size && !this.confirmations.size && !this.replyWatches.size && !this.waiters.size && !this.forwardsPending) this.stop();
    } catch {
      console.warn('[agent-inbox] Sweep failed; the next tick retries.');
    } finally {
      this.sweeping = false;
    }
  }

  private async withLock<T>(nodeId: string, run: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(nodeId) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolvePromise) => { release = resolvePromise; });
    const tail = previous.catch(() => undefined).then(() => gate);
    this.locks.set(nodeId, tail);
    await previous.catch(() => undefined);
    try {
      return await run();
    } finally {
      release();
      if (this.locks.get(nodeId) === tail) this.locks.delete(nodeId);
    }
  }

  /**
   * Delivers everything pending for one agent when it reaches a turn boundary.
   * A call during a running pass waits for it and for one follow-up pass.
   */
  drain(workspaceId: string, nodeId: string): Promise<void> {
    const running = this.drainRuns.get(nodeId);
    if (running) {
      this.redrain.add(nodeId);
      return running.then(() => this.drainRuns.get(nodeId));
    }
    const run = this.drainOnce(workspaceId, nodeId).finally(() => {
      this.drainRuns.delete(nodeId);
      if (this.redrain.delete(nodeId)) void this.drain(workspaceId, nodeId);
    });
    this.drainRuns.set(nodeId, run);
    return run;
  }

  private async drainOnce(workspaceId: string, nodeId: string): Promise<void> {
    await this.acquireDeliverySlot();
    try {
      const prepared = await this.withLock(nodeId, () => this.prepareBatch(workspaceId, nodeId));
      if (prepared) await this.deliverBatch(prepared);
    } catch {
      console.warn('[agent-inbox] Delivery attempt failed; it will be retried.');
    } finally {
      this.releaseDeliverySlot();
    }
  }

  private async acquireDeliverySlot(): Promise<void> {
    if (this.activeDeliveries < MAX_PARALLEL_DELIVERIES) {
      this.activeDeliveries++;
      return;
    }
    await new Promise<void>((resolvePromise) => this.deliverySlots.push(resolvePromise));
  }

  private releaseDeliverySlot(): void {
    const next = this.deliverySlots.shift();
    if (next) next();
    else this.activeDeliveries = Math.max(0, this.activeDeliveries - 1);
  }

  private async prepareBatch(workspaceId: string, nodeId: string): Promise<(BatchTracking & { envelopes: AgentMessageEnvelope[]; batchId: string; context: TranscriptContext }) | null> {
    const queued = await controlCenterRepository.inboxEnvelopes(nodeId, ['queued']);
    if (!queued.length) {
      const sent = await controlCenterRepository.countInbox(nodeId, ['sent']);
      if (!sent) this.recipients.delete(nodeId);
      return null;
    }
    const live: AgentMessageEnvelope[] = [];
    for (const envelope of queued) {
      if (envelope.workspaceId !== workspaceId) continue;
      if (await this.isRelevant(envelope)) live.push(envelope);
      else await this.cancel(envelope, 'obsolete');
    }
    if (!live.length) return null;

    const node = await workspaceRepository.getNode(nodeId);
    if (!node || node.workspaceId !== workspaceId || node.type !== 'terminal') {
      for (const envelope of live) await this.fail(envelope, 'O agente de destino não existe mais.');
      return null;
    }
    // Notices never wake an offline agent; questions and work may restore it.
    const session = await this.liveSession(workspaceId, nodeId, live.some((envelope) => envelope.metadata.wake !== false));
    if (!session) return null;
    if (!ptySessionManager.canAcceptAutomaticMessage(session.id)) return null;
    const context = await this.transcriptContext(workspaceId, nodeId, session);
    if (context.provider) {
      const complete = await latestTurnComplete(context.provider, context.cwd, context.agentSessionId, context.options).catch(() => null);
      if (complete === false) return null;
    }

    const batch: AgentMessageEnvelope[] = [];
    let chars = 0;
    for (const envelope of live) {
      if (batch.length >= MAX_BATCH_ITEMS) break;
      if (batch.length && chars + envelope.content.length > MAX_BATCH_CHARS) break;
      batch.push(envelope);
      chars += envelope.content.length;
    }
    const titles = await this.titles(workspaceId);
    const prompt = this.compose(batch, titles);
    const batchId = uuidv7();
    const since = Date.now();
    for (const [index, envelope] of batch.entries()) {
      await controlCenterService.recordInboxTransition(envelope.id, {
        state: 'sent',
        countAttempt: true,
        metadata: {
          ...envelope.metadata,
          batchId,
          batchSize: batch.length,
          sessionId: session.id,
          ...(index === 0 ? { batchPrompt: prompt } : {}),
        },
      });
    }
    return {
      workspaceId,
      nodeId,
      sessionId: session.id,
      prompt,
      since,
      messageIds: batch.map((envelope) => envelope.id),
      deadline: since + CONFIRMATION_WINDOW_MS,
      envelopes: batch,
      batchId,
      context,
    };
  }

  private async deliverBatch(batch: BatchTracking & { envelopes: AgentMessageEnvelope[]; batchId: string; context: TranscriptContext }): Promise<void> {
    try {
      await agentTerminalDeliveryService.deliver({
        workspaceId: batch.workspaceId,
        nodeId: batch.nodeId,
        sessionId: batch.sessionId,
        message: batch.prompt,
        submitDelayMs: 120,
        queueTimeoutMs: 30_000,
        isStillRelevant: async () => {
          for (const envelope of batch.envelopes) if (await this.isRelevant(envelope)) return true;
          return false;
        },
      });
      await this.markDelivered(batch.batchId, batch);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if ((error as { code?: string }).code === 'PTY_DELIVERY_OBSOLETE') {
        for (const envelope of batch.envelopes) await this.cancel(envelope, 'obsolete');
        return;
      }
      if (UNCERTAIN_DELIVERY.test(message)) {
        const provider = batch.context.provider;
        if (!provider || !hasAgentAdapter(provider) || !getAgentAdapter(provider).sessionStorage) {
          // Nothing can prove consumption later; typing it again risks a duplicate turn.
          await this.markDelivered(batch.batchId, batch);
          return;
        }
        // Submitted but not yet visible in the transcript: never type it again
        // while it may still be consumed. The sweep reconciles it.
        for (const envelope of batch.envelopes) {
          const current = await controlCenterRepository.findEnvelope(envelope.id);
          if (current) await controlCenterService.recordInboxTransition(envelope.id, { state: 'sent', metadata: { ...current.metadata, unconfirmed: true } });
        }
        this.confirmations.set(batch.batchId, batch);
        this.ensureTimer();
        return;
      }
      for (const envelope of batch.envelopes) {
        const current = await controlCenterRepository.findEnvelope(envelope.id);
        if (current) await this.requeue(current, message);
      }
    }
  }

  private async markDelivered(batchId: string, batch: BatchTracking, confirmation: 'transcript' | 'unverified' = 'transcript'): Promise<void> {
    this.confirmations.delete(batchId);
    const envelopes: AgentMessageEnvelope[] = [];
    for (const messageId of batch.messageIds) {
      const current = await controlCenterRepository.findEnvelope(messageId);
      if (!current || current.state !== 'sent') continue;
      const delivered = await controlCenterService.recordInboxTransition(messageId, {
        state: 'delivered',
        metadata: { ...current.metadata, unconfirmed: confirmation === 'unverified', confirmation, via: 'terminal' },
      });
      if (delivered) {
        envelopes.push(delivered);
        await controlCenterService.recordActivity({
          workspaceId: delivered.workspaceId,
          nodeId: delivered.toNodeId,
          state: 'working',
          action: 'system:message_received',
          metadata: { ...delivered.metadata },
          category: 'message',
          verb: 'received',
          objectType: 'message',
          objectId: delivered.id,
          objectTitle: delivered.content.slice(0, 120),
          correlationId: asString(delivered.metadata.correlationId) ?? `message:${delivered.id}`,
          sourceType: 'bridge',
          sourceId: delivered.id,
        }).catch(() => undefined);
        await this.fireDelivered(delivered);
      }
    }
    // Only questions from agents expect an automatic answer. Replies,
    // handoffs and notices never do, which rules out reply ping-pong.
    if (envelopes.some((envelope) => envelope.kind === 'ask' && envelope.fromNodeId)) {
      this.replyWatches.set(batchId, { ...batch, deadline: Date.now() + REPLY_WATCH_MS });
      this.ensureTimer();
    }
  }

  private async checkConfirmation(batchId: string, tracking: BatchTracking): Promise<void> {
    const session = ptySessionManager.get(tracking.sessionId);
    const context = session ? await this.transcriptContext(tracking.workspaceId, tracking.nodeId, session) : null;
    const found = context?.provider
      ? await findPromptInTranscript(context.provider, context.cwd, context.agentSessionId, tracking.prompt, tracking.since, context.options).catch(() => null)
      : null;
    if (found) {
      await this.markDelivered(batchId, tracking);
      return;
    }
    const alive = Boolean(session && !session.exited);
    if (alive && Date.now() < tracking.deadline) return;
    if (alive) {
      // Submitted to a live terminal whose provider may persist the turn late
      // (or never, for very large resumed conversations). Typing it again
      // would duplicate the prompt: record it as delivered without proof.
      await this.markDelivered(batchId, tracking, 'unverified');
      return;
    }
    // The terminal died before the provider recorded the prompt: the next
    // session never saw it, so it is safe to deliver again at its boundary.
    this.confirmations.delete(batchId);
    for (const messageId of tracking.messageIds) {
      const current = await controlCenterRepository.findEnvelope(messageId);
      if (current?.state === 'sent') await this.requeue(current, 'The terminal exited before the provider recorded the submitted prompt.');
    }
  }

  private async checkReply(batchId: string, tracking: BatchTracking): Promise<void> {
    if (Date.now() > tracking.deadline) {
      this.replyWatches.delete(batchId);
      return;
    }
    // After a restart the conversation continues in a new terminal (or none
    // yet): the answer is read from the same transcript either way.
    const tracked = ptySessionManager.get(tracking.sessionId);
    const node = tracked && !tracked.exited ? null : await workspaceRepository.getNode(tracking.nodeId);
    const currentId = (node?.payload as { sessionId?: string } | undefined)?.sessionId;
    const current = currentId ? ptySessionManager.get(currentId) : null;
    const session = tracked && !tracked.exited ? tracked : current && !current.exited ? current : null;
    if (session && !session.waiting) return;
    const context = await this.transcriptContext(tracking.workspaceId, tracking.nodeId, session);
    if (!context.provider || !context.agentSessionId) {
      if (!session) return;
      this.replyWatches.delete(batchId);
      return;
    }
    const complete = await latestTurnComplete(context.provider, context.cwd, context.agentSessionId, context.options).catch(() => null);
    if (complete === false) return;
    const match = await findReplyToPrompt(context.provider, context.cwd, context.agentSessionId, tracking.prompt, tracking.since, context.options).catch(() => null);
    if (!match?.complete || !match.text.trim()) return;
    this.replyWatches.delete(batchId);
    for (const messageId of tracking.messageIds) {
      const envelope = await controlCenterRepository.findEnvelope(messageId);
      if (!envelope || envelope.kind !== 'ask' || !envelope.fromNodeId || envelope.state === 'replied') continue;
      await this.routeReply(messageId, match.text, {
        source: 'transcript',
        metadata: tracking.messageIds.length > 1 ? { batchReply: true } : {},
      }).catch(() => undefined);
    }
  }

  private async requeue(envelope: AgentMessageEnvelope, error: string): Promise<void> {
    if (envelope.attempts >= MAX_ATTEMPTS) {
      await this.fail(envelope, error);
      return;
    }
    const metadata: Record<string, unknown> = { ...envelope.metadata, unconfirmed: false };
    delete metadata.batchPrompt;
    await controlCenterService.recordInboxTransition(envelope.id, { state: 'queued', error, metadata });
    this.recipients.set(envelope.toNodeId, envelope.workspaceId);
    this.ensureTimer();
  }

  private async fail(envelope: AgentMessageEnvelope, error: string): Promise<void> {
    await controlCenterService.recordInboxTransition(envelope.id, { state: 'failed', error, metadata: envelope.metadata });
    this.resolveWaiters(envelope.id, { state: 'failed', error, cancelled: false });
  }

  private async cancel(envelope: AgentMessageEnvelope, reason: string): Promise<void> {
    const error = reason === 'obsolete'
      ? 'Agent message delivery was cancelled because its task is no longer active.'
      : 'Message withdrawn before delivery.';
    await controlCenterService.recordInboxTransition(envelope.id, {
      state: 'failed',
      error,
      metadata: { ...envelope.metadata, cancelled: true, cancelReason: reason },
    });
    this.resolveWaiters(envelope.id, { state: 'failed', error, cancelled: true });
  }

  private resolveWaiters(messageId: string, result: InboxReplyResult): void {
    const waiters = this.waiters.get(messageId);
    if (!waiters) return;
    for (const waiter of [...waiters]) waiter(result);
  }

  private async isRelevant(envelope: AgentMessageEnvelope): Promise<boolean> {
    const check = this.relevance.get(envelope.kind);
    if (!check) return true;
    try {
      return await check(envelope);
    } catch {
      return true;
    }
  }

  private async fireDelivered(envelope: AgentMessageEnvelope): Promise<void> {
    const hook = this.deliveredHooks.get(envelope.kind);
    if (hook) await hook(envelope).catch(() => undefined);
  }

  private async liveSession(workspaceId: string, nodeId: string, allowRestore = true): Promise<PtySessionInfo | null> {
    const node = await workspaceRepository.getNode(nodeId);
    const sessionId = (node?.payload as { sessionId?: string } | undefined)?.sessionId;
    const session = sessionId ? ptySessionManager.get(sessionId) : null;
    if (session && !session.exited) return session;
    if (!this.restorer || !allowRestore) return null;
    const lastAttempt = this.restoreAttempts.get(nodeId) ?? 0;
    if (Date.now() - lastAttempt < RESTORE_RETRY_MS) return null;
    this.restoreAttempts.set(nodeId, Date.now());
    const restoredId = await this.restorer(workspaceId, nodeId).catch(() => null);
    const restored = restoredId ? ptySessionManager.get(restoredId) : null;
    return restored && !restored.exited ? restored : null;
  }

  /** Whether this session already received the automatic recovery of one card. */
  async recoveryDelivered(nodeId: string, taskId: string, sessionId: string): Promise<boolean> {
    const envelopes = await controlCenterRepository.inboxByDedupKey(nodeId, taskRecoveryKey(taskId, sessionId));
    return envelopes.some((envelope) => ['sent', 'delivered', 'replied'].includes(envelope.state));
  }

  /** Withdraws a queued recovery that a direct resume prompt already covered. */
  async withdrawRecovery(nodeId: string, taskId: string, sessionId: string): Promise<boolean> {
    return this.withLock(nodeId, async () => {
      const queued = (await controlCenterRepository.inboxByDedupKey(nodeId, taskRecoveryKey(taskId, sessionId)))
        .find((envelope) => envelope.state === 'queued');
      if (!queued) return false;
      await this.cancel(queued, 'superseded');
      return true;
    });
  }

  /**
   * True when this agent's conversation ends in a turn left open by a process
   * that no longer runs: the agent was mid-task when Orkestrai quit or crashed,
   * and its resumed CLI sits idle until someone tells it to continue.
   */
  async interruptedTurn(workspaceId: string, nodeId: string, sessionId: string): Promise<boolean> {
    const session = ptySessionManager.get(sessionId);
    if (!session || session.exited) return false;
    const context = await this.transcriptContext(workspaceId, nodeId, session);
    if (!context.provider) return false;
    const { processStartedAt: _live, ...lookup } = context.options;
    const [open, released] = await Promise.all([
      latestTurnComplete(context.provider, context.cwd, context.agentSessionId, lookup).catch(() => null),
      latestTurnComplete(context.provider, context.cwd, context.agentSessionId, context.options).catch(() => null),
    ]);
    return open === false && released === true;
  }

  private async transcriptContext(workspaceId: string, nodeId: string, session: PtySessionInfo | null): Promise<TranscriptContext> {
    const node = await workspaceRepository.getNode(nodeId);
    const payload = (node?.payload ?? {}) as { provider?: string; agentSessionId?: string };
    if (!session) {
      // No live terminal: the saved conversation of the node, in its own folder.
      const workspace = await workspaceRepository.getWorkspace(workspaceId);
      let cwd = workspace?.workingDir ?? '';
      if (node?.floorId) {
        const floor = await floorService.get(node.floorId).catch(() => null);
        if (floor?.path) cwd = floor.path;
      }
      return { provider: payload.provider ?? null, cwd, agentSessionId: payload.agentSessionId ?? null, options: {} };
    }
    let cwd = session.transcriptCwd ?? null;
    if (!cwd) {
      const workspace = await workspaceRepository.getWorkspace(workspaceId);
      cwd = workspace?.workingDir ?? session.cwd;
      if (node?.floorId) {
        const floor = await floorService.get(node.floorId).catch(() => null);
        if (floor?.path) cwd = floor.path;
      }
    }
    return {
      provider: session.provider ?? payload.provider ?? null,
      cwd,
      agentSessionId: session.agentSessionId ?? agentSessionTracker.agentSessionIdForPty(session.id) ?? payload.agentSessionId ?? null,
      options: {
        homeDir: session.transcriptHome ?? undefined,
        posixCwd: session.runtimeKey.startsWith('wsl:'),
        processStartedAt: Date.parse(session.createdAt) || undefined,
      },
    };
  }

  private async titles(workspaceId: string): Promise<Map<string, string>> {
    const nodes = await workspaceRepository.listNodes(workspaceId, undefined, true);
    return new Map(nodes.filter((node) => node.type === 'terminal').map((node) => [node.id, node.title ?? 'agente']));
  }

  private toItem(envelope: AgentMessageEnvelope, titles: Map<string, string>): InboxItem {
    return {
      messageId: envelope.id,
      kind: envelope.kind,
      fromNodeId: envelope.fromNodeId,
      fromTitle: envelope.fromNodeId ? titles.get(envelope.fromNodeId) ?? null : null,
      taskId: asString(envelope.metadata.taskId),
      replyTo: asString(envelope.metadata.replyTo),
      content: envelope.content,
      createdAt: envelope.createdAt,
    };
  }

  private itemPrompt(envelope: AgentMessageEnvelope, titles: Map<string, string>): string {
    const marker = `[orkestrai:message:${envelope.id}]`;
    if (envelope.kind !== 'ask') return `${marker} ${envelope.content}`;
    if (!envelope.fromNodeId) return `${marker} ${envelope.content}`;
    const from = titles.get(envelope.fromNodeId) ?? 'agente';
    const taskId = asString(envelope.metadata.taskId);
    return `${marker} Mensagem de ${from}${taskId ? ` (tarefa ${taskId})` : ''}: ${envelope.content}`;
  }

  private compose(batch: AgentMessageEnvelope[], titles: Map<string, string>): string {
    const asks = batch.filter((envelope) => envelope.kind === 'ask' && envelope.fromNodeId);
    const footer = asks.length
      ? ` -- Para responder a uma pergunta: orkestrai reply ${asks.length === 1 ? asks[0].id : '<messageId>'} "<resposta>" (tool MCP reply). Sua resposta final neste turno também é encaminhada. Não peça reenvio.`
      : '';
    if (batch.length === 1) return `${this.itemPrompt(batch[0], titles)}${footer}`;
    const items = batch.map((envelope, index) => `[${index + 1}/${batch.length}] ${this.itemPrompt(envelope, titles)}`);
    return `[orkestrai:inbox] ${batch.length} mensagens chegaram enquanto você trabalhava; trate todas, mais antigas primeiro. ${items.join(' ')}${footer}`;
  }
}

const globalRef = globalThis as unknown as { __orkestraiAgentInboxService?: AgentInboxService };
export const agentInboxService = (globalRef.__orkestraiAgentInboxService ??= new AgentInboxService());
