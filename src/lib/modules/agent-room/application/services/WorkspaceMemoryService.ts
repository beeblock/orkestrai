import { isAbsolute, relative, resolve } from 'node:path';
import type { SaveWorkspaceMemoryInput } from '../../contracts/schemas/workspace-memory.schema.js';
import type { WorkspaceMemoryEntry } from '../../domain/types.js';
import { AgentBoardTask } from '../../domain/models/AgentBoardTask.js';
import { AgentCouncil } from '../../domain/models/AgentCouncil.js';
import { AgentMessageEnvelope } from '../../domain/models/AgentMessageEnvelope.js';
import { AgentReview } from '../../domain/models/AgentReview.js';
import { workspaceMemoryRepository } from '../../infrastructure/repositories/WorkspaceMemoryRepository.js';
import { workspaceRepository } from '../../infrastructure/repositories/WorkspaceRepository.js';
import { knowledgeService } from './KnowledgeService.js';

function normalize(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase();
}

function broadcast(workspaceId: string): void {
  knowledgeService.invalidate(workspaceId);
  const send = (globalThis as { __orkestraiBroadcast?: (frame: Record<string, unknown>) => void }).__orkestraiBroadcast;
  send?.({ type: 'memoryChanged', workspaceId });
}

export class WorkspaceMemoryConflictError extends Error {
  constructor(public readonly current: WorkspaceMemoryEntry) {
    super('This memory changed after it was opened. Review the current revision before saving.');
  }
}

export class WorkspaceMemoryService {
  async list(workspaceId: string, options: { query?: string; includeHistory?: boolean; limit?: number; createdByNodeId?: string } = {}): Promise<WorkspaceMemoryEntry[]> {
    if (!await workspaceRepository.getWorkspace(workspaceId)) throw new Error('Workspace not found.');
    const entries = await workspaceMemoryRepository.list(workspaceId, options.includeHistory, options.createdByNodeId);
    const query = normalize(options.query?.trim() ?? '');
    const filtered = !query ? entries : entries.filter((entry) => normalize([
      entry.title, entry.content, entry.kind, ...entry.tags,
      ...entry.sources.flatMap((source) => [source.label, source.uri ?? '', source.excerpt ?? '']),
    ].join(' ')).includes(query));
    return filtered.slice(0, Math.max(1, Math.min(options.limit ?? 200, 500)));
  }

  async create(workspaceId: string, input: SaveWorkspaceMemoryInput): Promise<WorkspaceMemoryEntry> {
    const normalized = await this.validateSources(workspaceId, input);
    const created = await workspaceMemoryRepository.create(workspaceId, normalized);
    broadcast(workspaceId);
    return created;
  }

  async revise(workspaceId: string, id: string, input: SaveWorkspaceMemoryInput & { baseUpdatedAt: string; baseRevision: number }): Promise<WorkspaceMemoryEntry> {
    const current = await workspaceMemoryRepository.find(id, workspaceId);
    if (!current || current.status !== 'active') throw new Error('Active memory not found in this workspace.');
    if (current.updatedAt !== input.baseUpdatedAt || current.revision !== input.baseRevision) throw new WorkspaceMemoryConflictError(current);
    const normalized = await this.validateSources(workspaceId, input);
    const revised = await workspaceMemoryRepository.create(workspaceId, normalized, current);
    broadcast(workspaceId);
    return revised;
  }

  async archive(workspaceId: string, id: string): Promise<WorkspaceMemoryEntry> {
    const archived = await workspaceMemoryRepository.archive(id, workspaceId);
    if (!archived) throw new Error('Memory not found in this workspace.');
    broadcast(workspaceId);
    return archived;
  }

  private async validateSources(workspaceId: string, input: SaveWorkspaceMemoryInput): Promise<SaveWorkspaceMemoryInput> {
    const workspace = await workspaceRepository.getWorkspace(workspaceId);
    if (!workspace) throw new Error('Workspace not found.');
    if (input.createdByNodeId) {
      const creator = await workspaceRepository.getNode(input.createdByNodeId);
      if (!creator || creator.workspaceId !== workspaceId || creator.type !== 'terminal') throw new Error('Memory author does not belong to this workspace.');
    }
    const sources = await Promise.all(input.sources.map(async (source) => {
      let label = source.label;
      if ((source.type === 'note' || source.type === 'agent') && source.sourceId) {
        const node = await workspaceRepository.getNode(source.sourceId);
        if (!node || node.workspaceId !== workspaceId || (source.type === 'note' && node.type !== 'note') || (source.type === 'agent' && node.type !== 'terminal')) throw new Error('Memory source does not belong to this workspace.');
        label = node.title ?? label;
      }
      if (source.type === 'task' && source.sourceId) {
        const task = await AgentBoardTask.find(source.sourceId);
        if (!task || task.getAttribute('workspace_id') !== workspaceId) throw new Error('Task source does not belong to this workspace.');
        label = String(task.getAttribute('title'));
      }
      if ((source.type === 'message' || source.type === 'review' || source.type === 'council') && source.sourceId) {
        const model = source.type === 'message'
          ? await AgentMessageEnvelope.find(source.sourceId)
          : source.type === 'review'
            ? await AgentReview.find(source.sourceId)
            : await AgentCouncil.find(source.sourceId);
        if (!model || model.getAttribute('workspace_id') !== workspaceId) throw new Error('Memory source does not belong to this workspace.');
      }
      if (source.type === 'url' && source.uri && !/^https?:\/\//i.test(source.uri)) throw new Error('URL memory sources must use HTTP or HTTPS.');
      if (source.type === 'file' && source.uri) {
        const absolute = isAbsolute(source.uri) ? resolve(source.uri) : resolve(workspace.workingDir, source.uri);
        const rel = relative(workspace.workingDir, absolute);
        if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('File memory sources must stay inside the workspace.');
      }
      return { ...source, label };
    }));
    return { ...input, tags: [...new Set(input.tags.map((tag) => tag.trim()).filter(Boolean))], sources };
  }
}

export const workspaceMemoryService = new WorkspaceMemoryService();
