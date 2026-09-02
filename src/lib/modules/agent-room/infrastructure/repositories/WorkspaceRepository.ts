import { uuidv7 } from '@beeblock/svelar/support';
import type {
  CanvasEdge,
  CodeIntelligenceMode,
  WorkspaceHooks,
  CanvasEdgeStyle,
  CanvasNode,
  CanvasNodePayload,
  CanvasNodeType,
  Workspace,
  WorkspaceRepositoryRoot,
} from '../../domain/types.js';
import { AgentWorkspace } from '../../domain/models/AgentWorkspace.js';
import { AgentCanvasNode } from '../../domain/models/AgentCanvasNode.js';
import { AgentCanvasEdge } from '../../domain/models/AgentCanvasEdge.js';
import { AgentFloor } from '../../domain/models/AgentFloor.js';
import { AgentRoutine } from '../../domain/models/AgentRoutine.js';
import { AgentRoutineRun } from '../../domain/models/AgentRoutineRun.js';
import { AgentAutomationIntegration } from '../../domain/models/AgentAutomationIntegration.js';
import { AgentBoardTask } from '../../domain/models/AgentBoardTask.js';
import { AgentBoardColumn } from '../../domain/models/AgentBoardColumn.js';
import { AgentMemoryEntry } from '../../domain/models/AgentMemoryEntry.js';
import { AgentMemorySource } from '../../domain/models/AgentMemorySource.js';
import { AgentHuddle } from '../../domain/models/AgentHuddle.js';
import { AgentHuddleParticipant } from '../../domain/models/AgentHuddleParticipant.js';
import { AgentHuddleTurn } from '../../domain/models/AgentHuddleTurn.js';
import { controlCenterRepository } from './ControlCenterRepository.js';
import { reviewCenterRepository } from './ReviewCenterRepository.js';
import { councilRepository } from './CouncilRepository.js';
import { codeGraphRepository } from './CodeGraphRepository.js';

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function parseJsonObject(value: string | null): WorkspaceHooks {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? (parsed as WorkspaceHooks) : {};
  } catch {
    return {};
  }
}

function parseRepositoryRoots(value: string | null): WorkspaceRepositoryRoot[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry): entry is WorkspaceRepositoryRoot => Boolean(
        entry && typeof entry === 'object' && typeof entry.alias === 'string' && typeof entry.path === 'string'
      ))
      .slice(0, 16)
      .map(({ alias, path }) => ({ alias, path }));
  } catch {
    return [];
  }
}

function mapWorkspace(model: AgentWorkspace): Workspace {
  const persistedCodeIntelligenceMode = model.getAttribute('code_intelligence_mode');
  const codeIntelligenceMode: CodeIntelligenceMode = persistedCodeIntelligenceMode === 'manual' || persistedCodeIntelligenceMode === 'disabled'
    ? persistedCodeIntelligenceMode
    : 'assisted';
  return {
    id: model.getAttribute('id'),
    name: model.getAttribute('name'),
    workingDir: model.getAttribute('working_dir'),
    runtimeKind: model.getAttribute('runtime_kind') === 'wsl' ? 'wsl' : 'native',
    wslDistribution: model.getAttribute('wsl_distribution'),
    wslWorkingDir: model.getAttribute('wsl_working_dir'),
    icon: model.getAttribute('icon'),
    instructions: model.getAttribute('instructions'),
    syncAgentInstructionFiles: Boolean(model.getAttribute('sync_agent_instruction_files')),
    repositoryRoots: parseRepositoryRoots(model.getAttribute('repository_roots_json') as string | null),
    codeIntelligenceMode,
    hooks: parseJsonObject(model.getAttribute('hooks_json') as string | null),
    suspendedAt: model.getAttribute('suspended_at')
      ? toIso(model.getAttribute('suspended_at'))
      : null,
    groupId: model.getAttribute('group_id') ?? null,
    position: Number(model.getAttribute('position') ?? 0),
    createdAt: toIso(model.getAttribute('created_at')),
    updatedAt: toIso(model.getAttribute('updated_at')),
  };
}

function mapNode(model: AgentCanvasNode): CanvasNode {
  const payloadJson = model.getAttribute('payload_json') as string | null;
  let payload: CanvasNodePayload = {};
  if (payloadJson) {
    try {
      payload = JSON.parse(payloadJson);
    } catch {
      payload = {};
    }
  }
  return {
    id: model.getAttribute('id'),
    workspaceId: model.getAttribute('workspace_id'),
    type: model.getAttribute('type'),
    title: model.getAttribute('title'),
    x: model.getAttribute('x'),
    y: model.getAttribute('y'),
    width: model.getAttribute('width'),
    height: model.getAttribute('height'),
    zIndex: model.getAttribute('z_index'),
    payload,
    floorId: model.getAttribute('floor_id'),
    createdAt: toIso(model.getAttribute('created_at')),
    updatedAt: toIso(model.getAttribute('updated_at')),
  };
}

function mapEdge(model: AgentCanvasEdge): CanvasEdge {
  return {
    id: model.getAttribute('id'),
    workspaceId: model.getAttribute('workspace_id'),
    sourceNodeId: model.getAttribute('source_node_id'),
    targetNodeId: model.getAttribute('target_node_id'),
    style: model.getAttribute('style'),
    createdAt: toIso(model.getAttribute('created_at')),
  };
}

/**
 * Repositorio de workspaces e do canvas (nos e arestas) do Agent Room.
 * Ids UUID v7; layout persistido a cada mudanca (posicao, tamanho, payload).
 */
export class WorkspaceRepository {
  // -- Workspaces -----------------------------------------------------------

  async listWorkspaces(): Promise<Workspace[]> {
    const rows = await AgentWorkspace.query().orderBy('updated_at', 'desc').get();
    return rows.map(mapWorkspace);
  }

  async getWorkspace(id: string): Promise<Workspace | null> {
    const model = await AgentWorkspace.find(id);
    return model ? mapWorkspace(model) : null;
  }

  async setWorkspaceSuspended(id: string, suspended: boolean): Promise<Workspace | null> {
    const model = await AgentWorkspace.find(id);
    if (!model) return null;
    const current = model.getAttribute('suspended_at');
    if (Boolean(current) === suspended) return mapWorkspace(model);
    await model.update({ suspended_at: suspended ? new Date() : null });
    return this.getWorkspace(id);
  }

  async createWorkspace(input: {
    name: string;
    workingDir: string;
    runtimeKind?: 'native' | 'wsl';
    wslDistribution?: string | null;
    wslWorkingDir?: string | null;
    icon?: string | null;
    instructions?: string | null;
    syncAgentInstructionFiles?: boolean;
    repositoryRoots?: WorkspaceRepositoryRoot[];
    codeIntelligenceMode?: CodeIntelligenceMode;
    hooks?: WorkspaceHooks;
    groupId?: string | null;
  }): Promise<Workspace> {
    const name = input.name.trim();
    const workingDir = input.workingDir.trim();
    if (!name) throw new Error('O nome do workspace nao pode ficar vazio.');
    if (!workingDir) throw new Error('Informe o diretorio de trabalho do workspace.');

    const model = await AgentWorkspace.create({
      id: uuidv7(),
      name,
      working_dir: workingDir,
      runtime_kind: input.runtimeKind ?? 'native',
      wsl_distribution: input.wslDistribution ?? null,
      wsl_working_dir: input.wslWorkingDir ?? null,
      icon: input.icon ?? null,
      instructions: input.instructions ?? null,
      sync_agent_instruction_files: input.syncAgentInstructionFiles ?? false,
      repository_roots_json: JSON.stringify(input.repositoryRoots ?? []),
      code_intelligence_mode: input.codeIntelligenceMode ?? 'assisted',
      hooks_json: JSON.stringify(input.hooks ?? {}),
      group_id: input.groupId ?? null,
      position: await this.nextWorkspacePosition(input.groupId ?? null),
    });
    return mapWorkspace(model);
  }

  /** Proxima posicao livre no fim da pasta (ou da raiz, se groupId for null). */
  private async nextWorkspacePosition(groupId: string | null): Promise<number> {
    const siblings = groupId === null
      ? await AgentWorkspace.query().whereNull('group_id').get()
      : await AgentWorkspace.query().where('group_id', groupId).get();
    return siblings.length;
  }

  /** Move um workspace para outra pasta (ou a raiz) e/ou reordena dentro dela. */
  async moveWorkspace(id: string, input: { groupId: string | null; position: number }): Promise<Workspace | null> {
    const model = await AgentWorkspace.find(id);
    if (!model) return null;
    await model.update({ group_id: input.groupId, position: input.position });
    return this.getWorkspace(id);
  }

  /**
   * Manda os workspaces de uma pasta apagada para a raiz. Feito explicitamente
   * (nao via ON DELETE do banco): o schema builder do Svelar so grava a
   * clausula FOREIGN KEY em CREATE TABLE, nao em ALTER TABLE ADD COLUMN — o
   * onDelete('set null') da migracao que adiciona group_id nunca chega a
   * virar SQL de verdade.
   */
  async clearWorkspaceGroup(groupId: string): Promise<void> {
    await AgentWorkspace.query().where('group_id', groupId).update({ group_id: null });
  }

  async updateWorkspace(
    id: string,
    input: Partial<Pick<Workspace, 'name' | 'workingDir' | 'runtimeKind' | 'wslDistribution' | 'wslWorkingDir' | 'icon' | 'instructions' | 'syncAgentInstructionFiles' | 'repositoryRoots' | 'codeIntelligenceMode' | 'hooks'>>
  ): Promise<Workspace | null> {
    const existing = await this.getWorkspace(id);
    if (!existing) return null;

    const model = await AgentWorkspace.find(id);
    if (!model) return null;
    await model.update({
      name: input.name?.trim() || existing.name,
      working_dir: input.workingDir?.trim() || existing.workingDir,
      runtime_kind: input.runtimeKind ?? existing.runtimeKind,
      wsl_distribution: input.wslDistribution === undefined ? existing.wslDistribution : input.wslDistribution,
      wsl_working_dir: input.wslWorkingDir === undefined ? existing.wslWorkingDir : input.wslWorkingDir,
      icon: input.icon === undefined ? existing.icon : input.icon,
      instructions: input.instructions === undefined ? existing.instructions : input.instructions,
      sync_agent_instruction_files: input.syncAgentInstructionFiles ?? existing.syncAgentInstructionFiles,
      repository_roots_json: input.repositoryRoots === undefined
        ? JSON.stringify(existing.repositoryRoots)
        : JSON.stringify(input.repositoryRoots),
      code_intelligence_mode: input.codeIntelligenceMode ?? existing.codeIntelligenceMode,
      hooks_json: input.hooks === undefined ? JSON.stringify(existing.hooks) : JSON.stringify(input.hooks),
    });
    return this.getWorkspace(id);
  }

  async deleteWorkspace(id: string): Promise<boolean> {
    await (globalThis as typeof globalThis & {
      __orkestraiStopWorkspaceDevice?: (workspaceId: string) => Promise<void>;
    }).__orkestraiStopWorkspaceDevice?.(id).catch(() => undefined);
    await (globalThis as typeof globalThis & {
      __orkestraiDeleteCollaborationWorkspace?: (workspaceId: string) => Promise<void>;
    }).__orkestraiDeleteCollaborationWorkspace?.(id);
    await controlCenterRepository.deleteWorkspaceHistory(id);
    await reviewCenterRepository.deleteWorkspaceHistory(id);
    await councilRepository.deleteWorkspaceHistory(id);
    await codeGraphRepository.deleteWorkspace(id);
    await AgentMemorySource.query().where('workspace_id', id).delete();
    await AgentMemoryEntry.query().where('workspace_id', id).delete();
    await AgentHuddleTurn.query().where('workspace_id', id).delete();
    await AgentHuddleParticipant.query().where('workspace_id', id).delete();
    await AgentHuddle.query().where('workspace_id', id).delete();
    await AgentCanvasEdge.query().where('workspace_id', id).delete();
    await AgentCanvasNode.query().where('workspace_id', id).delete();
    await AgentFloor.query().where('workspace_id', id).delete();
    await AgentBoardTask.query().where('workspace_id', id).delete();
    await AgentBoardColumn.query().where('workspace_id', id).delete();
    const routineIds = await AgentRoutine.query().where('workspace_id', id).pluck('id');
    for (const routineId of routineIds) {
      await AgentRoutineRun.query().where('routine_id', routineId).delete();
    }
    await AgentRoutine.query().where('workspace_id', id).delete();
    await AgentAutomationIntegration.query().where('workspace_id', id).delete();
    const deleted = await AgentWorkspace.query().where('id', id).delete();
    return deleted > 0;
  }

  // -- Nos do canvas ----------------------------------------------------------

  async listNodes(
    workspaceId: string,
    floorId?: string | null,
    includeArchived = false,
    includeInactiveFloors = false,
  ): Promise<CanvasNode[]> {
    const query = AgentCanvasNode.query().where('workspace_id', workspaceId).orderBy('created_at', 'asc');
    if (floorId === null) query.whereNull('floor_id');
    else if (floorId) query.where('floor_id', floorId);
    else if (!includeInactiveFloors) {
      const activeFloorIds = (await AgentFloor.query()
        .where('workspace_id', workspaceId)
        .where('status', 'active')
        .pluck('id')) as string[];
      query.whereNested((nested) => {
        nested.whereNull('floor_id');
        if (activeFloorIds.length > 0) nested.orWhereIn('floor_id', activeFloorIds);
      });
    }
    // Arquivados (notas vinculadas a tarefas arquivadas) ficam fora do canvas.
    if (!includeArchived) query.whereNull('archived_at');
    const rows = await query.get();
    return rows.map(mapNode);
  }

  /** Arquiva um no (some do canvas, continua no banco para o historico). */
  async archiveNode(id: string): Promise<void> {
    await AgentCanvasNode.query().where('id', id).update({ archived_at: new Date().toISOString() });
  }

  async archiveFloorNodes(workspaceId: string, floorId: string): Promise<CanvasNode[]> {
    const nodes = await this.listNodes(workspaceId, floorId, true, true);
    const nodeIds = nodes.map((node) => node.id);
    if (nodeIds.length === 0) return [];
    await AgentCanvasEdge.query().where('workspace_id', workspaceId).whereIn('source_node_id', nodeIds).delete();
    await AgentCanvasEdge.query().where('workspace_id', workspaceId).whereIn('target_node_id', nodeIds).delete();
    await AgentCanvasNode.query()
      .where('workspace_id', workspaceId)
      .where('floor_id', floorId)
      .whereNull('archived_at')
      .update({ archived_at: new Date().toISOString() });
    return nodes;
  }

  async getNode(id: string): Promise<CanvasNode | null> {
    const model = await AgentCanvasNode.find(id);
    return model ? mapNode(model) : null;
  }

  async createNode(input: {
    workspaceId: string;
    type: CanvasNodeType;
    title?: string | null;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    zIndex?: number;
    payload?: CanvasNodePayload;
    floorId?: string | null;
  }): Promise<CanvasNode> {
    const model = await AgentCanvasNode.create({
      id: uuidv7(),
      workspace_id: input.workspaceId,
      type: input.type,
      title: input.title ?? null,
      x: input.x ?? 0,
      y: input.y ?? 0,
      width: input.width ?? 560,
      height: input.height ?? 360,
      z_index: input.zIndex ?? 0,
      payload_json: input.payload ? JSON.stringify(input.payload) : null,
      floor_id: input.floorId ?? null,
    });
    return mapNode(model);
  }

  async updateNode(
    id: string,
    input: Partial<Pick<CanvasNode, 'title' | 'x' | 'y' | 'width' | 'height' | 'zIndex' | 'type'>> & { payload?: CanvasNodePayload }
  ): Promise<CanvasNode | null> {
    const model = await AgentCanvasNode.find(id);
    if (!model) return null;
    const changes: Record<string, unknown> = {};
    if (input.title !== undefined) changes.title = input.title;
    if (input.type !== undefined) changes.type = input.type;
    if (input.x !== undefined) changes.x = input.x;
    if (input.y !== undefined) changes.y = input.y;
    if (input.width !== undefined) changes.width = input.width;
    if (input.height !== undefined) changes.height = input.height;
    if (input.zIndex !== undefined) changes.z_index = input.zIndex;
    if (input.payload !== undefined) changes.payload_json = JSON.stringify(input.payload);
    if (Object.keys(changes).length) await model.update(changes);
    return this.getNode(id);
  }

  async deleteNode(id: string): Promise<boolean> {
    await AgentCanvasEdge.query().where('source_node_id', id).orWhere('target_node_id', id).delete();
    const deleted = await AgentCanvasNode.query().where('id', id).delete();
    return deleted > 0;
  }

  // -- Arestas do canvas --------------------------------------------------------

  async listEdges(workspaceId: string): Promise<CanvasEdge[]> {
    const rows = await AgentCanvasEdge.query().where('workspace_id', workspaceId).orderBy('created_at', 'asc').get();
    return rows.map(mapEdge);
  }

  async createEdge(input: {
    workspaceId: string;
    sourceNodeId: string;
    targetNodeId: string;
    style?: CanvasEdgeStyle;
  }): Promise<CanvasEdge> {
    const model = await AgentCanvasEdge.create({
      id: uuidv7(),
      workspace_id: input.workspaceId,
      source_node_id: input.sourceNodeId,
      target_node_id: input.targetNodeId,
      style: input.style ?? 'cord',
      created_at: new Date(),
    });
    return mapEdge(model);
  }

  async updateEdgeStyle(id: string, style: CanvasEdgeStyle): Promise<CanvasEdge | null> {
    const model = await AgentCanvasEdge.find(id);
    if (!model) return null;
    await model.update({ style });
    const updated = await AgentCanvasEdge.find(id);
    return updated ? mapEdge(updated) : null;
  }

  async deleteEdge(id: string): Promise<boolean> {
    const deleted = await AgentCanvasEdge.query().where('id', id).delete();
    return deleted > 0;
  }
}

export const workspaceRepository = new WorkspaceRepository();
