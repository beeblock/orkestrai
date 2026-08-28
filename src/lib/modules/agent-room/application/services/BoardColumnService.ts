import { uuidv7 } from '@beeblock/svelar/support';
import { AgentBoardColumn } from '../../domain/models/AgentBoardColumn.js';
import { AgentBoardTask } from '../../domain/models/AgentBoardTask.js';
import { AgentWorkspace } from '../../domain/models/AgentWorkspace.js';

export type BoardColumn = {
  id: string;
  workspaceId: string;
  key: string;
  name: string | null;
  color: string;
  position: number;
  builtin: boolean;
};

export type BoardColumnRecipe = Pick<BoardColumn, 'key' | 'name' | 'color' | 'position'>;

const DEFAULT_COLUMNS = [
  { key: 'todo', color: '#7de5ff', position: 0 },
  { key: 'doing', color: '#ffc857', position: 1 },
  { key: 'done', color: '#8ec98e', position: 2 },
] as const;

const COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

function mapColumn(model: AgentBoardColumn): BoardColumn {
  return {
    id: model.getAttribute('id'),
    workspaceId: model.getAttribute('workspace_id'),
    key: model.getAttribute('key'),
    name: model.getAttribute('name') ?? null,
    color: model.getAttribute('color'),
    position: Number(model.getAttribute('position')),
    builtin: Boolean(model.getAttribute('builtin')),
  };
}

function slug(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 36);
}

function notifyWorkspaceChanged(workspaceId: string) {
  const broadcast = (globalThis as { __orkestraiBroadcast?: (payload: Record<string, unknown>) => void }).__orkestraiBroadcast;
  broadcast?.({ type: 'workspaceChanged', workspaceId });
}

export class BoardColumnService {
  private async ensureDefaults(workspaceId: string): Promise<void> {
    if (!await AgentWorkspace.find(workspaceId)) throw new Error('WORKSPACE_NOT_FOUND');
    const existing = await AgentBoardColumn.query().where('workspace_id', workspaceId).get();
    const keys = new Set(existing.map((column) => String(column.getAttribute('key'))));
    const now = new Date().toISOString();
    for (const column of DEFAULT_COLUMNS) {
      if (keys.has(column.key)) continue;
      try {
        await AgentBoardColumn.query().insert({
          id: uuidv7(),
          workspace_id: workspaceId,
          key: column.key,
          name: null,
          color: column.color,
          position: column.position,
          builtin: true,
          created_at: now,
          updated_at: now,
        });
      } catch (error) {
        const insertedByAnotherRequest = await AgentBoardColumn.query()
          .where('workspace_id', workspaceId)
          .where('key', column.key)
          .get();
        if (insertedByAnotherRequest.length) continue;
        if (!await AgentWorkspace.find(workspaceId)) throw new Error('WORKSPACE_NOT_FOUND');
        throw error;
      }
    }
  }

  async list(workspaceId: string): Promise<BoardColumn[]> {
    await this.ensureDefaults(workspaceId);
    const rows = await AgentBoardColumn.query().where('workspace_id', workspaceId).orderBy('position', 'asc').get();
    return rows.map(mapColumn);
  }

  async create(workspaceId: string, input: { name: string; color?: string }): Promise<BoardColumn> {
    const name = input.name.trim().slice(0, 48);
    if (!name) throw new Error('Informe o nome da coluna.');
    const columns = await this.list(workspaceId);
    if (columns.length >= 10) throw new Error('O quadro aceita no máximo 10 colunas.');
    if (columns.some((column) => (column.name ?? column.key).toLocaleLowerCase() === name.toLocaleLowerCase())) {
      throw new Error('Já existe uma coluna com esse nome.');
    }
    const color = input.color?.toLowerCase() ?? '#9675ff';
    if (!COLOR_PATTERN.test(color)) throw new Error('Cor inválida. Use o formato #RRGGBB.');
    const base = slug(name) || 'coluna';
    let key = base;
    let suffix = 2;
    const used = new Set(columns.map((column) => column.key));
    while (used.has(key)) key = `${base.slice(0, 32)}-${suffix++}`;
    const now = new Date().toISOString();
    const id = uuidv7();
    await AgentBoardColumn.query().insert({
      id,
      workspace_id: workspaceId,
      key,
      name,
      color,
      position: columns.length,
      builtin: false,
      created_at: now,
      updated_at: now,
    });
    notifyWorkspaceChanged(workspaceId);
    return mapColumn((await AgentBoardColumn.find(id))!);
  }

  async update(workspaceId: string, columnId: string, input: { name?: string; color?: string; position?: number }): Promise<BoardColumn> {
    const column = await this.requireColumn(workspaceId, columnId);
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (input.name !== undefined) {
      const name = input.name.trim().slice(0, 48);
      if (!name) throw new Error('Informe o nome da coluna.');
      const duplicate = (await this.list(workspaceId)).some(
        (item) => item.id !== columnId && (item.name ?? item.key).toLocaleLowerCase() === name.toLocaleLowerCase()
      );
      if (duplicate) throw new Error('Já existe uma coluna com esse nome.');
      patch.name = name;
    }
    if (input.color !== undefined) {
      if (!COLOR_PATTERN.test(input.color)) throw new Error('Cor inválida. Use o formato #RRGGBB.');
      patch.color = input.color.toLowerCase();
    }
    await AgentBoardColumn.query().where('id', columnId).update(patch);

    if (input.position !== undefined) {
      const columns = await this.list(workspaceId);
      const current = columns.findIndex((item) => item.id === columnId);
      const target = Math.max(0, Math.min(columns.length - 1, Math.trunc(input.position)));
      if (current >= 0 && current !== target) {
        const reordered = [...columns];
        const [moved] = reordered.splice(current, 1);
        reordered.splice(target, 0, moved);
        for (const [position, item] of reordered.entries()) {
          await AgentBoardColumn.query().where('id', item.id).update({ position, updated_at: new Date().toISOString() });
        }
      }
    }
    notifyWorkspaceChanged(workspaceId);
    return mapColumn((await AgentBoardColumn.find(column.getAttribute('id')))!);
  }

  async remove(workspaceId: string, columnId: string): Promise<{ deleted: true }> {
    const column = await this.requireColumn(workspaceId, columnId);
    if (column.getAttribute('builtin')) throw new Error('As colunas padrão não podem ser removidas.');
    const tasks = await AgentBoardTask.query()
      .where('workspace_id', workspaceId)
      .where('status', column.getAttribute('key'))
      .get();
    if (tasks.length) throw new Error('Mova as tarefas desta coluna antes de removê-la.');
    await AgentBoardColumn.query().where('id', columnId).delete();
    const remaining = await this.list(workspaceId);
    for (const [position, item] of remaining.entries()) {
      if (item.position !== position) await AgentBoardColumn.query().where('id', item.id).update({ position });
    }
    notifyWorkspaceChanged(workspaceId);
    return { deleted: true };
  }

  async resolveKey(workspaceId: string, value: string): Promise<string> {
    const target = value.trim().toLocaleLowerCase();
    const column = (await this.list(workspaceId)).find(
      (item) => item.key.toLocaleLowerCase() === target || item.name?.toLocaleLowerCase() === target
    );
    if (!column) throw new Error(`Coluna desconhecida: ${value}. Consulte com orkestrai task columns.`);
    return column.key;
  }

  async install(workspaceId: string, recipes: BoardColumnRecipe[], replaceExisting = false): Promise<number> {
    if (!recipes.length) return 0;
    let columns = await this.list(workspaceId);
    let installed = 0;
    for (const recipe of [...recipes].sort((a, b) => a.position - b.position)) {
      if (!/^[a-z0-9][a-z0-9-]{0,47}$/.test(recipe.key) || !COLOR_PATTERN.test(recipe.color)) continue;
      const existing = columns.find((column) => column.key === recipe.key);
      if (existing) {
        if (replaceExisting) {
          await AgentBoardColumn.query().where('id', existing.id).update({
            name: recipe.name,
            color: recipe.color.toLowerCase(),
            position: recipe.position,
            updated_at: new Date().toISOString(),
          });
        }
        continue;
      }
      if (columns.length >= 10) break;
      const now = new Date().toISOString();
      await AgentBoardColumn.query().insert({
        id: uuidv7(),
        workspace_id: workspaceId,
        key: recipe.key,
        name: recipe.name,
        color: recipe.color.toLowerCase(),
        position: replaceExisting ? recipe.position : columns.length,
        builtin: false,
        created_at: now,
        updated_at: now,
      });
      installed += 1;
      columns = await this.list(workspaceId);
    }
    if (replaceExisting) {
      const ordered = await AgentBoardColumn.query().where('workspace_id', workspaceId).orderBy('position', 'asc').get();
      for (const [position, column] of ordered.entries()) {
        await AgentBoardColumn.query().where('id', column.getAttribute('id')).update({ position });
      }
    }
    notifyWorkspaceChanged(workspaceId);
    return installed;
  }

  private async requireColumn(workspaceId: string, columnId: string): Promise<AgentBoardColumn> {
    const column = await AgentBoardColumn.find(columnId);
    if (!column || column.getAttribute('workspace_id') !== workspaceId) throw new Error('Coluna não encontrada neste workspace.');
    return column;
  }
}

export const boardColumnService = new BoardColumnService();
