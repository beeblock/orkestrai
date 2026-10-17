import { uuidv7 } from '@beeblock/svelar/support';
import type {
  AgentActivityCategory,
  AgentActivitySeverity,
  AgentAttentionItem as AgentAttentionItemData,
  AgentAttentionStatus,
} from '../../domain/types.js';
import { AgentAttentionItem } from '../../domain/models/AgentAttentionItem.js';

function toIso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
}

function nullableIso(value: unknown): string | null {
  return value ? toIso(value) : null;
}

function parseAction(value: unknown): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function mapAttention(model: AgentAttentionItem): AgentAttentionItemData {
  return {
    id: model.getAttribute('id'),
    workspaceId: model.getAttribute('workspace_id'),
    workspaceName: null,
    activityEventId: model.getAttribute('activity_event_id') ?? null,
    nodeId: model.getAttribute('node_id') ?? null,
    nodeTitle: null,
    taskId: model.getAttribute('task_id') ?? null,
    category: model.getAttribute('category') as AgentActivityCategory,
    severity: model.getAttribute('severity') as AgentActivitySeverity,
    status: model.getAttribute('status') as AgentAttentionStatus,
    title: model.getAttribute('title'),
    body: model.getAttribute('body') ?? null,
    sourceType: model.getAttribute('source_type') ?? null,
    sourceId: model.getAttribute('source_id') ?? null,
    correlationId: model.getAttribute('correlation_id') ?? null,
    action: parseAction(model.getAttribute('action_json')),
    readAt: nullableIso(model.getAttribute('read_at')),
    snoozedUntil: nullableIso(model.getAttribute('snoozed_until')),
    resolvedAt: nullableIso(model.getAttribute('resolved_at')),
    createdAt: toIso(model.getAttribute('created_at')),
    updatedAt: toIso(model.getAttribute('updated_at')),
  };
}

type SaveAttentionInput = {
  workspaceId: string;
  activityEventId?: string | null;
  nodeId?: string | null;
  taskId?: string | null;
  category: AgentActivityCategory;
  severity: AgentActivitySeverity;
  title: string;
  body?: string | null;
  sourceType?: string | null;
  sourceId?: string | null;
  correlationId?: string | null;
  action?: Record<string, unknown>;
};

export class AttentionRepository {
  async save(input: SaveAttentionInput): Promise<AgentAttentionItemData> {
    const existing = input.correlationId
      ? await AgentAttentionItem.query()
        .where('workspace_id', input.workspaceId)
        .where('correlation_id', input.correlationId)
        .whereNull('resolved_at')
        .orderBy('created_at', 'desc')
        .first()
      : null;
    const now = new Date().toISOString();
    const values = {
      activity_event_id: input.activityEventId ?? null,
      node_id: input.nodeId ?? null,
      task_id: input.taskId ?? null,
      category: input.category,
      severity: input.severity,
      status: 'open',
      title: input.title,
      body: input.body ?? null,
      source_type: input.sourceType ?? null,
      source_id: input.sourceId ?? null,
      correlation_id: input.correlationId ?? null,
      action_json: input.action ? JSON.stringify(input.action) : null,
      read_at: null,
      snoozed_until: null,
      resolved_at: null,
      updated_at: now,
    };
    if (existing) {
      await AgentAttentionItem.query().where('id', existing.getAttribute('id')).update(values);
      return mapAttention((await AgentAttentionItem.find(existing.getAttribute('id'))) ?? existing);
    }
    const model = await AgentAttentionItem.create({
      id: uuidv7(),
      workspace_id: input.workspaceId,
      ...values,
      created_at: now,
    });
    return mapAttention(model);
  }

  async list(input: { workspaceId?: string | null; includeResolved?: boolean; limit?: number } = {}): Promise<AgentAttentionItemData[]> {
    const query = AgentAttentionItem.query();
    if (input.workspaceId) query.where('workspace_id', input.workspaceId);
    if (!input.includeResolved) query.whereNull('resolved_at');
    const rows = await query.orderBy('updated_at', 'desc').limit(input.limit ?? 300).get();
    return rows.map(mapAttention);
  }

  async updateStatus(
    id: string,
    workspaceId: string,
    status: AgentAttentionStatus,
    snoozedUntil?: string | null,
  ): Promise<AgentAttentionItemData | null> {
    const model = await AgentAttentionItem.find(id);
    if (!model || model.getAttribute('workspace_id') !== workspaceId) return null;
    const now = new Date().toISOString();
    await AgentAttentionItem.query().where('id', id).update({
      status,
      read_at: status === 'read' || status === 'resolved' ? (model.getAttribute('read_at') ?? now) : model.getAttribute('read_at'),
      snoozed_until: status === 'snoozed' ? snoozedUntil ?? null : null,
      resolved_at: status === 'resolved' ? now : null,
      updated_at: now,
    });
    const updated = await AgentAttentionItem.find(id);
    return updated ? mapAttention(updated) : null;
  }

  async resolveAgentState(workspaceId: string, nodeId: string): Promise<number> {
    const rows = await AgentAttentionItem.query()
      .where('workspace_id', workspaceId)
      .where('node_id', nodeId)
      .where('source_type', 'agent_state')
      .whereNull('resolved_at')
      .get();
    const now = new Date().toISOString();
    for (const row of rows) {
      await AgentAttentionItem.query().where('id', row.getAttribute('id')).update({
        status: 'resolved',
        read_at: row.getAttribute('read_at') ?? now,
        resolved_at: now,
        updated_at: now,
      });
    }
    return rows.length;
  }

  async find(workspaceId: string, id: string): Promise<AgentAttentionItemData | null> {
    const model = await AgentAttentionItem.find(id);
    if (!model || model.getAttribute('workspace_id') !== workspaceId) return null;
    return mapAttention(model);
  }

  async hasUnresolved(workspaceId: string, correlationId: string): Promise<boolean> {
    const row = await AgentAttentionItem.query()
      .where('workspace_id', workspaceId)
      .where('correlation_id', correlationId)
      .whereNull('resolved_at')
      .first();
    return Boolean(row);
  }

  async resolveBySource(workspaceId: string, sourceType: string, sourceId: string): Promise<number> {
    const rows = await AgentAttentionItem.query()
      .where('workspace_id', workspaceId)
      .where('source_type', sourceType)
      .where('source_id', sourceId)
      .whereNull('resolved_at')
      .get();
    const now = new Date().toISOString();
    for (const row of rows) {
      await AgentAttentionItem.query().where('id', row.getAttribute('id')).update({
        status: 'resolved',
        read_at: row.getAttribute('read_at') ?? now,
        resolved_at: now,
        updated_at: now,
      });
    }
    return rows.length;
  }

  async deleteWorkspace(workspaceId: string): Promise<void> {
    await AgentAttentionItem.query().where('workspace_id', workspaceId).delete();
  }
}

export const attentionRepository = new AttentionRepository();
