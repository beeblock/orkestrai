import { uuidv7 } from '@beeblock/svelar/support';
import { createHash } from 'node:crypto';
import type {
  AgentActivity,
  AgentActivityCategory,
  AgentActivitySeverity,
  AgentMessageEnvelope as AgentMessageEnvelopeData,
  AgentActivityState,
  AgentMessageDeliveryEvent,
  AgentMessageDeliveryState,
} from '../../domain/types.js';
import { AgentActivityEvent } from '../../domain/models/AgentActivityEvent.js';
import { AgentMessageDelivery } from '../../domain/models/AgentMessageDelivery.js';
import { AgentMessageEnvelope } from '../../domain/models/AgentMessageEnvelope.js';
import { AgentAttentionItem } from '../../domain/models/AgentAttentionItem.js';

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return new Date(String(value)).toISOString();
}

function parseMetadata(value: unknown): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function nullableIso(value: unknown): string | null {
  return value ? toIso(value) : null;
}

function inferCategory(action: string | null): AgentActivityCategory {
  const prefix = action?.split(':', 1)[0];
  if (prefix === 'message') return 'message';
  if (prefix === 'task') return 'task';
  if (prefix === 'workflow') return 'workflow';
  if (prefix === 'review') return 'review';
  if (prefix === 'git') return 'git';
  if (prefix === 'terminal') return 'terminal';
  if (prefix === 'design') return 'design';
  if (prefix === 'portal') return 'portal';
  if (prefix === 'remote') return 'remote';
  if (prefix === 'usage') return 'usage';
  if (prefix === 'system') return 'system';
  return 'agent';
}

function mapActivity(model: AgentActivityEvent): AgentActivity {
  const action = model.getAttribute('action') ?? null;
  return {
    id: model.getAttribute('id'),
    workspaceId: model.getAttribute('workspace_id'),
    nodeId: model.getAttribute('node_id'),
    state: model.getAttribute('state') as AgentActivityState,
    action,
    taskId: model.getAttribute('task_id') ?? null,
    metadata: parseMetadata(model.getAttribute('metadata_json')),
    category: (model.getAttribute('category') ?? inferCategory(action)) as AgentActivityCategory,
    verb: model.getAttribute('verb') ?? action ?? 'updated',
    objectType: model.getAttribute('object_type') ?? null,
    objectId: model.getAttribute('object_id') ?? null,
    objectTitle: model.getAttribute('object_title') ?? null,
    outcome: model.getAttribute('outcome') ?? null,
    severity: (model.getAttribute('severity') ?? 'info') as AgentActivitySeverity,
    correlationId: model.getAttribute('correlation_id') ?? null,
    sourceType: model.getAttribute('source_type') ?? null,
    sourceId: model.getAttribute('source_id') ?? null,
    attentionRequired: Boolean(model.getAttribute('attention_required')),
    resolvedAt: nullableIso(model.getAttribute('resolved_at')),
    createdAt: toIso(model.getAttribute('created_at')),
  };
}

function mapEnvelope(model: AgentMessageEnvelope): AgentMessageEnvelopeData {
  return {
    id: model.getAttribute('id'),
    workspaceId: model.getAttribute('workspace_id'),
    fromNodeId: model.getAttribute('from_node_id') ?? null,
    toNodeId: model.getAttribute('to_node_id'),
    kind: model.getAttribute('kind'),
    state: model.getAttribute('state') as AgentMessageDeliveryState,
    content: model.getAttribute('content'),
    reply: model.getAttribute('reply') ?? null,
    error: model.getAttribute('error') ?? null,
    contentHash: model.getAttribute('content_hash'),
    correlationId: model.getAttribute('correlation_id') ?? null,
    dedupKey: model.getAttribute('dedup_key') ?? null,
    attempts: Number(model.getAttribute('attempts') ?? 0),
    metadata: parseMetadata(model.getAttribute('metadata_json')),
    deliveredAt: nullableIso(model.getAttribute('delivered_at')),
    acknowledgedAt: nullableIso(model.getAttribute('acknowledged_at')),
    repliedAt: nullableIso(model.getAttribute('replied_at')),
    failedAt: nullableIso(model.getAttribute('failed_at')),
    createdAt: toIso(model.getAttribute('created_at')),
    updatedAt: toIso(model.getAttribute('updated_at')),
  };
}

function mapDelivery(model: AgentMessageDelivery): AgentMessageDeliveryEvent {
  return {
    id: model.getAttribute('id'),
    messageId: model.getAttribute('message_id'),
    workspaceId: model.getAttribute('workspace_id'),
    fromNodeId: model.getAttribute('from_node_id') ?? null,
    toNodeId: model.getAttribute('to_node_id'),
    state: model.getAttribute('state') as AgentMessageDeliveryState,
    content: model.getAttribute('content'),
    reply: model.getAttribute('reply') ?? null,
    error: model.getAttribute('error') ?? null,
    metadata: parseMetadata(model.getAttribute('metadata_json')),
    createdAt: toIso(model.getAttribute('created_at')),
  };
}

export class ControlCenterRepository {
  async appendActivity(input: {
    workspaceId: string;
    nodeId: string;
    state: AgentActivityState;
    action?: string | null;
    taskId?: string | null;
    metadata?: Record<string, unknown>;
    category?: AgentActivityCategory;
    verb?: string;
    objectType?: string | null;
    objectId?: string | null;
    objectTitle?: string | null;
    outcome?: string | null;
    severity?: AgentActivitySeverity;
    correlationId?: string | null;
    sourceType?: string | null;
    sourceId?: string | null;
    attentionRequired?: boolean;
  }): Promise<AgentActivity> {
    const model = await AgentActivityEvent.create({
      id: uuidv7(),
      workspace_id: input.workspaceId,
      node_id: input.nodeId,
      state: input.state,
      action: input.action ?? null,
      task_id: input.taskId ?? null,
      metadata_json: input.metadata ? JSON.stringify(input.metadata) : null,
      category: input.category ?? inferCategory(input.action ?? null),
      verb: input.verb ?? input.action ?? 'updated',
      object_type: input.objectType ?? null,
      object_id: input.objectId ?? null,
      object_title: input.objectTitle ?? null,
      outcome: input.outcome ?? null,
      severity: input.severity ?? 'info',
      correlation_id: input.correlationId ?? null,
      source_type: input.sourceType ?? null,
      source_id: input.sourceId ?? null,
      attention_required: input.attentionRequired ?? false,
      resolved_at: null,
      created_at: new Date().toISOString(),
    });
    return mapActivity(model);
  }

  async listActivity(workspaceId: string, limit = 5_000): Promise<AgentActivity[]> {
    const rows = await AgentActivityEvent.query()
      .where('workspace_id', workspaceId)
      .orderBy('created_at', 'desc')
      .limit(limit)
      .get();
    return rows.reverse().map(mapActivity);
  }

  async latestActivity(nodeId: string): Promise<AgentActivity | null> {
    const model = await AgentActivityEvent.query()
      .where('node_id', nodeId)
      .orderBy('created_at', 'desc')
      .first();
    return model ? mapActivity(model) : null;
  }

  /** Latest statuses an agent reported itself (PTY lifecycle noise excluded), newest first. */
  async latestSemanticActivities(nodeId: string, limit = 10): Promise<AgentActivity[]> {
    const rows = await AgentActivityEvent.query()
      .where('node_id', nodeId)
      .orderBy('created_at', 'desc')
      .limit(Math.max(limit * 5, 20))
      .get();
    return rows.map(mapActivity).filter((activity) => activity.metadata.lifecycle !== true).slice(0, limit);
  }

  async latestSemanticTaskActivity(nodeId: string, taskId: string): Promise<AgentActivity | null> {
    const rows = await AgentActivityEvent.query()
      .where('node_id', nodeId)
      .where('task_id', taskId)
      .orderBy('created_at', 'desc')
      .limit(50)
      .get();
    const semantic = rows.map(mapActivity).find((activity) => activity.metadata.lifecycle !== true);
    return semantic ?? null;
  }

  async appendDelivery(input: {
    messageId: string;
    workspaceId: string;
    fromNodeId?: string | null;
    toNodeId: string;
    state: AgentMessageDeliveryState;
    content: string;
    reply?: string | null;
    error?: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<AgentMessageDeliveryEvent> {
    const existingEvent = await AgentMessageDelivery.query()
      .where('message_id', input.messageId)
      .where('state', input.state)
      .orderBy('created_at', 'desc')
      .first();
    await this.projectEnvelope(input, !existingEvent);
    if (existingEvent) return mapDelivery(existingEvent);

    const model = await AgentMessageDelivery.create({
      id: uuidv7(),
      message_id: input.messageId,
      workspace_id: input.workspaceId,
      from_node_id: input.fromNodeId ?? null,
      to_node_id: input.toNodeId,
      state: input.state,
      content: input.content,
      reply: input.reply ?? null,
      error: input.error ?? null,
      metadata_json: input.metadata ? JSON.stringify(input.metadata) : null,
      created_at: new Date().toISOString(),
    });
    return mapDelivery(model);
  }

  private async projectEnvelope(input: {
    messageId: string;
    workspaceId: string;
    fromNodeId?: string | null;
    toNodeId: string;
    state: AgentMessageDeliveryState;
    content: string;
    reply?: string | null;
    error?: string | null;
    metadata?: Record<string, unknown>;
  }, updateExisting = true): Promise<void> {
    const existing = await AgentMessageEnvelope.find(input.messageId);
    const now = new Date().toISOString();
    const hash = createHash('sha256').update(input.content).digest('hex');
    const correlationId = typeof input.metadata?.correlationId === 'string' ? input.metadata.correlationId : null;
    const dedupKey = typeof input.metadata?.dedupKey === 'string' ? input.metadata.dedupKey : null;
    if (!existing) {
      await AgentMessageEnvelope.create({
        id: input.messageId,
        workspace_id: input.workspaceId,
        from_node_id: input.fromNodeId ?? null,
        to_node_id: input.toNodeId,
        kind: input.metadata?.inbox === true && typeof input.metadata.kind === 'string'
          ? input.metadata.kind
          : input.metadata?.raw ? 'raw' : input.metadata?.oneWay ? String(input.metadata.kind ?? 'handoff') : 'ask',
        state: input.state,
        content: input.content,
        reply: input.reply ?? null,
        error: input.error ?? null,
        content_hash: hash,
        correlation_id: correlationId,
        dedup_key: dedupKey,
        attempts: input.state === 'sent' ? 1 : 0,
        metadata_json: input.metadata ? JSON.stringify(input.metadata) : null,
        delivered_at: input.state === 'delivered' ? now : null,
        acknowledged_at: input.state === 'acknowledged' ? now : null,
        replied_at: input.state === 'replied' ? now : null,
        failed_at: input.state === 'failed' ? now : null,
        created_at: now,
        updated_at: now,
      });
      return;
    }
    if (
      existing.getAttribute('workspace_id') !== input.workspaceId
      || existing.getAttribute('to_node_id') !== input.toNodeId
      || existing.getAttribute('content_hash') !== hash
    ) throw new Error(`Message envelope ${input.messageId} does not match the persisted recipient or content.`);
    if (!updateExisting) return;
    const changes: Record<string, unknown> = {
      state: input.state,
      updated_at: now,
      error: input.error ?? existing.getAttribute('error'),
      reply: input.reply ?? existing.getAttribute('reply'),
      metadata_json: input.metadata ? JSON.stringify(input.metadata) : existing.getAttribute('metadata_json'),
    };
    if (input.state === 'sent') changes.attempts = Number(existing.getAttribute('attempts') ?? 0) + 1;
    if (input.state === 'delivered') changes.delivered_at = now;
    if (input.state === 'acknowledged') changes.acknowledged_at = now;
    if (input.state === 'replied') changes.replied_at = now;
    if (input.state === 'failed') changes.failed_at = now;
    await AgentMessageEnvelope.query().where('id', input.messageId).update(changes);
  }

  /**
   * Inbox transitions are not idempotent per state: a message can return to
   * the queue after an unsubmitted attempt. Every transition is audited.
   */
  async transitionEnvelope(messageId: string, input: {
    state: AgentMessageDeliveryState;
    error?: string | null;
    reply?: string | null;
    metadata?: Record<string, unknown>;
    countAttempt?: boolean;
    /** Only transition from these states; anything else leaves the envelope untouched. */
    fromStates?: AgentMessageDeliveryState[];
  }): Promise<{ envelope: AgentMessageEnvelopeData; event: AgentMessageDeliveryEvent } | null> {
    const existing = await AgentMessageEnvelope.find(messageId);
    if (!existing) return null;
    if (input.fromStates && !input.fromStates.includes(existing.getAttribute('state') as AgentMessageDeliveryState)) return null;
    const now = new Date().toISOString();
    const metadata = input.metadata ?? parseMetadata(existing.getAttribute('metadata_json'));
    const changes: Record<string, unknown> = {
      state: input.state,
      updated_at: now,
      error: input.error === undefined ? existing.getAttribute('error') : input.error,
      reply: input.reply === undefined ? existing.getAttribute('reply') : input.reply,
      metadata_json: JSON.stringify(metadata),
    };
    if (input.countAttempt) changes.attempts = Number(existing.getAttribute('attempts') ?? 0) + 1;
    if (input.state === 'delivered') changes.delivered_at = now;
    if (input.state === 'acknowledged') changes.acknowledged_at = now;
    if (input.state === 'replied') changes.replied_at = now;
    if (input.state === 'failed') changes.failed_at = now;
    await (input.fromStates
      ? AgentMessageEnvelope.query().where('id', messageId).whereIn('state', input.fromStates)
      : AgentMessageEnvelope.query().where('id', messageId)).update(changes);
    const model = await AgentMessageDelivery.create({
      id: uuidv7(),
      message_id: messageId,
      workspace_id: existing.getAttribute('workspace_id'),
      from_node_id: existing.getAttribute('from_node_id') ?? null,
      to_node_id: existing.getAttribute('to_node_id'),
      state: input.state,
      content: existing.getAttribute('content'),
      reply: input.reply ?? null,
      error: input.error ?? null,
      metadata_json: JSON.stringify(metadata),
      created_at: now,
    });
    const fresh = await AgentMessageEnvelope.find(messageId);
    return fresh ? { envelope: mapEnvelope(fresh), event: mapDelivery(model) } : null;
  }

  async findEnvelope(messageId: string): Promise<AgentMessageEnvelopeData | null> {
    const model = await AgentMessageEnvelope.find(messageId);
    return model ? mapEnvelope(model) : null;
  }

  /** Inbox items addressed to one agent, oldest first. */
  async inboxEnvelopes(toNodeId: string, states: AgentMessageDeliveryState[], limit = 50): Promise<AgentMessageEnvelopeData[]> {
    const rows = await AgentMessageEnvelope.query()
      .where('to_node_id', toNodeId)
      .whereIn('state', states)
      .where('metadata_json', 'like', '%"inbox":true%')
      .orderBy('created_at', 'asc')
      .orderBy('id', 'asc')
      .limit(limit)
      .get();
    return rows.map(mapEnvelope);
  }

  /** Questions this agent asked that are still unanswered, since a given time. */
  async openAsksFrom(fromNodeId: string, sinceIso: string): Promise<number> {
    const rows = await AgentMessageEnvelope.query()
      .where('from_node_id', fromNodeId)
      .whereIn('state', ['queued', 'sent', 'delivered'])
      .where('created_at', '>=', sinceIso)
      .where('metadata_json', 'like', '%"kind":"ask"%')
      .get();
    return rows.length;
  }

  /** The first item of a delivery batch, which carries the typed prompt, in any state. */
  async batchLead(batchId: string): Promise<AgentMessageEnvelopeData | null> {
    const rows = await AgentMessageEnvelope.query()
      .where('metadata_json', 'like', `%${JSON.stringify({ batchId }).slice(1, -1)}%`)
      .where('metadata_json', 'like', '%"batchPrompt"%')
      .limit(1)
      .get();
    return rows[0] ? mapEnvelope(rows[0]) : null;
  }

  /** Answers recorded since a time whose forward to the asker is still pending, one page after a cursor (id order). */
  async pendingForwards(sinceIso: string, afterId: string | null = null, limit = 200): Promise<AgentMessageEnvelopeData[]> {
    const base = AgentMessageEnvelope.query()
      .where('state', 'replied')
      .where('replied_at', '>=', sinceIso)
      .where('metadata_json', 'like', '%"forwardPending":true%');
    const rows = await (afterId ? base.where('id', '>', afterId) : base).orderBy('id', 'asc').limit(limit).get();
    return rows.map(mapEnvelope);
  }

  /** Metadata-only update: no delivery event, no state change. */
  async updateEnvelopeMetadata(messageId: string, metadata: Record<string, unknown>): Promise<void> {
    await AgentMessageEnvelope.query().where('id', messageId).update({ metadata_json: JSON.stringify(metadata), updated_at: new Date().toISOString() });
  }

  /** Questions from agents delivered since a time and still unanswered (reply capture survives restarts). */
  async awaitingReplies(sinceIso: string): Promise<AgentMessageEnvelopeData[]> {
    const rows = await AgentMessageEnvelope.query()
      .where('state', 'delivered')
      .whereNotNull('from_node_id')
      .where('delivered_at', '>=', sinceIso)
      .where('metadata_json', 'like', '%"inbox":true%')
      .where('metadata_json', 'like', '%"kind":"ask"%')
      .orderBy('delivered_at', 'asc')
      .limit(500)
      .get();
    return rows.map(mapEnvelope);
  }

  /** Inbox items for one agent carrying an exact dedup key, newest first. */
  async inboxByDedupKey(toNodeId: string, dedupKey: string): Promise<AgentMessageEnvelopeData[]> {
    const rows = await AgentMessageEnvelope.query()
      .where('to_node_id', toNodeId)
      .where('metadata_json', 'like', `%${JSON.stringify({ dedupKey }).slice(1, -1)}%`)
      .orderBy('created_at', 'desc')
      .limit(5)
      .get();
    return rows.map(mapEnvelope).filter((envelope) => envelope.metadata.dedupKey === dedupKey);
  }

  async countInbox(toNodeId: string, states: AgentMessageDeliveryState[]): Promise<number> {
    return AgentMessageEnvelope.query()
      .where('to_node_id', toNodeId)
      .whereIn('state', states)
      .where('metadata_json', 'like', '%"inbox":true%')
      .count();
  }

  /** Recipients that still have undelivered or unconfirmed inbox items. */
  async pendingInboxRecipients(createdAfter: string): Promise<Array<{ workspaceId: string; nodeId: string }>> {
    const rows = await AgentMessageEnvelope.query()
      .whereIn('state', ['queued', 'sent'])
      .where('metadata_json', 'like', '%"inbox":true%')
      .where('created_at', '>=', createdAfter)
      .get();
    const unique = new Map<string, { workspaceId: string; nodeId: string }>();
    for (const row of rows) {
      const nodeId = String(row.getAttribute('to_node_id'));
      unique.set(nodeId, { workspaceId: String(row.getAttribute('workspace_id')), nodeId });
    }
    return [...unique.values()];
  }

  /** Latest asks from one agent to another that still wait for an answer. */
  async openAsks(fromNodeId: string, toNodeId: string, createdAfter: string): Promise<AgentMessageEnvelopeData[]> {
    const rows = await AgentMessageEnvelope.query()
      .where('from_node_id', fromNodeId)
      .where('to_node_id', toNodeId)
      .where('kind', 'ask')
      .whereIn('state', ['queued', 'sent', 'delivered', 'acknowledged'])
      .where('created_at', '>=', createdAfter)
      .orderBy('created_at', 'desc')
      .limit(20)
      .get();
    return rows.map(mapEnvelope);
  }

  async inboxStats(workspaceId: string, createdAfter: string): Promise<AgentMessageEnvelopeData[]> {
    const rows = await AgentMessageEnvelope.query()
      .where('workspace_id', workspaceId)
      .where('created_at', '>=', createdAfter)
      .orderBy('created_at', 'asc')
      .limit(5_000)
      .get();
    return rows.map(mapEnvelope);
  }

  async listEnvelopes(workspaceId: string, limit = 200): Promise<AgentMessageEnvelopeData[]> {
    const rows = await AgentMessageEnvelope.query()
      .where('workspace_id', workspaceId)
      .orderBy('updated_at', 'desc')
      .limit(limit)
      .get();
    return rows.map(mapEnvelope);
  }

  async latestLeaderSupervision(workspaceId: string, nodeId: string): Promise<AgentMessageEnvelopeData | null> {
    const row = await AgentMessageEnvelope.query()
      .where('workspace_id', workspaceId)
      .where('to_node_id', nodeId)
      .where('kind', 'leader_supervision')
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .first();
    return row ? mapEnvelope(row) : null;
  }

  async findEnvelopes(messageIds: string[]): Promise<AgentMessageEnvelopeData[]> {
    if (!messageIds.length) return [];
    const models = await AgentMessageEnvelope.query().whereIn('id', messageIds).get();
    return models.map(mapEnvelope);
  }

  async listDeliveries(workspaceId: string, limit = 1_200): Promise<AgentMessageDeliveryEvent[]> {
    const rows = await AgentMessageDelivery.query()
      .where('workspace_id', workspaceId)
      .orderBy('created_at', 'desc')
      .limit(limit)
      .get();
    return rows.reverse().map(mapDelivery);
  }

  async deleteWorkspaceHistory(workspaceId: string): Promise<void> {
    await AgentAttentionItem.query().where('workspace_id', workspaceId).delete();
    await AgentMessageDelivery.query().where('workspace_id', workspaceId).delete();
    await AgentMessageEnvelope.query().where('workspace_id', workspaceId).delete();
    await AgentActivityEvent.query().where('workspace_id', workspaceId).delete();
  }
}

export const controlCenterRepository = new ControlCenterRepository();
