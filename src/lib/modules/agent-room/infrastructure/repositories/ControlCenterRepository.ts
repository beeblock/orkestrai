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
        kind: input.metadata?.raw ? 'raw' : input.metadata?.oneWay ? String(input.metadata.kind ?? 'handoff') : 'ask',
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

  async listEnvelopes(workspaceId: string, limit = 200): Promise<AgentMessageEnvelopeData[]> {
    const rows = await AgentMessageEnvelope.query()
      .where('workspace_id', workspaceId)
      .orderBy('updated_at', 'desc')
      .limit(limit)
      .get();
    return rows.map(mapEnvelope);
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
