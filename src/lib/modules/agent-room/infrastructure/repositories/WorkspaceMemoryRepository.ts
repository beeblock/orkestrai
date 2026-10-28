import { createHash } from 'node:crypto';
import { Connection } from '@beeblock/svelar/database';
import { uuidv7 } from '@beeblock/svelar/support';
import type { SaveWorkspaceMemoryInput } from '../../contracts/schemas/workspace-memory.schema.js';
import type { WorkspaceMemoryEntry, WorkspaceMemorySource, WorkspaceMemoryStatus } from '../../domain/types.js';
import { AgentMemoryEntry } from '../../domain/models/AgentMemoryEntry.js';
import { AgentMemorySource } from '../../domain/models/AgentMemorySource.js';
import { workspaceRepository } from './WorkspaceRepository.js';

function iso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
}

function nullableIso(value: unknown): string | null {
  return value ? iso(value) : null;
}

function parseArray(value: unknown): string[] {
  try {
    const parsed = JSON.parse(String(value ?? '[]'));
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function parseMetadata(value: unknown): Record<string, unknown> {
  try {
    const parsed = JSON.parse(String(value ?? '{}'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function mapSource(model: AgentMemorySource): WorkspaceMemorySource {
  return {
    id: String(model.getAttribute('id')),
    type: model.getAttribute('type') as WorkspaceMemorySource['type'],
    sourceId: model.getAttribute('source_id') as string | null,
    label: String(model.getAttribute('label')),
    uri: model.getAttribute('uri') as string | null,
    excerpt: model.getAttribute('excerpt') as string | null,
    contentHash: String(model.getAttribute('content_hash')),
    metadata: parseMetadata(model.getAttribute('metadata_json')),
    createdAt: iso(model.getAttribute('created_at')),
  };
}

export class WorkspaceMemoryRepository {
  async list(workspaceId: string, includeHistory = false, createdByNodeId?: string): Promise<WorkspaceMemoryEntry[]> {
    const query = AgentMemoryEntry.query().where('workspace_id', workspaceId);
    if (!includeHistory) query.where('status', 'active');
    if (createdByNodeId) query.where('created_by_node_id', createdByNodeId);
    const rows = await query.orderBy('pinned', 'desc').orderBy('updated_at', 'desc').get();
    return this.project(rows);
  }

  async find(id: string, workspaceId: string): Promise<WorkspaceMemoryEntry | null> {
    const model = await AgentMemoryEntry.find(id);
    if (!model || model.getAttribute('workspace_id') !== workspaceId) return null;
    return (await this.project([model]))[0] ?? null;
  }

  async create(workspaceId: string, input: SaveWorkspaceMemoryInput, supersedes: WorkspaceMemoryEntry | null = null): Promise<WorkspaceMemoryEntry> {
    return Connection.transaction(async () => {
      const now = new Date().toISOString();
      const id = uuidv7();
      await AgentMemoryEntry.create({
        id,
        workspace_id: workspaceId,
        kind: input.kind,
        status: 'active',
        title: input.title,
        content: input.content,
        confidence: input.confidence,
        pinned: input.pinned,
        tags_json: JSON.stringify([...new Set(input.tags.map((tag) => tag.toLocaleLowerCase()))]),
        created_by_node_id: input.createdByNodeId ?? null,
        supersedes_id: supersedes?.id ?? null,
        revision: (supersedes?.revision ?? 0) + 1,
        verified_at: now,
        created_at: now,
        updated_at: now,
      });
      for (const source of input.sources) {
        const fingerprint = createHash('sha256')
          .update(JSON.stringify([source.type, source.sourceId ?? null, source.uri ?? null, source.excerpt ?? null]))
          .digest('hex');
        await AgentMemorySource.create({
          id: uuidv7(),
          memory_entry_id: id,
          workspace_id: workspaceId,
          type: source.type,
          source_id: source.sourceId ?? null,
          label: source.label,
          uri: source.uri ?? null,
          excerpt: source.excerpt ?? null,
          content_hash: fingerprint,
          metadata_json: source.metadata ? JSON.stringify(source.metadata) : null,
          created_at: now,
          updated_at: now,
        });
      }
      if (supersedes) {
        await AgentMemoryEntry.query().where('id', supersedes.id).update({ status: 'superseded', updated_at: now });
      }
      return (await this.find(id, workspaceId))!;
    });
  }

  async archive(id: string, workspaceId: string): Promise<WorkspaceMemoryEntry | null> {
    const current = await this.find(id, workspaceId);
    if (!current) return null;
    await AgentMemoryEntry.query().where('id', id).update({ status: 'archived', updated_at: new Date().toISOString() });
    return this.find(id, workspaceId);
  }

  async deleteWorkspace(workspaceId: string): Promise<void> {
    await AgentMemorySource.query().where('workspace_id', workspaceId).delete();
    await AgentMemoryEntry.query().where('workspace_id', workspaceId).delete();
  }

  private async project(rows: AgentMemoryEntry[]): Promise<WorkspaceMemoryEntry[]> {
    if (!rows.length) return [];
    const ids = rows.map((row) => String(row.getAttribute('id')));
    const sourceRows = await AgentMemorySource.query().whereIn('memory_entry_id', ids).orderBy('created_at', 'asc').get();
    const sources = new Map<string, WorkspaceMemorySource[]>();
    for (const source of sourceRows) {
      const entryId = String(source.getAttribute('memory_entry_id'));
      sources.set(entryId, [...(sources.get(entryId) ?? []), mapSource(source)]);
    }
    const creatorIds = [...new Set(rows.flatMap((row) => row.getAttribute('created_by_node_id') ? [String(row.getAttribute('created_by_node_id'))] : []))];
    const creatorTitles = new Map<string, string>();
    await Promise.all(creatorIds.map(async (id) => {
      const node = await workspaceRepository.getNode(id);
      if (node) creatorTitles.set(id, node.title ?? node.type);
    }));
    return rows.map((row) => {
      const id = String(row.getAttribute('id'));
      const creatorId = row.getAttribute('created_by_node_id') as string | null;
      return {
        id,
        workspaceId: String(row.getAttribute('workspace_id')),
        kind: row.getAttribute('kind') as WorkspaceMemoryEntry['kind'],
        status: row.getAttribute('status') as WorkspaceMemoryStatus,
        title: String(row.getAttribute('title')),
        content: String(row.getAttribute('content')),
        confidence: Number(row.getAttribute('confidence')),
        pinned: Boolean(row.getAttribute('pinned')),
        tags: parseArray(row.getAttribute('tags_json')),
        createdByNodeId: creatorId,
        createdByTitle: creatorId ? creatorTitles.get(creatorId) ?? null : null,
        supersedesId: row.getAttribute('supersedes_id') as string | null,
        revision: Number(row.getAttribute('revision')),
        verifiedAt: nullableIso(row.getAttribute('verified_at')),
        sources: sources.get(id) ?? [],
        createdAt: iso(row.getAttribute('created_at')),
        updatedAt: iso(row.getAttribute('updated_at')),
      };
    });
  }
}

export const workspaceMemoryRepository = new WorkspaceMemoryRepository();
