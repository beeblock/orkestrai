import type { WorkspaceGroup } from '../../domain/types.js';
import {
  workspaceGroupRepository,
  type WorkspaceGroupRepository,
} from '../../infrastructure/repositories/WorkspaceGroupRepository.js';
import { workspaceRepository, type WorkspaceRepository } from '../../infrastructure/repositories/WorkspaceRepository.js';

export type WorkspaceGroupErrorCode =
  | 'group_name_required'
  | 'group_not_found'
  | 'group_parent_not_found'
  | 'group_cycle'
  | 'workspace_not_found';

export class WorkspaceGroupError extends Error {
  constructor(public readonly code: WorkspaceGroupErrorCode, message: string) {
    super(message);
    this.name = 'WorkspaceGroupError';
  }
}

function groupError(code: WorkspaceGroupErrorCode): WorkspaceGroupError {
  const messages: Record<WorkspaceGroupErrorCode, string> = {
    group_name_required: 'Informe o nome da pasta.',
    group_not_found: 'Pasta nao encontrada.',
    group_parent_not_found: 'Pasta de destino nao encontrada.',
    group_cycle: 'Uma pasta nao pode ficar dentro dela mesma ou de uma subpasta sua.',
    workspace_not_found: 'Workspace nao encontrado.',
  };
  return new WorkspaceGroupError(code, messages[code]);
}

/**
 * Pastas (arvore) para organizar workspaces na barra lateral do Canvas.
 * Exclusao nao e destrutiva: filhos (workspaces ou subpastas) sobem para a
 * pasta pai (ou a raiz) via ON DELETE SET NULL — nunca apaga conteudo.
 */
export class WorkspaceGroupService {
  constructor(
    private readonly repository: WorkspaceGroupRepository = workspaceGroupRepository,
    private readonly workspaces: WorkspaceRepository = workspaceRepository,
  ) {}

  async list(): Promise<WorkspaceGroup[]> {
    return this.repository.list();
  }

  async assertExists(id: string): Promise<void> {
    await this.requireGroup(id);
  }

  async create(input: { name: string; parentId?: string | null }): Promise<WorkspaceGroup> {
    const name = input.name.trim();
    if (!name) throw groupError('group_name_required');
    const parentId = input.parentId ?? null;
    if (parentId) await this.requireGroup(parentId);
    const position = await this.repository.nextPosition(parentId);
    return this.repository.create({ name, parentId, position });
  }

  async update(id: string, input: { name?: string; parentId?: string | null; collapsed?: boolean }): Promise<WorkspaceGroup> {
    const existing = await this.requireGroup(id);
    const changes: { name?: string; parentId?: string | null; collapsed?: boolean } = {};

    if (input.name !== undefined) {
      const name = input.name.trim();
      if (!name) throw groupError('group_name_required');
      changes.name = name;
    }

    if (input.parentId !== undefined && input.parentId !== existing.parentId) {
      if (input.parentId !== null) {
        await this.requireGroup(input.parentId);
        if (await this.wouldCreateCycle(id, input.parentId)) throw groupError('group_cycle');
      }
      changes.parentId = input.parentId;
    }

    if (input.collapsed !== undefined) changes.collapsed = input.collapsed;

    const updated = await this.repository.update(id, changes);
    if (!updated) throw groupError('group_not_found');
    return updated;
  }

  async remove(id: string): Promise<{ removed: boolean }> {
    await this.requireGroup(id);
    // Nao destrutivo: workspaces e subpastas sobem para a raiz antes de
    // apagar a pasta (feito aqui, nao via ON DELETE do banco — ver nota em
    // WorkspaceRepository.clearWorkspaceGroup).
    await this.workspaces.clearWorkspaceGroup(id);
    await this.repository.clearChildGroups(id);
    const removed = await this.repository.remove(id);
    return { removed };
  }

  /** Move um workspace para outra pasta (ou a raiz), no fim dela. */
  async moveWorkspace(workspaceId: string, groupId: string | null): Promise<void> {
    if (groupId) await this.requireGroup(groupId);
    const position = await this.nextWorkspacePosition(groupId);
    const moved = await this.workspaces.moveWorkspace(workspaceId, { groupId, position });
    if (!moved) throw groupError('workspace_not_found');
  }

  private async nextWorkspacePosition(groupId: string | null): Promise<number> {
    const all = await this.workspaces.listWorkspaces();
    return all.filter((workspace) => workspace.groupId === groupId).length;
  }

  private async requireGroup(id: string): Promise<WorkspaceGroup> {
    const group = await this.repository.find(id);
    if (!group) throw groupError('group_not_found');
    return group;
  }

  /**
   * true se mover `groupId` para dentro de `newParentId` criaria um ciclo —
   * ou seja, `newParentId` e o proprio `groupId` ou um descendente dele
   * (o que faria `groupId` virar ancestral do seu proprio ancestral).
   */
  private async wouldCreateCycle(groupId: string, newParentId: string): Promise<boolean> {
    if (newParentId === groupId) return true;
    const all = await this.repository.list();
    const byId = new Map(all.map((group) => [group.id, group]));
    let cursor = byId.get(newParentId)?.parentId ?? null;
    const visited = new Set<string>();
    while (cursor) {
      if (cursor === groupId) return true;
      if (visited.has(cursor)) return false; // ciclo pre-existente defensivo — nao trava
      visited.add(cursor);
      cursor = byId.get(cursor)?.parentId ?? null;
    }
    return false;
  }
}

export const workspaceGroupService = new WorkspaceGroupService();
